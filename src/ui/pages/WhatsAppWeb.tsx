import { useEffect, useRef, useState } from 'react'
import { whatsappManager } from '@/lib/whatsappWebviewManager'
import { Loader2, MessageSquare, RotateCw } from 'lucide-react'
import { Button } from '@/ui/components/button'

export default function WhatsAppWeb() {
    const containerRef = useRef<HTMLDivElement>(null);
    const [status, setStatus] = useState('Loading...');
    const [isEnabled, setIsEnabled] = useState(whatsappManager.isEnabled());

    useEffect(() => {
        let isUnmounted = false;
        let animationFrameId: number | null = null;
        let burstFrameId: number | null = null;
        let burstUntil = 0;
        let resizeObserver: ResizeObserver | null = null;

        setStatus('Loading...');

        const syncPosition = async () => {
            if (!containerRef.current || !whatsappManager.isActive()) {
                return;
            }

            const rect = containerRef.current.getBoundingClientRect();
            await whatsappManager.updatePosition(rect.x, rect.y, rect.width, rect.height);
        };

        const scheduleSync = () => {
            if (animationFrameId !== null) {
                return;
            }

            animationFrameId = window.requestAnimationFrame(() => {
                animationFrameId = null;
                void syncPosition();
            });
        };

        const startSyncBurst = (durationMs: number) => {
            burstUntil = Math.max(burstUntil, performance.now() + durationMs);
            if (burstFrameId !== null) {
                return;
            }

            const tick = () => {
                scheduleSync();

                if (performance.now() < burstUntil) {
                    burstFrameId = window.requestAnimationFrame(tick);
                } else {
                    burstFrameId = null;
                }
            };

            burstFrameId = window.requestAnimationFrame(tick);
        };

        const initWebview = async () => {
            if (!containerRef.current) return;

            const rect = containerRef.current.getBoundingClientRect();

            console.log('[WhatsApp] Container bounds:', rect.x, rect.y, rect.width, rect.height);

            // Get or create the persistent webview
            const webview = await whatsappManager.getOrCreate(
                rect.x, rect.y, rect.width, rect.height
            );

            if (webview && !isUnmounted) {
                await whatsappManager.show();
                setStatus('');
                scheduleSync();
                startSyncBurst(900);
            } else if (!isUnmounted) {
                setStatus('Failed to load');
            }
        };

        // Delay to ensure layout is ready
        const bootTimer = setTimeout(initWebview, 200);

        if (containerRef.current && typeof ResizeObserver !== 'undefined') {
            resizeObserver = new ResizeObserver(() => {
                scheduleSync();
                startSyncBurst(250);
            });
            resizeObserver.observe(containerRef.current);
        }

        window.addEventListener('resize', scheduleSync);
        window.addEventListener('scroll', scheduleSync, true);
        document.addEventListener('transitionend', scheduleSync, true);

        return () => {
            isUnmounted = true;
            clearTimeout(bootTimer);
            if (animationFrameId !== null) {
                window.cancelAnimationFrame(animationFrameId);
            }
            if (burstFrameId !== null) {
                window.cancelAnimationFrame(burstFrameId);
            }
            resizeObserver?.disconnect();
            window.removeEventListener('resize', scheduleSync);
            window.removeEventListener('scroll', scheduleSync, true);
            document.removeEventListener('transitionend', scheduleSync, true);

            // HIDE when unmounting or toggling off
            void whatsappManager.hide();
        };
    }, [isEnabled]); // REDUCED: The one true source of initialization logic

    // Separate effect for state sync
    useEffect(() => {
        const handleStatusChange = (e: any) => {
            const nowEnabled = e.detail.enabled;
            console.log(`[WhatsApp Page] Status event received: ${nowEnabled}`);
            setIsEnabled(nowEnabled);
        };
        window.addEventListener('whatsapp-enabled-change', handleStatusChange);
        return () => window.removeEventListener('whatsapp-enabled-change', handleStatusChange);
    }, []);

    if (!isEnabled) {
        return (
            <div className="w-full h-full flex flex-col items-center justify-center bg-background p-8 text-center bg-secondary/5">
                <div className="max-w-md space-y-6 animate-in fade-in zoom-in duration-500">
                    <div className="w-20 h-20 rounded-3xl bg-red-500/10 flex items-center justify-center mx-auto border border-red-500/20 shadow-lg">
                        <MessageSquare className="w-10 h-10 text-red-500" />
                    </div>
                    <div className="space-y-2">
                        <h2 className="text-2xl font-bold tracking-tight">WhatsApp is Off</h2>
                        <p className="text-muted-foreground">
                            The WhatsApp webview is currently disabled for this session. Use the toggle in the top bar to turn it back on.
                        </p>
                    </div>
                    <Button
                        variant="outline"
                        onClick={() => whatsappManager.setEnabled(true)}
                        className="rounded-xl border-emerald-500/20 text-emerald-500 hover:bg-emerald-500/5 px-8"
                    >
                        <RotateCw className="w-4 h-4 mr-2" />
                        Turn On Now
                    </Button>
                </div>
            </div>
        )
    }

    return (
        // Use fixed dimensions that match the content area layout
        <div
            ref={containerRef}
            className="w-full h-full flex items-center justify-center overflow-hidden"
            style={{ marginTop: 0, marginLeft: 0 }}
        >
            {status && (
                <div className="text-center animate-pulse opacity-50 flex flex-col items-center gap-3">
                    <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
                    <p className="text-xs font-semibold tracking-widest uppercase text-muted-foreground">
                        {status}
                    </p>
                </div>
            )}
        </div>
    )
}
