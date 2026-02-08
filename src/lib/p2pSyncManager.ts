/**
 * Deprecated: P2P Sync Manager
 * 
 * This module is now deprecated in favor of lib/assetManager.ts which implements
 * the Database-Driven CDN approach using Cloudflare R2.
 * 
 * Stubs are maintained for backward compatibility during the transition.
 */

export const p2pSyncManager = {
    initialize: () => {
        // No-op - suppressed warning to avoid console noise
    },
    destroy: async () => {
        // No-op
    },
    uploadFromPath: async (_path: string, _persist?: boolean) => {
        console.error('[P2PSyncManager] Deprecated: use assetManager.uploadFromPath instead');
        return null;
    },
    triggerManualDownloadCheck: () => {
        // No-op
    },
    subscribe: (_callback: (status: any) => void) => {
        // Return a dummy unsubscriber
        return () => { };
    },
    getProgress: () => ({
        isInitialSync: false,
        totalPending: 0,
        progress: 100
    })
};
