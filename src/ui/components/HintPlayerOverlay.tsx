import * as React from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { resolveHintVideoUrl } from './hintVideoUrl'

export interface HintPlayerOverlayProps {
    open: boolean
    onClose: () => void
    /** Video file under public/tips, or a full URL. */
    src: string
    /** Optional heading shown under the video. */
    title?: string
    /** Accessible label for the close button. */
    closeLabel?: string
}

export function HintPlayerOverlay({
    open,
    onClose,
    src,
    title,
    closeLabel = 'Close',
}: HintPlayerOverlayProps) {
    React.useEffect(() => {
        if (!open) return
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose()
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [open, onClose])

    if (!open) return null

    const overlay = (
        <div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            onClick={onClose}
            className={cn(
                'fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-black/85 p-4 backdrop-blur-sm',
                'animate-in fade-in-0 duration-200'
            )}
        >
            <button
                type="button"
                onClick={(event) => {
                    event.stopPropagation()
                    onClose()
                }}
                aria-label={closeLabel}
                className="absolute right-4 top-4 rtl:right-auto rtl:left-4 rounded-full bg-white/10 p-2.5 text-white transition-colors hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
            >
                <X className="h-6 w-6" />
            </button>
            <div
                className="relative w-full max-w-6xl"
                onClick={(event) => event.stopPropagation()}
            >
                <video
                    src={resolveHintVideoUrl(src)}
                    autoPlay
                    muted
                    loop
                    controls
                    playsInline
                    preload="auto"
                    className="max-h-[88vh] w-full rounded-2xl border border-white/10 bg-black object-contain shadow-2xl"
                />
                {title && (
                    <p className="mt-4 text-center text-sm font-bold text-white/90">{title}</p>
                )}
            </div>
        </div>
    )

    return createPortal(overlay, document.body)
}
