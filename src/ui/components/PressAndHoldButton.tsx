import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { Button, type ButtonProps } from '@/ui/components/button'
import {
    getPressAndHoldProgress,
    isShortPress,
    WORKSPACE_PAYMENT_HOLD_DURATION_MS
} from '@/lib/pressAndHold'
import {
    playHoldFeedbackComplete,
    startHoldFeedback,
    stopHoldFeedback,
    updateHoldFeedback
} from '@/lib/holdFeedbackAudio'

interface PressAndHoldButtonProps extends Omit<ButtonProps, 'onClick' | 'onSubmit'> {
    onComplete: () => void
    onShortPress?: () => void
    onPressStart?: () => void
    idleLabel: string
    holdingLabel: string
    loadingLabel: string
    icon?: ReactNode
    isLoading?: boolean
    durationMs?: number
    showProgress?: boolean
    progressVariant?: 'fill' | 'ring'
    progressClassName?: string
    soundEnabled?: boolean
    iconOnly?: boolean
}

export function PressAndHoldButton({
    onComplete,
    onShortPress,
    onPressStart,
    idleLabel,
    holdingLabel,
    loadingLabel,
    icon,
    isLoading = false,
    durationMs = WORKSPACE_PAYMENT_HOLD_DURATION_MS,
    showProgress = true,
    progressVariant = 'fill',
    progressClassName,
    soundEnabled = true,
    iconOnly = false,
    disabled,
    className,
    ...buttonProps
}: PressAndHoldButtonProps) {
    const [isHolding, setIsHolding] = useState(false)
    const overlayRef = useRef<HTMLSpanElement | null>(null)
    const progressRingRef = useRef<SVGSVGElement | null>(null)
    const progressRingCircleRef = useRef<SVGCircleElement | null>(null)
    const animationFrameRef = useRef<number | null>(null)
    const pressStartedAtRef = useRef<number | null>(null)
    const completedRef = useRef(false)

    const setProgress = useCallback((progress: number) => {
        if (progressVariant === 'fill' && overlayRef.current) {
            overlayRef.current.style.width = `${progress}%`
        }
        if (progressVariant === 'ring' && progressRingRef.current && progressRingCircleRef.current) {
            progressRingRef.current.style.opacity = progress > 0 ? '1' : '0'
            progressRingCircleRef.current.style.strokeDashoffset = String(100 - progress)
        }
    }, [progressVariant])

    const cancelHold = useCallback(() => {
        if (animationFrameRef.current !== null) {
            window.cancelAnimationFrame(animationFrameRef.current)
            animationFrameRef.current = null
        }
        if (soundEnabled) stopHoldFeedback()
        if (!completedRef.current) {
            setIsHolding(false)
            setProgress(0)
        }
        pressStartedAtRef.current = null
    }, [setProgress, soundEnabled])

    const beginHold = useCallback(() => {
        if (disabled || isLoading || animationFrameRef.current !== null || completedRef.current) {
            return
        }

        onPressStart?.()

        if (soundEnabled) startHoldFeedback()

        const startedAt = performance.now()
        pressStartedAtRef.current = startedAt
        setIsHolding(true)
        setProgress(0)

        const updateProgress = (now: number) => {
            const next = getPressAndHoldProgress(startedAt, now, durationMs)
            setProgress(next.progress)
            if (soundEnabled) updateHoldFeedback(next.progress)

            if (next.complete) {
                animationFrameRef.current = null
                if (completedRef.current) return
                completedRef.current = true
                if (soundEnabled) playHoldFeedbackComplete()
                onComplete()
                return
            }

            animationFrameRef.current = window.requestAnimationFrame(updateProgress)
        }

        animationFrameRef.current = window.requestAnimationFrame(updateProgress)
    }, [disabled, durationMs, isLoading, onComplete, onPressStart, setProgress, soundEnabled])

    const handleShortPress = useCallback(() => {
        if (!completedRef.current && !disabled && !isLoading) {
            onShortPress?.()
        }
    }, [disabled, isLoading, onShortPress])

    const releaseHold = useCallback(() => {
        const startedAt = pressStartedAtRef.current
        const completed = completedRef.current
        const wasSingleClick = startedAt !== null && isShortPress(startedAt, performance.now())

        cancelHold()

        if (!completed && wasSingleClick) {
            handleShortPress()
        }
    }, [cancelHold, handleShortPress])

    useEffect(() => {
        if (!isLoading) {
            completedRef.current = false
            setIsHolding(false)
            setProgress(0)
        }
        if (soundEnabled) stopHoldFeedback()
    }, [isLoading, setProgress, soundEnabled])

    useEffect(() => cancelHold, [cancelHold])

    return (
        <Button
            {...buttonProps}
            type="button"
            allowViewer={true}
            disabled={disabled || isLoading}
            aria-label={idleLabel}
            className={`relative overflow-hidden touch-none select-none ${className ?? ''}`}
            onClick={(event) => event.preventDefault()}
            onPointerDown={(event) => {
                if (disabled || isLoading || event.button !== 0) return
                event.preventDefault()
                event.currentTarget.setPointerCapture(event.pointerId)
                beginHold()
            }}
            onPointerUp={releaseHold}
            onPointerCancel={cancelHold}
            onPointerLeave={cancelHold}
            onKeyDown={(event) => {
                if (disabled || isLoading || event.repeat) return
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    beginHold()
                }
            }}
            onKeyUp={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    releaseHold()
                }
            }}
        >
            {showProgress && progressVariant === 'fill' && (
                <span
                    ref={overlayRef}
                    aria-hidden="true"
                    className="absolute inset-y-0 start-0 bg-white/20"
                    style={{ width: '0%' }}
                />
            )}
            {showProgress && progressVariant === 'ring' && (
                <svg
                    ref={progressRingRef}
                    aria-hidden="true"
                    viewBox="0 0 36 36"
                    className={`pointer-events-none absolute inset-0 z-50 !h-full !w-full !shrink-0 -rotate-90 ${progressClassName ?? ''}`}
                    style={{ opacity: 0 }}
                >
                    <circle
                        ref={progressRingCircleRef}
                        cx="18"
                        cy="18"
                        r="15"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                        strokeLinecap="round"
                        pathLength="100"
                        strokeDasharray="100 100"
                        strokeDashoffset="100"
                    />
                </svg>
            )}
            <span className="relative z-20 flex items-center justify-center gap-2">
                {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                {!iconOnly && (isLoading ? loadingLabel : (
                    <>
                        {icon}
                        {isHolding ? holdingLabel : idleLabel}
                    </>
                ))}
                {!isLoading && iconOnly ? icon : null}
            </span>
        </Button>
    )
}
