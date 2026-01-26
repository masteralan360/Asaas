import { useEffect, useRef, useState } from 'react'
import { whatsappManager } from '@/lib/whatsappWebviewManager'
import { Loader2 } from 'lucide-react'

export default function WhatsAppWeb() {
    const containerRef = useRef<HTMLDivElement>(null);
    const [status, setStatus] = useState('Loading...');

    useEffect(() => {
        let isUnmounted = false;

        const initWebview = async () => {
            if (!containerRef.current) return;

            const rect = containerRef.current.getBoundingClientRect();

            console.log('[WhatsApp] Container bounds:', rect.x, rect.y, rect.width, rect.height);

            // Get or create the persistent webview
            const webview = await whatsappManager.getOrCreate(
                rect.x, rect.y, rect.width, rect.height
            );

            if (webview && !isUnmounted) {
                // If this is a fresh JS session (refresh), we might want to reload the webview
                // but usually, re-showing it is enough for persistence. 
                // However, the user explicitly asked for the webview to reload when the app refreshes.
                const isNavigatedRefresh = !localStorage.getItem('whatsapp_session_active');
                if (isNavigatedRefresh) {
                    await whatsappManager.reload();
                    localStorage.setItem('whatsapp_session_active', 'true');
                }

                await whatsappManager.show();
                setStatus('');
            } else if (!isUnmounted) {
                setStatus('Failed to load');
            }
        };

        // Delay to ensure layout is ready
        const bootTimer = setTimeout(initWebview, 200);

        // Sync engine to keep webview positioned correctly
        const syncPosition = async () => {
            if (containerRef.current && whatsappManager.isActive()) {
                const rect = containerRef.current.getBoundingClientRect();
                await whatsappManager.updatePosition(rect.x, rect.y, rect.width, rect.height);
            }
        };

        const syncInterval = setInterval(syncPosition, 100);
        window.addEventListener('resize', syncPosition);

        return () => {
            isUnmounted = true;
            clearTimeout(bootTimer);
            clearInterval(syncInterval);
            window.removeEventListener('resize', syncPosition);

            // HIDE (not destroy) when navigating away
            whatsappManager.hide();
        };
    }, []);

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
