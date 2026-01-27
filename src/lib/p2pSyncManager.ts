/**
 * P2P Sync Manager
 * 
 * Store-and-Forward image synchronization between workspace users.
 * Uses Supabase Storage as a temporary buffer (48h TTL).
 */

import { supabase, isSupabaseConfigured } from '@/auth/supabase';
import { isTauri } from '@/lib/platform';
import { RealtimeChannel } from '@supabase/supabase-js';

// Types
export interface SyncQueueItem {
    id: string;
    created_at: string;
    uploader_id: string;
    uploader_session_id?: string;
    workspace_id: string;
    file_name: string;
    storage_path: string;
    file_size: number;
    synced_by: string[];
    expires_at: string;
}

export interface SyncProgress {
    status: 'idle' | 'uploading' | 'downloading' | 'error';
    currentFile?: string;
    progress?: number; // 0-100
    totalPending?: number;
    error?: string;
    isInitialSync?: boolean;
}

type SyncEventListener = (progress: SyncProgress) => void;

class P2PSyncManager {
    private static instance: P2PSyncManager;
    private channel: RealtimeChannel | null = null;
    private userId: string | null = null;
    private workspaceId: string | null = null;
    private sessionId: string | null = null;
    private listeners: Set<SyncEventListener> = new Set();
    private currentProgress: SyncProgress = { status: 'idle' };
    private isInitialized = false;
    private downloadQueue: SyncQueueItem[] = [];
    private isProcessingQueue = false;
    private isInitialSync = false;

    private constructor() { }

    static getInstance(): P2PSyncManager {
        if (!P2PSyncManager.instance) {
            P2PSyncManager.instance = new P2PSyncManager();
        }
        return P2PSyncManager.instance;
    }

    /**
     * Initialize the sync manager with user context
     */
    async initialize(userId: string, workspaceId: string, sessionId: string | null = null): Promise<void> {
        if (this.isInitialized && this.userId === userId && this.workspaceId === workspaceId && this.sessionId === sessionId) {
            return;
        }

        this.userId = userId;
        this.workspaceId = workspaceId;
        this.sessionId = sessionId;
        this.isInitialized = true;
        this.isInitialSync = true;
        this.emitProgress({ status: 'idle', isInitialSync: true });

        console.log('[P2PSync] Initializing for user:', userId, 'workspace:', workspaceId);

        // Subscribe to realtime changes
        await this.subscribeToChanges();

        // Check for pending downloads immediately (run in background to not block UI init)
        this.checkPendingDownloads();
    }

    /**
     * Subscribe to realtime sync_queue changes
     */
    private async subscribeToChanges(): Promise<void> {
        if (!isSupabaseConfigured || !this.workspaceId) return;

        // Unsubscribe from previous channel if exists
        if (this.channel) {
            await this.channel.unsubscribe();
        }

        this.channel = supabase
            .channel(`sync_queue:${this.workspaceId}`)
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'sync_queue',
                    filter: `workspace_id=eq.${this.workspaceId}`
                },
                (payload) => {
                    console.log('[P2PSync] New sync item:', payload.new);
                    this.handleNewSyncItem(payload.new as SyncQueueItem);
                }
            )
            .subscribe();
    }

    private emitProgress(progress: SyncProgress) {
        // Merge with existing state to persist flags like isInitialSync
        this.currentProgress = {
            ...this.currentProgress,
            ...progress,
            isInitialSync: this.isInitialSync // Always reflect current flag
        };
        this.listeners.forEach(listener => listener(this.currentProgress));
    }

    /**
     * Handle header-based inserts
     */
    private handleNewSyncItem(item: SyncQueueItem) {
        if (item.uploader_session_id === this.sessionId) return;

        this.downloadQueue.push(item);
        this.processDownloadQueue();
    }

    /**
     * Check database for any pending files we missed
     */
    private async checkPendingDownloads() {
        if (!this.userId || !this.workspaceId) return;

        try {
            // Fetch files not synced by this session
            const { data, error } = await supabase
                .from('sync_queue')
                .select('*')
                .eq('workspace_id', this.workspaceId)
                .not('synced_by', 'cs', `["${this.sessionId}"]`) // synced_by is JSONB array
                .gt('expires_at', new Date().toISOString());

            if (error) throw error;

            // Filter out items uploaded by this specific session
            const pending = (data || []).filter(
                (item: SyncQueueItem) => item.uploader_session_id !== this.sessionId
            );

            if (pending.length > 0) {
                console.log('[P2PSync] Found pending downloads:', pending.length);
                this.downloadQueue.push(...pending);
                this.processDownloadQueue();
            } else {
                // If no pending items, initial sync is done
                if (this.isInitialSync) {
                    this.isInitialSync = false;
                    this.emitProgress({ status: 'idle', isInitialSync: false });
                }
            }
        } catch (e) {
            console.error('[P2PSync] Error in checkPendingDownloads:', e);
            // On error, disable blocking overlay?
            if (this.isInitialSync) {
                this.isInitialSync = false;
                this.emitProgress({ status: 'error', error: 'Init failed', isInitialSync: false });
            }
        }
    }

    /**
     * Process the download queue
     */
    private async processDownloadQueue(): Promise<void> {
        if (this.isProcessingQueue || this.downloadQueue.length === 0) return;

        this.isProcessingQueue = true;
        this.emitProgress({
            status: 'downloading',
            totalPending: this.downloadQueue.length
        });

        while (this.downloadQueue.length > 0) {
            const item = this.downloadQueue[0];
            try {
                await this.downloadFile(item);
                this.downloadQueue.shift(); // Remove processed item
            } catch (e) {
                console.error('[P2PSync] Download error:', e);
                this.downloadQueue.shift(); // Remove failed item to prevent blocking
            }
        }

        this.isProcessingQueue = false;

        // If queue is empty and we were in initial sync, mark it detailed
        if (this.isInitialSync) {
            this.isInitialSync = false;
        }

        this.emitProgress({ status: 'idle', isInitialSync: false });
    }

    /**
     * Download a file from the sync queue
     */
    private async downloadFile(item: SyncQueueItem): Promise<void> {
        if (!this.userId) return;

        this.emitProgress({
            status: 'downloading',
            currentFile: item.file_name,
            totalPending: this.downloadQueue.length
        });

        console.log('[P2PSync] Downloading:', item.file_name);

        // Download from Supabase Storage
        const { data, error } = await supabase.storage
            .from('temp_sync')
            .download(item.storage_path);

        if (error) {
            console.error('[P2PSync] Storage download error:', error);
            throw error;
        }

        // Save locally using platform service (mobile compatible)
        if (isTauri() && data && this.workspaceId) {
            try {
                // Dynamically import to keep web bundle light if platformService isn't fully tree-shaken
                const { platformService } = await import('@/services/platformService');

                await platformService.saveDownloadedFile(
                    this.workspaceId,
                    item.file_name,
                    await data.arrayBuffer()
                );

                console.log('[P2PSync] Saved via platform service:', item.file_name);
            } catch (fsError) {
                console.error('[P2PSync] Platform save error:', fsError);
                // On web or error, we can still mark as synced potentially, but better to retry?
                // For now, allow proceed to ack so we don't get stuck, 
                // OR re-throw? 
                // Getting stuck is bad. Acking without saving means "I have it".
                // If save failed, we DON'T have it.
                // So we should NOT Ack.
                throw fsError;
            }
        } else if (data) {
            // Web fallback: trigger browser download
            const url = URL.createObjectURL(data);
            const a = document.createElement('a');
            a.href = url;
            a.download = item.file_name;
            a.click();
            URL.revokeObjectURL(url);
            console.log('[P2PSync] Triggered browser download for:', item.file_name);
        }

        // Mark as synced in database
        // Mark as synced using RPC for atomic cleanup check
        const { data: ackData, error: ackError } = await supabase.rpc('acknowledge_p2p_sync', {
            p_queue_id: item.id,
            p_session_id: this.sessionId
        });

        if (ackError) {
            console.error('[P2PSync] Ack error:', ackError);
        } else {
            console.log('[P2PSync] Marked as synced:', item.file_name);

            // detailed check if we are the last one
            const result = Array.isArray(ackData) ? ackData[0] : ackData;

            if (result?.is_complete) {
                console.log('[P2PSync] Last member synced! Cleaning up:', result.file_name);

                // 1. Delete File from Storage
                const { error: storageError } = await supabase.storage
                    .from('temp_sync')
                    .remove([result.storage_path]);

                if (storageError) {
                    console.error('[P2PSync] Cleanup storage error:', storageError);
                } else {
                    console.log('[P2PSync] File removed from cloud storage');
                }

                // 2. Delete Record from Sync Queue
                const { error: dbError } = await supabase
                    .from('sync_queue')
                    .delete()
                    .eq('id', item.id);

                if (dbError) {
                    console.error('[P2PSync] Cleanup DB error:', dbError);
                } else {
                    console.log('[P2PSync] Sync record removed from database');
                }
            }
        }
    }

    /**
     * Upload a file to the sync queue for other users
     */
    async uploadFile(file: File, customFileName?: string, expiryHours?: number): Promise<boolean> {
        if (!isSupabaseConfigured || !this.workspaceId || !this.userId) {
            console.error('[P2PSync] Not initialized');
            return false;
        }

        this.emitProgress({
            status: 'uploading',
            currentFile: customFileName || file.name
        });

        try {
            // Generate unique storage path
            const timestamp = Date.now();
            const storagePath = `${this.workspaceId}/${timestamp}_${file.name}`.replace(/\\/g, '/');

            // Upload to Supabase Storage
            const { error: uploadError } = await supabase.storage
                .from('temp_sync')
                .upload(storagePath, file);

            if (uploadError) {
                console.error('[P2PSync] Upload error:', uploadError);
                this.emitProgress({ status: 'error', error: uploadError.message });
                return false;
            }

            // Create sync queue entry
            const insertData: any = {
                uploader_id: this.userId,
                uploader_session_id: this.sessionId,
                workspace_id: this.workspaceId,
                file_name: (customFileName || file.name).replace(/\\/g, '/'),
                storage_path: storagePath,
                file_size: file.size,
                synced_by: [this.sessionId]
            };

            if (expiryHours) {
                const expiresAt = new Date();
                expiresAt.setHours(expiresAt.getHours() + expiryHours);
                insertData.expires_at = expiresAt.toISOString();
            }

            const { error: insertError } = await supabase
                .from('sync_queue')
                .insert(insertData);

            if (insertError) {
                console.error('[P2PSync] Queue insert error:', insertError);
                // Try to clean up uploaded file
                await supabase.storage.from('temp_sync').remove([storagePath]);
                this.emitProgress({ status: 'error', error: insertError.message });
                return false;
            }

            console.log('[P2PSync] Upload complete:', customFileName || file.name);
            this.emitProgress({ status: 'idle' });
            return true;
        } catch (e) {
            console.error('[P2PSync] Upload exception:', e);
            this.emitProgress({ status: 'error', error: String(e) });
            return false;
        }
    }

    /**
     * Upload a file from a local path (for Tauri/Mobile)
     * This reads the file from disk and uploads it to P2P sync
     */
    async uploadFromPath(filePath: string, expiryHours?: number): Promise<boolean> {
        if (!isTauri()) {
            console.warn('[P2PSync] uploadFromPath only works in Tauri');
            return false;
        }

        if (!isSupabaseConfigured || !this.workspaceId || !this.userId) {
            console.error('[P2PSync] Not initialized');
            return false;
        }

        try {
            const { readFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');
            const { basename } = await import('@tauri-apps/api/path');

            // Read the file from disk (relative to AppData)
            const fileData = await readFile(filePath, { baseDir: BaseDirectory.AppData });
            const fileName = await basename(filePath);

            // Determine MIME type from extension
            const ext = fileName.split('.').pop()?.toLowerCase() || 'jpg';
            const mimeTypes: Record<string, string> = {
                'jpg': 'image/jpeg',
                'jpeg': 'image/jpeg',
                'png': 'image/png',
                'gif': 'image/gif',
                'webp': 'image/webp'
            };
            const mimeType = mimeTypes[ext] || 'image/jpeg';

            // Create a File object
            const file = new File([fileData], fileName, { type: mimeType });

            // Use existing uploadFile method - passing full relative path to preserve it
            return await this.uploadFile(file, filePath, expiryHours);
        } catch (e) {
            console.error('[P2PSync] uploadFromPath error:', e);
            this.emitProgress({ status: 'error', error: String(e) });
            return false;
        }
    }

    /**
     * Add a progress listener
     */
    subscribe(listener: SyncEventListener): () => void {
        this.listeners.add(listener);
        // Immediately emit current state
        listener(this.currentProgress);
        return () => this.listeners.delete(listener);
    }



    /**
     * Cleanup on logout/unmount
     */
    async destroy(): Promise<void> {
        if (this.channel) {
            await this.channel.unsubscribe();
            this.channel = null;
        }
        this.isInitialized = false;
        this.userId = null;
        this.workspaceId = null;
        this.sessionId = null;
        this.downloadQueue = [];
        this.listeners.clear();
        console.log('[P2PSync] Destroyed');
    }

    /**
     * Get current progress state
     */
    getProgress(): SyncProgress {
        return this.currentProgress;
    }
}

export const p2pSyncManager = P2PSyncManager.getInstance();
