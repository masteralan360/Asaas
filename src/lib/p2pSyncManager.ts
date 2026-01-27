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
}

type SyncEventListener = (progress: SyncProgress) => void;

class P2PSyncManager {
    private static instance: P2PSyncManager;
    private channel: RealtimeChannel | null = null;
    private userId: string | null = null;
    private workspaceId: string | null = null;
    private listeners: Set<SyncEventListener> = new Set();
    private currentProgress: SyncProgress = { status: 'idle' };
    private isInitialized = false;
    private downloadQueue: SyncQueueItem[] = [];
    private isProcessingQueue = false;

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
    async initialize(userId: string, workspaceId: string): Promise<void> {
        if (this.isInitialized && this.userId === userId && this.workspaceId === workspaceId) {
            return;
        }

        this.userId = userId;
        this.workspaceId = workspaceId;
        this.isInitialized = true;

        console.log('[P2PSync] Initializing for user:', userId, 'workspace:', workspaceId);

        // Subscribe to realtime changes
        await this.subscribeToChanges();

        // Check for pending downloads immediately
        await this.checkPendingDownloads();
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
            .subscribe((status) => {
                console.log('[P2PSync] Realtime subscription status:', status);
            });
    }

    /**
     * Handle incoming sync item
     */
    private async handleNewSyncItem(item: SyncQueueItem): Promise<void> {
        if (!this.userId) return;

        // Skip if we uploaded it or already synced
        if (item.uploader_id === this.userId) return;
        if (item.synced_by.includes(this.userId)) return;

        // Add to download queue
        this.downloadQueue.push(item);
        this.processDownloadQueue();
    }

    /**
     * Check for pending downloads on initialization
     */
    async checkPendingDownloads(): Promise<void> {
        if (!isSupabaseConfigured || !this.workspaceId || !this.userId) return;

        try {
            const { data, error } = await supabase
                .from('sync_queue')
                .select('*')
                .eq('workspace_id', this.workspaceId)
                .not('synced_by', 'cs', `["${this.userId}"]`);

            if (error) {
                console.error('[P2PSync] Error checking pending downloads:', error);
                return;
            }

            // Filter out items we uploaded
            const pending = (data || []).filter(
                (item: SyncQueueItem) => item.uploader_id !== this.userId
            );

            if (pending.length > 0) {
                console.log('[P2PSync] Found pending downloads:', pending.length);
                this.downloadQueue.push(...pending);
                this.processDownloadQueue();
            }
        } catch (e) {
            console.error('[P2PSync] Error in checkPendingDownloads:', e);
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
        this.emitProgress({ status: 'idle' });
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

        // Save locally using Tauri if available (Desktop or Android)
        if (isTauri() && data) {
            try {
                const { appDataDir, join } = await import('@tauri-apps/api/path');
                const { writeFile, mkdir, exists } = await import('@tauri-apps/plugin-fs');

                const appData = await appDataDir();
                const syncDir = await join(appData, 'sync_images');

                // Ensure directory exists
                if (!(await exists(syncDir))) {
                    await mkdir(syncDir, { recursive: true });
                }

                const filePath = await join(syncDir, item.file_name);
                const arrayBuffer = await data.arrayBuffer();
                await writeFile(filePath, new Uint8Array(arrayBuffer));

                console.log('[P2PSync] Saved to:', filePath);
            } catch (fsError) {
                console.error('[P2PSync] Filesystem error:', fsError);
                // On web or error, we can still mark as synced
            }
        } else if (data) {
            // Web fallback: trigger download
            const url = URL.createObjectURL(data);
            const a = document.createElement('a');
            a.href = url;
            a.download = item.file_name;
            a.click();
            URL.revokeObjectURL(url);
            console.log('[P2PSync] Triggered browser download for:', item.file_name);
        }

        // Mark as synced in database
        const updatedSyncedBy = [...item.synced_by, this.userId];
        const { error: updateError } = await supabase
            .from('sync_queue')
            .update({ synced_by: updatedSyncedBy })
            .eq('id', item.id);

        if (updateError) {
            console.error('[P2PSync] Failed to mark as synced:', updateError);
        } else {
            console.log('[P2PSync] Marked as synced:', item.file_name);
        }
    }

    /**
     * Upload a file to the sync queue for other users
     */
    async uploadFile(file: File): Promise<boolean> {
        if (!isSupabaseConfigured || !this.workspaceId || !this.userId) {
            console.error('[P2PSync] Not initialized');
            return false;
        }

        this.emitProgress({
            status: 'uploading',
            currentFile: file.name
        });

        try {
            // Generate unique storage path
            const timestamp = Date.now();
            const storagePath = `${this.workspaceId}/${timestamp}_${file.name}`;

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
            const { error: insertError } = await supabase
                .from('sync_queue')
                .insert({
                    uploader_id: this.userId,
                    workspace_id: this.workspaceId,
                    file_name: file.name,
                    storage_path: storagePath,
                    file_size: file.size,
                    synced_by: [this.userId]
                });

            if (insertError) {
                console.error('[P2PSync] Queue insert error:', insertError);
                // Try to clean up uploaded file
                await supabase.storage.from('temp_sync').remove([storagePath]);
                this.emitProgress({ status: 'error', error: insertError.message });
                return false;
            }

            console.log('[P2PSync] Upload complete:', file.name);
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
    async uploadFromPath(filePath: string): Promise<boolean> {
        if (!isTauri()) {
            console.warn('[P2PSync] uploadFromPath only works in Tauri');
            return false;
        }

        if (!isSupabaseConfigured || !this.workspaceId || !this.userId) {
            console.error('[P2PSync] Not initialized');
            return false;
        }

        try {
            const { readFile } = await import('@tauri-apps/plugin-fs');
            const { basename } = await import('@tauri-apps/api/path');

            // Read the file from disk
            const fileData = await readFile(filePath);
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

            // Use existing uploadFile method
            return await this.uploadFile(file);
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
     * Emit progress to all listeners
     */
    private emitProgress(progress: SyncProgress): void {
        this.currentProgress = progress;
        this.listeners.forEach((listener) => listener(progress));
        // Also emit as DOM event for non-React consumers
        window.dispatchEvent(
            new CustomEvent('p2p-sync-progress', { detail: progress })
        );
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
