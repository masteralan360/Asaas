import { useEffect, useState } from 'react';
import { p2pSyncManager } from '@/lib/p2pSyncManager';
import { isMobile } from '@/lib/platform';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ProgressWithLabel } from '../progress-with-label';

export function ResourceSyncOverlay() {
    const [isVisible, setIsVisible] = useState(false);
    const [stats, setStats] = useState({ total: 0, pending: 0 });

    useEffect(() => {
        // Subscribe to sync status
        const unsub = p2pSyncManager.subscribe((status) => {
            setIsVisible(!!status.isInitialSync);
            setStats({
                total: status.totalPending || 0,
                pending: status.totalPending || 0
            });
        });

        // Check current status immediately
        const current = p2pSyncManager.getProgress();
        if (current.isInitialSync) {
            setIsVisible(true);
        }

        return unsub;
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
                    <h2 className="text-2xl font-bold tracking-tight">Downloading Resources</h2>
                    <p className="text-muted-foreground pb-4">
                        Syncing workspace assets...
                    </p>

                    <ProgressWithLabel
                        value={stats.total > 0 ? Math.round(((stats.total - stats.pending) / stats.total) * 100) : 0}
                        label="Sync Progress"
                        details={`${stats.total - stats.pending} of ${stats.total} files downloaded`}
                    />
                </div>
            </div>
        </div>
    );
}
