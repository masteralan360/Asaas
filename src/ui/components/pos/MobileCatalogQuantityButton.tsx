import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import {
    getMobileCatalogQuantityRepeatDelay,
    MOBILE_CATALOG_QUANTITY_CANCEL_DISTANCE_PX,
    MOBILE_CATALOG_QUANTITY_HOLD_DELAY_MS
} from '@/lib/mobileCatalogQuantityPress'
import { cn } from '@/lib/utils'
import { Button } from '@/ui/components/button'

interface MobileCatalogQuantityButtonProps {
    ariaLabel: string
    children: ReactNode
    className?: string
    disabled?: boolean
    onAdjust: () => void
}

/**
 * Shared by the mobile catalogue and cart. A normal tap adjusts once. A touch
 * held for one second repeats one-unit adjustments, accelerating while it
 * remains held. Moving far enough to scroll cancels both the pending repeat
 * and the eventual click.
 */
export function MobileCatalogQuantityButton({
    ariaLabel,
    children,
    className,
    disabled = false,
    onAdjust
}: MobileCatalogQuantityButtonProps) {
    const onAdjustRef = useRef(onAdjust)
    const holdDelayTimeoutRef = useRef<number | null>(null)
    const repeatTimeoutRef = useRef<number | null>(null)
    const activePointerIdRef = useRef<number | null>(null)
    const holdStartedAtRef = useRef(0)
    const touchStartRef = useRef({ x: 0, y: 0 })
    const didRepeatRef = useRef(false)
    const suppressClickRef = useRef(false)

    useEffect(() => {
        onAdjustRef.current = onAdjust
    }, [onAdjust])

    const clearTimers = useCallback(() => {
        if (holdDelayTimeoutRef.current !== null) {
            window.clearTimeout(holdDelayTimeoutRef.current)
            holdDelayTimeoutRef.current = null
        }
        if (repeatTimeoutRef.current !== null) {
            window.clearTimeout(repeatTimeoutRef.current)
            repeatTimeoutRef.current = null
        }
    }, [])

    const stopHolding = useCallback(() => {
        clearTimers()
        activePointerIdRef.current = null
    }, [clearTimers])

    const startRepeating = useCallback(() => {
        const repeat = () => {
            if (activePointerIdRef.current === null || disabled) return

            didRepeatRef.current = true
            onAdjustRef.current()

            const elapsedMs = performance.now() - holdStartedAtRef.current
            repeatTimeoutRef.current = window.setTimeout(repeat, getMobileCatalogQuantityRepeatDelay(elapsedMs))
        }

        repeat()
    }, [disabled])

    const cancelForScroll = useCallback(() => {
        suppressClickRef.current = true
        didRepeatRef.current = false
        stopHolding()
    }, [stopHolding])

    const releasePointer = (event: ReactPointerEvent<HTMLButtonElement>) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId)
        }
    }

    const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
        // Long-repeat is intentionally touch-only. Mouse clicks and keyboard
        // activation retain their ordinary, one-step button behaviour.
        if (disabled || event.pointerType !== 'touch' || event.button !== 0) return

        suppressClickRef.current = false
        didRepeatRef.current = false
        activePointerIdRef.current = event.pointerId
        holdStartedAtRef.current = performance.now()
        touchStartRef.current = { x: event.clientX, y: event.clientY }
        event.currentTarget.setPointerCapture(event.pointerId)

        holdDelayTimeoutRef.current = window.setTimeout(() => {
            holdDelayTimeoutRef.current = null
            if (activePointerIdRef.current === event.pointerId) {
                startRepeating()
            }
        }, MOBILE_CATALOG_QUANTITY_HOLD_DELAY_MS)
    }

    const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
        if (event.pointerId !== activePointerIdRef.current) return

        const movedX = Math.abs(event.clientX - touchStartRef.current.x)
        const movedY = Math.abs(event.clientY - touchStartRef.current.y)
        if (Math.max(movedX, movedY) >= MOBILE_CATALOG_QUANTITY_CANCEL_DISTANCE_PX) {
            cancelForScroll()
            releasePointer(event)
        }
    }

    const handlePointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
        if (event.pointerId !== activePointerIdRef.current) return

        const didRepeat = didRepeatRef.current
        stopHolding()
        releasePointer(event)
        if (didRepeat) {
            suppressClickRef.current = true
        }
    }

    const handlePointerCancel = (event: ReactPointerEvent<HTMLButtonElement>) => {
        if (event.pointerId !== activePointerIdRef.current) return
        stopHolding()
        didRepeatRef.current = false
        // Browsers send pointercancel when a touch turns into a page scroll.
        // Suppress a possible compatibility click in that case.
        suppressClickRef.current = true
        releasePointer(event)
    }

    useEffect(() => {
        if (disabled) stopHolding()
    }, [disabled, stopHolding])

    useEffect(() => stopHolding, [stopHolding])

    return (
        <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={ariaLabel}
            disabled={disabled}
            className={cn('h-8 w-8 touch-pan-y select-none rounded-xl hover:bg-background', className)}
            onClick={(event) => {
                event.stopPropagation()
                if (suppressClickRef.current) {
                    suppressClickRef.current = false
                    event.preventDefault()
                    return
                }
                onAdjust()
            }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
        >
            {children}
        </Button>
    )
}
