import * as React from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { CirclePlay } from 'lucide-react'
import { cn } from '@/lib/utils'
import { HintPlayerOverlay } from './HintPlayerOverlay'
import { resolveHintVideoUrl } from './hintVideoUrl'

export interface HoverHintVideoProps {
    /** Video object name under the R2 bucket's hints prefix, or a full URL. */
    src: string
    /** The element that is hovered to reveal the video hint. */
    children: React.ReactNode
    /** Optional heading shown above the preview and under the fullscreen video. */
    title?: string
    /** Delay before the video hint appears (ms). */
    delayDuration?: number
    /** Width of the hover preview (px). */
    width?: number
    triggerClassName?: string
    contentClassName?: string
}

export function HoverHintVideo({
    src,
    children,
    title,
    delayDuration = 300,
    width = 560,
    triggerClassName,
    contentClassName,
}: HoverHintVideoProps) {
    const [open, setOpen] = React.useState(false)
    const [overlayOpen, setOverlayOpen] = React.useState(false)

    const isHoverCapable = React.useMemo(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
        return window.matchMedia('(hover: hover) and (pointer: fine)').matches
    }, [])

    const trigger = (
        <span
            tabIndex={0}
            aria-label={title}
            onClick={() => {
                setOpen(false)
                setOverlayOpen(true)
            }}
            className={cn('relative inline-flex cursor-help outline-none', triggerClassName)}
        >
            {children}
            <CirclePlay className="pointer-events-none absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-background shadow-sm text-primary/80" />
        </span>
    )

    const overlay = (
        <HintPlayerOverlay
            open={overlayOpen}
            onClose={() => setOverlayOpen(false)}
            src={src}
            title={title}
        />
    )

    if (!isHoverCapable) {
        return (
            <>
                {trigger}
                {overlay}
            </>
        )
    }

    return (
        <>
            <TooltipPrimitive.Provider delayDuration={delayDuration}>
                <TooltipPrimitive.Root open={open} onOpenChange={setOpen}>
                    <TooltipPrimitive.Trigger asChild onClick={() => setOpen(false)}>
                        {trigger}
                    </TooltipPrimitive.Trigger>
                    <TooltipPrimitive.Content
                        side="bottom"
                        align="start"
                        sideOffset={8}
                        className={cn(
                            'z-50 overflow-hidden rounded-lg border border-border/60 bg-popover shadow-xl',
                            'animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
                            contentClassName
                        )}
                    >
                        {title && (
                            <div className="flex items-center gap-1.5 border-b border-border/50 bg-muted/30 px-2 py-1">
                                <CirclePlay className="h-3 w-3 shrink-0 text-primary/70" />
                                <span className="truncate text-[11px] font-bold">{title}</span>
                            </div>
                        )}
                        <video
                            src={resolveHintVideoUrl(src)}
                            width={width}
                            autoPlay
                            muted
                            loop
                            playsInline
                            preload="metadata"
                            className="block max-h-[40vh] bg-black object-contain"
                        />
                    </TooltipPrimitive.Content>
                </TooltipPrimitive.Root>
            </TooltipPrimitive.Provider>
            {overlay}
        </>
    )
}
