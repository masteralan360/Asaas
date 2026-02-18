import { useEffect, useState } from 'react';
import { assetManager, AssetProgress } from '@/lib/assetManager';
import { isMobile, isTauri } from '@/lib/platform';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export function ResourceSyncOverlay() {
    // PWA/Web: never show sync overlay, assets load live from R2
    if (!isTauri()) return null;

    const [isVisible, setIsVisible] = useState(false);
    const [status, setStatus] = useState<AssetProgress['status']>('idle');

    useEffect(() => {
        // Subscribe to sync status
        const handleProgress = (progress: AssetProgress) => {
            const current = assetManager.getProgress();
            setIsVisible(!!current.isInitialSync);
            setStatus(progress.status);
        };

        assetManager.on('progress', handleProgress);

        // Check current status immediately
        const current = assetManager.getProgress();
        if (current.isInitialSync) {
            setIsVisible(true);
        }

        return () => {
            assetManager.off('progress', handleProgress);
        };
    }, []);

    if (!isVisible) return null;

    const isMobileDevice = isMobile();

    return (
        <div className={cn(
            "fixed inset-0 z-[100] flex flex-col items-center justify-center transition-all duration-300",
            isMobileDevice
                ? "bg-background" // Solid for mobile
                : "bg-background/80 backdrop-blur-md" // Blurred transparent for desktop
        )}>
            <div className="flex flex-col items-center gap-6 p-8 animate-in fade-in zoom-in-95 duration-300">
                <div className="relative">
                    <div className="absolute inset-0 bg-primary/20 blur-xl rounded-full" />
                    <Loader2 className="w-12 h-12 animate-spin text-primary relative z-10" />
                </div>

                <div className="text-center space-y-2 w-full max-w-sm">
                    <h2 className="text-2xl font-bold tracking-tight">Syncing Workspace</h2>
                    <p className="text-muted-foreground pb-4">
                        {status === 'scanning' ? 'Scanning for assets...' : 'Downloading resources...'}
                    </p>

                    <div className="text-xs text-muted-foreground animate-pulse">
                        This may take a moment on first load
                    </div>
                </div>
            </div>
        </div>
    );
}
