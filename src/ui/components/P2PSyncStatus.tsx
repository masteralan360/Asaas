/**
 * P2P Sync Status Indicator
 *
 * Displays upload/download progress for workspace file synchronization.
 */

import { useState, useEffect } from 'react';
import { Cloud, CloudDownload, CloudUpload, AlertCircle } from 'lucide-react';
import { p2pSyncManager, SyncProgress } from '@/lib/p2pSyncManager';
import { cn } from '@/lib/utils';

export function P2PSyncStatus() {
    const [progress, setProgress] = useState<SyncProgress>({ status: 'idle' });

    useEffect(() => {
        const unsubscribe = p2pSyncManager.subscribe(setProgress);
        return () => unsubscribe();
    }, []);

    // Don't render if idle
    if (progress.status === 'idle') {
        return null;
    }

    const getIcon = () => {
        switch (progress.status) {
            case 'uploading':
                return <CloudUpload className="w-4 h-4 animate-pulse" />;
            case 'downloading':
                return <CloudDownload className="w-4 h-4 animate-pulse" />;
            case 'error':
                return <AlertCircle className="w-4 h-4" />;
            default:
                return <Cloud className="w-4 h-4" />;
        }
    };

    const getMessage = () => {
        switch (progress.status) {
            case 'uploading':
                return `Uploading ${progress.currentFile || 'file'}...`;
            case 'downloading':
                return progress.totalPending && progress.totalPending > 1
                    ? `Downloading ${progress.totalPending} files...`
                    : `Downloading ${progress.currentFile || 'file'}...`;
            case 'error':
                return progress.error || 'Sync error';
            default:
                return 'Synced';
        }
    };

    const statusColors: Record<SyncProgress['status'], string> = {
        idle: 'bg-gray-500/10 text-gray-600',
        uploading: 'bg-blue-500/10 text-blue-600',
        downloading: 'bg-green-500/10 text-green-600',
        error: 'bg-red-500/10 text-red-600'
    };

    return (
        <div
            className={cn(
                'flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all',
                statusColors[progress.status]
            )}
        >
            {getIcon()}
            <span className="max-w-[150px] truncate">{getMessage()}</span>
        </div>
    );
}

/**
 * Compact version for header/footer use
 */
export function P2PSyncIndicator() {
    const [progress, setProgress] = useState<SyncProgress>({ status: 'idle' });

    useEffect(() => {
        const unsubscribe = p2pSyncManager.subscribe(setProgress);
        return () => unsubscribe();
    }, []);

    if (progress.status === 'idle') {
        return null;
    }

    const iconClass = cn(
        'w-4 h-4',
        progress.status === 'error' && 'text-red-500',
        progress.status === 'uploading' && 'text-blue-500 animate-pulse',
        progress.status === 'downloading' && 'text-green-500 animate-pulse'
    );

    return (
        <div className="relative group">
            {progress.status === 'uploading' && <CloudUpload className={iconClass} />}
            {progress.status === 'downloading' && <CloudDownload className={iconClass} />}
            {progress.status === 'error' && <AlertCircle className={iconClass} />}

            {/* Tooltip */}
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                {progress.currentFile || progress.status}
                {progress.totalPending && progress.totalPending > 1 && (
                    <span> ({progress.totalPending} pending)</span>
                )}
            </div>
        </div>
    );
}
