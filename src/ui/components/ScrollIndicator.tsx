import React, { useState, useEffect, useCallback } from 'react'
import { ChevronUp, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ScrollIndicatorProps {
    containerRef: React.RefObject<HTMLDivElement>
    className?: string
}

export function ScrollIndicator({ containerRef, className }: ScrollIndicatorProps) {
    const [showUp, setShowUp] = useState(false)
    const [showDown, setShowDown] = useState(false)
    const [isVisible, setIsVisible] = useState(false)

    const checkScroll = useCallback(() => {
        const el = containerRef.current
        if (!el) return

        const { scrollTop, scrollHeight, clientHeight } = el

        setShowUp(scrollTop > 20)
        setShowDown(scrollTop + clientHeight < scrollHeight - 20)
        setIsVisible(scrollHeight > clientHeight + 10)
    }, [containerRef])

    useEffect(() => {
        const el = containerRef.current
        if (!el) return

        const observer = new ResizeObserver(checkScroll)
        const mutationObserver = new MutationObserver(checkScroll)

        el.addEventListener('scroll', checkScroll)
        observer.observe(el)
        mutationObserver.observe(el, { childList: true, subtree: true })

        // Initial check
        checkScroll()

        return () => {
            el.removeEventListener('scroll', checkScroll)
            observer.disconnect()
            mutationObserver.disconnect()
        }
    }, [containerRef, checkScroll])

    const scrollTo = (direction: 'up' | 'down') => {
        const el = containerRef.current
        if (!el) return

        const scrollAmount = el.clientHeight * 0.8
        el.scrollBy({
            top: direction === 'up' ? -scrollAmount : scrollAmount,
            behavior: 'smooth'
        })
    }

    if (!isVisible) return null

    return (
        <>
            {/* Top Indicator */}
            <div
                className={cn(
                    "absolute top-2 left-1/2 -translate-x-1/2 z-[60] transition-all duration-300 pointer-events-none",
                    showUp ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-4",
                    className
                )}
            >
                <button
                    onClick={() => scrollTo('up')}
                    className="pointer-events-auto p-1.5 rounded-full bg-background/40 backdrop-blur-md border border-border/50 shadow-lg hover:bg-background/80 transition-colors group flex flex-col items-center"
                    title="Scroll Up"
                >
                    <ChevronUp className="w-4 h-4 text-primary animate-bounce" />
                    <span className="text-[8px] font-black uppercase tracking-widest text-primary/60 scale-75 origin-top opacity-0 group-hover:opacity-100 transition-opacity">
                        Up
                    </span>
                </button>
            </div>

            {/* Bottom Indicator */}
            <div
                className={cn(
                    "absolute bottom-4 left-1/2 -translate-x-1/2 z-[60] transition-all duration-300 pointer-events-none",
                    showDown ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4",
                    className
                )}
            >
                <button
                    onClick={() => scrollTo('down')}
                    className="pointer-events-auto p-1.5 rounded-full bg-background/40 backdrop-blur-md border border-border/50 shadow-lg hover:bg-background/80 transition-colors group flex flex-col items-center"
                    title="Scroll Down"
                >
                    <span className="text-[8px] font-black uppercase tracking-widest text-primary/60 scale-75 origin-bottom opacity-0 group-hover:opacity-100 transition-opacity">
                        More
                    </span>
                    <ChevronDown className="w-4 h-4 text-primary animate-bounce" />
                </button>
            </div>
        </>
    )
}
