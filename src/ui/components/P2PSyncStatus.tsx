import { useState, useEffect } from 'react';
import { Cloud, CloudDownload, CloudUpload, AlertCircle, Loader2 } from 'lucide-react';
import { assetManager, AssetProgress } from '@/lib/assetManager';
import { cn } from '@/lib/utils';

export function P2PSyncStatus() {
    const [progress, setProgress] = useState<AssetProgress>({ status: 'idle' });

    useEffect(() => {
        const handleProgress = (newProgress: AssetProgress) => {
            setProgress(newProgress);

            // Auto-hide success after 3 seconds
            if (newProgress.status === 'success') {
                setTimeout(() => setProgress({ status: 'idle' }), 3000);
            }
        };

        assetManager.on('progress', handleProgress);
        return () => {
            assetManager.off('progress', handleProgress);
        };
    }, []);

    // Don't render if idle 
    if (progress.status === 'idle') {
        return null;
    }

    const formatFileName = (name?: string) => {
        if (!name) return '';
        const parts = name.split(/[/\\]/);
        return parts[parts.length - 1];
    };

    const getIcon = () => {
        switch (progress.status) {
            case 'uploading':
                return <CloudUpload className="w-4 h-4 animate-pulse" />;
            case 'downloading':
                return <CloudDownload className="w-4 h-4 animate-pulse" />;
            case 'scanning':
                return <Loader2 className="w-4 h-4 animate-spin" />;
            case 'error':
                return <AlertCircle className="w-4 h-4 text-red-500" />;
            case 'success':
                return <Cloud className="w-4 h-4 text-emerald-500" />;
            default:
                return <Cloud className="w-4 h-4" />;
        }
    };

    const getMessage = () => {
        const fileName = formatFileName(progress.currentFile);
        switch (progress.status) {
            case 'uploading':
                return `Uploading ${fileName || 'asset'}...`;
            case 'downloading':
                return `Downloading ${fileName || 'asset'}...`;
            case 'scanning':
                return 'Scanning assets...';
            case 'error':
                return progress.error || 'Sync error';
            case 'success':
                return 'Asset synced';
            default:
                return 'Idle';
        }
    };

    const statusColors: Record<AssetProgress['status'], string> = {
        idle: 'bg-gray-500/10 text-gray-600',
        scanning: 'bg-purple-500/10 text-purple-600',
        uploading: 'bg-blue-500/10 text-blue-600',
        downloading: 'bg-green-500/10 text-green-600',
        error: 'bg-red-500/10 text-red-600',
        success: 'bg-emerald-500/10 text-emerald-600'
    };

    return (
        <div
            className={cn(
                'flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all shadow-sm',
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
    const [progress, setProgress] = useState<AssetProgress>({ status: 'idle' });

    useEffect(() => {
        const handleProgress = (newProgress: AssetProgress) => {
            setProgress(newProgress);
            if (newProgress.status === 'success') {
                setTimeout(() => setProgress({ status: 'idle' }), 3000);
            }
        };
        assetManager.on('progress', handleProgress);
        return () => {
            assetManager.off('progress', handleProgress);
        };
    }, []);

    if (progress.status === 'idle') {
        return null;
    }

    const iconClass = cn(
        'w-4 h-4',
        progress.status === 'error' && 'text-red-500',
        progress.status === 'uploading' && 'text-blue-500 animate-pulse',
        progress.status === 'downloading' && 'text-green-500 animate-pulse',
        progress.status === 'scanning' && 'text-purple-500 animate-spin',
        progress.status === 'success' && 'text-emerald-500'
    );

    const formatFileName = (name?: string) => {
        if (!name) return '';
        const parts = name.split(/[/\\]/);
        return parts[parts.length - 1];
    };

    return (
        <div className="relative group">
            {progress.status === 'uploading' && <CloudUpload className={iconClass} />}
            {progress.status === 'downloading' && <CloudDownload className={iconClass} />}
            {progress.status === 'scanning' && <Loader2 className={iconClass} />}
            {progress.status === 'error' && <AlertCircle className={iconClass} />}
            {progress.status === 'success' && <Cloud className={iconClass} />}

            {/* Tooltip */}
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50">
                {formatFileName(progress.currentFile) || (progress.status.charAt(0).toUpperCase() + progress.status.slice(1))}
            </div>
        </div>
    );
}
