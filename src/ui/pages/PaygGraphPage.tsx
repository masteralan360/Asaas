import { useEffect, useId, useState, type PointerEvent } from 'react'
import {
    ArrowLeftRight,
    Calculator,
    Info,
    LineChart,
    LockKeyhole,
    MapPin,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/ui/components/button'
import { useFavicon } from '@/hooks/useFavicon'
import {
    DEFAULT_PAYG_PRICING_CHECKPOINTS,
    type PaygPricingCheckpoint,
} from '@/lib/paygPricing'
import {
    calculatePaygPreviewAmount,
    calculatePaygPreviewGb,
    formatPaygCalculatorInput,
    getPaygGraphHoverGb,
    parsePaygCalculatorInput,
    PAYG_GRAPH,
    PAYG_MOBILE_GRAPH,
} from './paygGraphPageModel'

const DISPLAYED_PRICING_VERSION = 1
const DISPLAYED_PUBLISHED_AT = new Date('2026-09-01T03:24:00.000Z')
const MOBILE_GRAPH_MEDIA_QUERY = '(max-width: 639px)'

function useMobileGraphLayout() {
    const [isMobileLayout, setIsMobileLayout] = useState(() => (
        typeof window !== 'undefined'
        && window.matchMedia(MOBILE_GRAPH_MEDIA_QUERY).matches
    ))

    useEffect(() => {
        const mediaQuery = window.matchMedia(MOBILE_GRAPH_MEDIA_QUERY)
        const syncLayout = () => setIsMobileLayout(mediaQuery.matches)

        syncLayout()
        mediaQuery.addEventListener('change', syncLayout)
        return () => mediaQuery.removeEventListener('change', syncLayout)
    }, [])

    return isMobileLayout
}

function formatPaymentNumber(value?: string | number | null): string {
    if (value === null || value === undefined || value === '') return '0'

    const source = String(value)
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return source

    const wholePart = source.replace(/^[-+]/, '').split('.')[0] ?? '0'
    if (wholePart.length > 15 || !Number.isSafeInteger(Math.trunc(parsed))) {
        return source
    }

    return new Intl.NumberFormat(undefined, {
        maximumFractionDigits: 6,
    }).format(parsed)
}

function PricingCalculator({ checkpoints }: { checkpoints: PaygPricingCheckpoint[] }) {
    const { t } = useTranslation()
    const inputId = useId()
    const [direction, setDirection] = useState<'gbToIqd' | 'iqdToGb'>('gbToIqd')
    const [input, setInput] = useState('')
    const fromGb = direction === 'gbToIqd'
    const value = parsePaygCalculatorInput(input)
    const result = value === null
        ? null
        : fromGb
            ? calculatePaygPreviewAmount(value, checkpoints)
            : calculatePaygPreviewGb(value, checkpoints)
    const invalidInput = input !== '' && result === null
    const helpId = `${inputId}-help`
    const errorId = `${inputId}-error`

    const swapDirection = () => {
        setDirection(fromGb ? 'iqdToGb' : 'gbToIqd')
        setInput(result === null
            ? ''
            : formatPaygCalculatorInput(String(Number(result.toFixed(6)))) ?? '')
    }

    return (
        <section
            className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-3"
            aria-labelledby={`${inputId}-title`}
        >
            <h3 id={`${inputId}-title`} className="flex items-center gap-2 text-sm font-semibold">
                <Calculator className="h-4 w-4 text-amber-600" aria-hidden="true" />
                {t('paygGraphPage.calculator.title')}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
                {t('paygGraphPage.calculator.description')}
            </p>
            <div className="mt-3 grid items-end gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
                <div className="min-w-0">
                    <label htmlFor={inputId} className="text-xs font-medium text-muted-foreground">
                        {t(fromGb
                            ? 'paygGraphPage.calculator.usageInput'
                            : 'paygGraphPage.calculator.amountInput')}
                    </label>
                    <input
                        id={inputId}
                        type="text"
                        inputMode={fromGb ? 'decimal' : 'numeric'}
                        dir="ltr"
                        autoComplete="off"
                        placeholder="0"
                        required
                        value={input}
                        aria-invalid={invalidInput}
                        aria-describedby={`${helpId}${invalidInput ? ` ${errorId}` : ''}`}
                        onChange={(event) => {
                            const formatted = formatPaygCalculatorInput(event.target.value)
                            if (formatted !== null) setInput(formatted)
                        }}
                        className="mt-1 h-10 w-full rounded-lg border bg-background px-3 text-base font-semibold tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-amber-500 aria-[invalid=true]:border-destructive"
                    />
                </div>
                <Button
                    type="button"
                    variant="outline"
                    allowViewer
                    className="h-10 justify-self-center px-3"
                    onClick={swapDirection}
                    aria-label={t(fromGb
                        ? 'paygGraphPage.calculator.swapToIqd'
                        : 'paygGraphPage.calculator.swapToGb')}
                    title={t(fromGb
                        ? 'paygGraphPage.calculator.swapToIqd'
                        : 'paygGraphPage.calculator.swapToGb')}
                >
                    <ArrowLeftRight aria-hidden="true" />
                    {t('paygGraphPage.calculator.swap')}
                </Button>
                <div className="min-w-0">
                    <span id={`${inputId}-result-label`} className="text-xs font-medium text-muted-foreground">
                        {t(fromGb
                            ? 'paygGraphPage.calculator.chargeOutput'
                            : 'paygGraphPage.calculator.usageOutput')}
                    </span>
                    <output
                        htmlFor={inputId}
                        aria-labelledby={`${inputId}-result-label`}
                        aria-live="polite"
                        className="mt-1 flex min-h-10 items-center break-all rounded-lg border border-amber-500/25 bg-background px-3 py-2 text-base font-semibold tabular-nums"
                    >
                        {result === null
                            ? t('paygGraphPage.calculator.emptyResult')
                            : t(fromGb ? 'paygGraphPage.iqdValue' : 'paygGraphPage.gbValue', {
                                value: formatPaymentNumber(result),
                            })}
                    </output>
                </div>
            </div>
            {invalidInput ? (
                <p id={errorId} role="status" className="mt-2 text-xs text-destructive">
                    {t(fromGb
                        ? 'paygGraphPage.calculator.invalidGb'
                        : 'paygGraphPage.calculator.invalidIqd')}
                </p>
            ) : null}
            <p id={helpId} className="mt-2 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {t(fromGb
                    ? 'paygGraphPage.calculator.forwardHint'
                    : 'paygGraphPage.calculator.reverseHint')}
            </p>
        </section>
    )
}

function PricingGraph({ checkpoints }: { checkpoints: PaygPricingCheckpoint[] }) {
    const { t } = useTranslation()
    const tooltipId = useId()
    const [hoveredGb, setHoveredGb] = useState<number | null>(null)
    const [focusedGb, setFocusedGb] = useState<number | null>(null)
    const isMobileLayout = useMobileGraphLayout()
    const graph = isMobileLayout ? PAYG_MOBILE_GRAPH : PAYG_GRAPH
    const { width, height, left, right, top, bottom } = graph
    const axisLabelClass = isMobileLayout
        ? 'fill-muted-foreground text-[8px]'
        : 'fill-muted-foreground text-[4px]'
    const pointLabelClass = isMobileLayout
        ? 'fill-muted-foreground text-[9px]'
        : 'fill-muted-foreground text-[4.5px]'
    const sorted = [...checkpoints].sort((first, second) => first.gb - second.gb)
    const coordinates = sorted.map((point) => ({
        ...point,
        x: left + point.gb / 100 * (right - left),
        y: bottom - point.amountIqd / 40_000 * (bottom - top),
    }))
    const activeGb = hoveredGb ?? focusedGb
    const activeCheckpoint = coordinates.find((point) => point.gb === activeGb)
    const activeAmount = activeGb === null
        ? null
        : calculatePaygPreviewAmount(activeGb, checkpoints)
    const active = activeAmount === null
        ? null
        : {
            gb: activeGb!,
            amountIqd: activeAmount,
            x: left + activeGb! / 100 * (right - left),
            y: bottom - activeAmount / 40_000 * (bottom - top),
        }
    const line = coordinates.map(({ x, y }) => `${x},${y}`).join(' ')
    const area = coordinates.length
        ? `${left},${bottom} ${line} ${coordinates.at(-1)!.x},${bottom}`
        : ''

    const showColumn = (event: PointerEvent<SVGSVGElement>) => {
        const bounds = event.currentTarget.getBoundingClientRect()
        setHoveredGb(getPaygGraphHoverGb(
            (event.clientX - bounds.left) / bounds.width * width,
            (event.clientY - bounds.top) / bounds.height * height,
            graph,
        ))
    }

    const startTouchInteraction = (event: PointerEvent<SVGSVGElement>) => {
        if (event.pointerType !== 'mouse') {
            event.currentTarget.setPointerCapture(event.pointerId)
        }
        showColumn(event)
    }

    const finishTouchInteraction = (event: PointerEvent<SVGSVGElement>) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId)
        }
    }

    return (
        <div className="rounded-xl border border-border bg-background p-2">
            <div
                className="relative"
                onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                        setHoveredGb(null)
                        setFocusedGb(null)
                    }
                }}
            >
                <svg
                    viewBox={`0 0 ${width} ${height}`}
                    className="h-auto w-full touch-pan-y"
                    role="group"
                    aria-label={t('paygGraphPage.graphAriaLabel')}
                    onPointerMove={showColumn}
                    onPointerDown={startTouchInteraction}
                    onPointerUp={finishTouchInteraction}
                    onPointerLeave={(event) => {
                        if (event.pointerType === 'mouse') setHoveredGb(null)
                    }}
                    onPointerCancel={finishTouchInteraction}
                >
                    {[0, 5_000, 10_000, 15_000, 20_000, 25_000, 30_000, 35_000, 40_000].map((amount) => {
                        const y = bottom - amount / 40_000 * (bottom - top)
                        return (
                            <g key={amount} aria-hidden="true">
                                <line
                                    x1={left}
                                    x2={right}
                                    y1={y}
                                    y2={y}
                                    className="stroke-border"
                                    strokeDasharray="4 4"
                                />
                                <text
                                    x={left - 4}
                                    y={y + 4}
                                    textAnchor="end"
                                    className={axisLabelClass}
                                >
                                    {amount / 1000}k
                                </text>
                            </g>
                        )
                    })}
                    {Array.from({ length: 11 }, (_, index) => index * 10).map((gb) => {
                        const x = left + gb / 100 * (right - left)
                        return (
                            <line
                                key={gb}
                                x1={x}
                                x2={x}
                                y1={top}
                                y2={bottom}
                                className="stroke-border"
                                strokeDasharray="4 4"
                            />
                        )
                    })}
                    <rect
                        x={left}
                        y={top}
                        width={right - left}
                        height={bottom - top}
                        fill="transparent"
                        className="cursor-crosshair touch-pan-y"
                    />
                    <polygon points={area} fill="#f59e0b" fillOpacity="0.15" />
                    <polyline
                        points={`${left},${bottom} ${line}`}
                        fill="none"
                        stroke="#f59e0b"
                        strokeWidth="2"
                        strokeLinejoin="round"
                    />
                    {active ? (
                        <g pointerEvents="none" aria-hidden="true">
                            <rect
                                x={Math.max(left, active.x - 4)}
                                y={top}
                                width={Math.min(right, active.x + 4) - Math.max(left, active.x - 4)}
                                height={bottom - top}
                                fill="#f59e0b"
                                fillOpacity="0.08"
                            />
                            <line
                                x1={active.x}
                                x2={active.x}
                                y1={top}
                                y2={bottom}
                                stroke="#f59e0b"
                                strokeWidth="1"
                                strokeDasharray="4 4"
                            />
                            <circle
                                cx={active.x}
                                cy={active.y}
                                r="4"
                                fill="#f59e0b"
                                stroke="#111827"
                                strokeWidth="2"
                            />
                        </g>
                    ) : null}
                    {coordinates.map((point) => (
                        <g key={point.gb}>
                            {active?.gb === point.gb ? (
                                <circle
                                    cx={point.x}
                                    cy={point.y}
                                    r="7"
                                    fill="#f59e0b"
                                    fillOpacity="0.2"
                                    stroke="#f59e0b"
                                    strokeWidth="1"
                                />
                            ) : null}
                            <circle
                                cx={point.x}
                                cy={point.y}
                                r={point.protected ? 4 : 3}
                                fill="#f59e0b"
                                stroke="#111827"
                                strokeWidth="1.5"
                            />
                            <circle
                                cx={point.x}
                                cy={point.y}
                                r="10"
                                fill="transparent"
                                className="cursor-help outline-none"
                                tabIndex={0}
                                role="button"
                                aria-label={t('paygGraphPage.graphPointLabel', {
                                    gb: formatPaymentNumber(point.gb),
                                    amount: formatPaymentNumber(point.amountIqd),
                                })}
                                aria-describedby={active?.gb === point.gb ? tooltipId : undefined}
                                onPointerEnter={() => setHoveredGb(point.gb)}
                                onPointerMove={(event) => {
                                    event.stopPropagation()
                                    setHoveredGb(point.gb)
                                }}
                                onPointerDown={(event) => {
                                    event.stopPropagation()
                                    setHoveredGb(point.gb)
                                }}
                                onFocus={() => {
                                    setHoveredGb(null)
                                    setFocusedGb(point.gb)
                                }}
                                onBlur={() => setFocusedGb(null)}
                                onClick={() => setFocusedGb(point.gb)}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter' || event.key === ' ') {
                                        event.preventDefault()
                                        setFocusedGb(point.gb)
                                    }
                                }}
                            />
                            <text
                                x={point.x}
                                y={bottom + 21}
                                textAnchor="middle"
                                className={pointLabelClass}
                                aria-hidden="true"
                            >
                                {t('paygGraphPage.gbValue', {
                                    value: formatPaymentNumber(point.gb),
                                })}
                            </text>
                        </g>
                    ))}
                </svg>
                {active ? (
                    <div
                        id={tooltipId}
                        role="tooltip"
                        className="pointer-events-none absolute z-10 w-52 max-w-full rounded-xl border border-amber-500/40 bg-popover p-3 text-popover-foreground shadow-lg"
                        style={{
                            left: `clamp(6.5rem, ${active.x / width * 100}%, calc(100% - 6.5rem))`,
                            top: active.y > height / 2
                                ? `max(7rem, ${active.y / height * 100}%)`
                                : `${active.y / height * 100}%`,
                            transform: `translate(-50%, ${active.y > height / 2
                                ? 'calc(-100% - 12px)'
                                : '12px'})`,
                        }}
                    >
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            {activeCheckpoint?.protected ? (
                                <LockKeyhole className="h-3 w-3" aria-hidden="true" />
                            ) : activeCheckpoint ? (
                                <MapPin className="h-3 w-3" aria-hidden="true" />
                            ) : (
                                <Info className="h-3 w-3" aria-hidden="true" />
                            )}
                            {t(activeCheckpoint?.protected
                                ? 'paygGraphPage.protected'
                                : activeCheckpoint
                                    ? 'paygGraphPage.customCheckpoint'
                                    : 'paygGraphPage.graphInterpolatedPrice')}
                        </div>
                        <div className="mt-1 text-sm font-semibold tabular-nums">
                            {t('paygGraphPage.gbValue', {
                                value: formatPaymentNumber(active.gb),
                            })}
                        </div>
                        <div className="text-base font-bold tabular-nums text-amber-600">
                            {t('paygGraphPage.iqdValue', {
                                value: formatPaymentNumber(active.amountIqd),
                            })}
                        </div>
                    </div>
                ) : null}
            </div>
            <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {t('paygGraphPage.graphHint')}
            </p>
        </div>
    )
}

function PaygPricingPreview({ checkpoints }: { checkpoints: PaygPricingCheckpoint[] }) {
    return (
        <div className="space-y-3">
            <PricingGraph checkpoints={checkpoints} />
            <PricingCalculator checkpoints={checkpoints} />
        </div>
    )
}

export function PaygGraphPage() {
    const { t, i18n } = useTranslation()
    useFavicon()
    const checkpoints = DEFAULT_PAYG_PRICING_CHECKPOINTS
    const publishedAt = new Intl.DateTimeFormat(i18n.language, {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Asia/Baghdad',
    }).format(DISPLAYED_PUBLISHED_AT)

    return (
        <main className="h-dvh min-h-0 overflow-y-auto overscroll-contain bg-background p-2 sm:p-3">
            <section className="w-full rounded-xl border border-amber-500/25 bg-card shadow-sm">
                <div className="flex flex-col gap-2 border-b p-3 sm:p-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                        <h1 className="flex items-center gap-2 text-base font-semibold">
                            <LineChart className="h-4 w-4 text-amber-600" aria-hidden="true" />
                            {t('paygGraphPage.scheduleTitle')}
                        </h1>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                            {t('paygGraphPage.scheduleDescription')}
                        </p>
                    </div>
                    <div className="rounded-lg border bg-muted/20 px-2.5 py-1.5 text-[11px]">
                        <div className="font-semibold">
                            {t('paygGraphPage.pricingVersion', {
                                version: DISPLAYED_PRICING_VERSION,
                            })}
                        </div>
                        <div className="text-muted-foreground">{publishedAt}</div>
                    </div>
                </div>
                <div className="p-3 sm:p-4">
                    <PaygPricingPreview checkpoints={checkpoints} />
                </div>
            </section>
        </main>
    )
}
