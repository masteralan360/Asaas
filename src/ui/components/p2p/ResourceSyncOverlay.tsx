import { useEffect, useState } from 'react';
import { assetManager, AssetProgress } from '@/lib/assetManager';
import { isMobile, isTauri } from '@/lib/platform';
import { useWorkspace } from '@/workspace';
import { Loader2, AlertTriangle, DoorOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/ui/components';

const FORCE_ENTER_DELAY_MS = 5000;

export function ResourceSyncOverlay() {
    const { isLocalMode } = useWorkspace();
    const isTauriApp = isTauri();

    const [isVisible, setIsVisible] = useState(false);
    const [status, setStatus] = useState<AssetProgress['status']>('idle');
    const [current, setCurrent] = useState(0);
    const [total, setTotal] = useState(0);
    const [currentFile, setCurrentFile] = useState<string | undefined>(undefined);
    const [error, setError] = useState<string | undefined>(undefined);
    const [forceEnterVisible, setForceEnterVisible] = useState(false);
    const [forceEnterPending, setForceEnterPending] = useState(false);

    useEffect(() => {
        if (!isTauriApp) return;

        // Subscribe to sync status
        const handleProgress = (progress: AssetProgress) => {
            const snapshot = assetManager.getProgress();
            setIsVisible(!!snapshot.isInitialSync);
            setStatus(progress.status);
            if (typeof progress.current === 'number') setCurrent(progress.current);
            if (typeof progress.total === 'number') setTotal(progress.total);
            if (progress.currentFile) setCurrentFile(progress.currentFile);
            if (progress.error) {
                setError(progress.error);
            } else if (progress.status !== 'error') {
                setError(undefined);
            }
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
    }, [isTauriApp]);

    useEffect(() => {
        if (!isVisible) {
            setForceEnterVisible(false);
            setForceEnterPending(false);
            return;
        }

        if (forceEnterPending) return;

        const timer = setTimeout(() => setForceEnterVisible(true), FORCE_ENTER_DELAY_MS);
        return () => clearTimeout(timer);
    }, [isVisible, forceEnterPending]);

    // PWA/Web assets load live from R2. Local Mode is a final UI safeguard in
    // case a stale startup snapshot ever starts a resource sync incorrectly.
    if (!isTauriApp || isLocalMode || !isVisible) return null;

    const isMobileDevice = isMobile();
    const isFailed = status === 'error';

    const handleForceEnter = () => {
        setForceEnterPending(true);
        assetManager.requestForceEnter();
    };

    const statusText = isFailed
        ? 'Could not sync workspace resources.'
        : status === 'scanning'
            ? 'Scanning for assets...'
            : status === 'downloading'
                ? total > 0
                    ? `Downloading resources... (${current}/${total})`
                    : 'Downloading resources...'
                : forceEnterPending
                    ? 'Finishing current sync...'
                    : 'Starting sync...';

    return (
        <div
            aria-labelledby="resource-sync-title"
            aria-modal="true"
            className={cn(
                "fixed inset-0 z-[200] flex flex-col items-center justify-center pointer-events-auto transition-all duration-300",
                isMobileDevice
                    ? "bg-background" // Solid for mobile
                    : "bg-background/80 backdrop-blur-md" // Blurred transparent for desktop
            )}
            role="dialog"
            onPointerDown={(event) => event.stopPropagation()}
        >
            <div
                className="relative z-10 flex flex-col items-center gap-6 p-8 pointer-events-auto animate-in fade-in zoom-in-95 duration-300"
                onPointerDown={(event) => event.stopPropagation()}
            >
                <div className="relative">
                    <div className="absolute inset-0 bg-primary/20 blur-xl rounded-full" />
                    {isFailed ? (
                        <AlertTriangle className="w-12 h-12 text-destructive relative z-10" />
                    ) : (
                        <Loader2 className="w-12 h-12 animate-spin text-primary relative z-10" />
                    )}
                </div>

                <div className="text-center space-y-2 w-full max-w-sm">
                    <h2 id="resource-sync-title" className="text-2xl font-bold tracking-tight">Syncing Workspace</h2>
                    <p className={cn("pb-4", isFailed ? "text-destructive" : "text-muted-foreground")}>
                        {statusText}
                    </p>

                    {currentFile && status === 'downloading' && (
                        <div className="text-xs text-muted-foreground break-all">
                            {currentFile}
                        </div>
                    )}

                    {isFailed ? (
                        <>
                            <div className="text-xs text-muted-foreground animate-pulse">
                                {error || 'The sync could not be completed.'}
                            </div>
                            <div className="flex gap-2 justify-center pt-4">
                                <Button allowViewer onClick={() => assetManager.retryColdStartSync()} size="sm" type="button">
                                    Retry
                                </Button>
                                <Button allowViewer variant="outline" size="sm" type="button" onClick={() => assetManager.dismissInitialSync()}>
                                    Continue anyway
                                </Button>
                            </div>
                        </>
                    ) : forceEnterPending ? (
                        <div className="text-xs text-muted-foreground animate-pulse">
                            Force enter requested — finishing current sync, then entering the app...
                        </div>
                    ) : forceEnterVisible ? (
                        <Button allowViewer variant="outline" size="sm" type="button" onClick={handleForceEnter}>
                            <DoorOpen className="w-4 h-4 mr-2" />
                            Force Enter
                        </Button>
                    ) : (
                        <div className="text-xs text-muted-foreground animate-pulse">
                            This may take a moment on first load
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
