import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    Button
} from '@/ui/components'
import { Sparkles, ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ExperimentalNovuModalProps {
    isOpen: boolean
    onClose: () => void
    notificationData?: any
    config?: any
}

/**
 * PHASE 1 EXPERIMENTAL MODAL
 * Now refactored to accept config via props, breaking the circular dependency 
 * with the notification registry.
 */
export function ExperimentalNovuModal({
    isOpen,
    onClose,
    notificationData,
    config
}: ExperimentalNovuModalProps) {

    // Fallback defaults if config isn't provided (safety)
    // Fallback defaults if config isn't provided (safety)
    const effectiveConfig = {
        enabled: false,
        preventOutsideClose: true,
        showDebugInfo: true,
        ...config
    };

    const handleOpenChange = (open: boolean) => {
        // Only allow closing via explicit state change if not prevented
        if (!open && effectiveConfig.preventOutsideClose) return;
        if (!open) onClose();
    }

    return (
        <Dialog open={isOpen} onOpenChange={handleOpenChange}>
            <DialogContent
                // shadcn/Radix specific event handlers to prevent closure
                onPointerDownOutside={(e) => effectiveConfig.preventOutsideClose && e.preventDefault()}
                onEscapeKeyDown={(e) => effectiveConfig.preventOutsideClose && e.preventDefault()}
                className={cn(
                    "max-w-md w-[95vw] sm:w-full overflow-hidden p-0 rounded-[2.5rem]",
                    "dark:bg-zinc-950/90 backdrop-blur-2xl border-zinc-200 dark:border-zinc-800 shadow-2xl animate-in fade-in zoom-in duration-300"
                )}
            >
                <div className="relative p-8 flex flex-col items-center text-center space-y-6">
                    {/* Background Glow */}
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 w-48 h-12 bg-primary/20 blur-[60px] -z-10" />

                    {/* Icon Container */}
                    <div className="relative group">
                        <div className="w-20 h-20 rounded-[2rem] bg-primary/10 flex items-center justify-center border border-primary/20 animate-pulse-subtle">
                            <Sparkles className="w-10 h-10 text-primary" />
                        </div>
                    </div>

                    {/* Content */}
                    <div className="space-y-2">
                        <DialogHeader>
                            <DialogTitle className="text-2xl font-black text-foreground tracking-tight text-center">
                                Experimental Popup Worked!
                            </DialogTitle>
                        </DialogHeader>
                        <p className="text-muted-foreground font-medium text-sm leading-relaxed px-4">
                            This is an experimental modal triggered by a Novu notification event.
                            The system successfully intercepted the message.
                        </p>
                    </div>

                    {/* Debug Info */}
                    {effectiveConfig.showDebugInfo && notificationData && (
                        <div className="w-full bg-muted/30 p-4 rounded-2xl border border-border/50 text-start overflow-hidden">
                            <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-60 block mb-2">
                                Notification Data Trace
                            </span>
                            <pre className="text-[10px] font-mono whitespace-pre-wrap break-all max-h-32 overflow-y-auto custom-scrollbar p-1">
                                {JSON.stringify(notificationData, null, 2)}
                            </pre>
                        </div>
                    )}

                    {/* Actions */}
                    <DialogFooter className="w-full">
                        <Button
                            onClick={onClose}
                            className="w-full h-12 rounded-2xl font-black shadow-lg shadow-primary/20 bg-primary hover:bg-primary/90 border-t border-white/10 flex gap-2 items-center justify-center transition-all active:scale-95"
                        >
                            Continue
                            <ArrowRight className="w-4 h-4" />
                        </Button>
                    </DialogFooter>
                </div>
            </DialogContent>
        </Dialog>
    )
}
