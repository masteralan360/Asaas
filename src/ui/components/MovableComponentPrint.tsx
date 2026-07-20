import { Move } from 'lucide-react'
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react'
import type { CustomTemplateComponentPosition } from '@/lib/pdfPreviewStore'

export function MovableOrderPrintBlock({
    componentKey,
    label,
    position,
    editable,
    onPositionChange,
    wrapperClassName,
    handleSide = 'right',
    minY,
    pushFlow,
    children
}: {
    componentKey: string
    label: string
    position?: CustomTemplateComponentPosition
    editable?: boolean
    onPositionChange?: (key: string, position: CustomTemplateComponentPosition) => void
    wrapperClassName?: string
    handleSide?: 'left' | 'right'
    minY?: number
    pushFlow?: boolean
    children: ReactNode
}) {
    const resolvedPosition = position || { x: 0, y: 0 }

    const updatePosition = (nextPosition: CustomTemplateComponentPosition) => {
        onPositionChange?.(componentKey, {
            x: nextPosition.x,
            y: minY !== undefined ? Math.max(minY, nextPosition.y) : nextPosition.y
        })
    }

    const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
        if (!editable || !onPositionChange) return

        event.preventDefault()
        event.stopPropagation()
        const page = event.currentTarget.closest<HTMLElement>('[data-order-print-page]')
        if (!page) return

        const pageRect = page.getBoundingClientRect()
        const pageWidthMm = parseFloat(page.dataset.pageWidthMm || '210')
        const mmPerPixel = pageWidthMm / pageRect.width
        const startX = event.clientX
        const startY = event.clientY
        const initialPosition = resolvedPosition
        const roundMillimeters = (value: number) => Math.round(value * 100) / 100

        const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
            updatePosition({
                x: roundMillimeters(initialPosition.x + ((moveEvent.clientX - startX) * mmPerPixel)),
                y: roundMillimeters(initialPosition.y + ((moveEvent.clientY - startY) * mmPerPixel))
            })
        }
        const handlePointerUp = () => {
            window.removeEventListener('pointermove', handlePointerMove)
            window.removeEventListener('pointerup', handlePointerUp)
            window.removeEventListener('pointercancel', handlePointerUp)
        }

        window.addEventListener('pointermove', handlePointerMove)
        window.addEventListener('pointerup', handlePointerUp)
        window.addEventListener('pointercancel', handlePointerUp)
    }

    const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
        if (!editable || !onPositionChange) return
        const step = event.shiftKey ? 5 : 1
        const delta = {
            ArrowLeft: { x: -step, y: 0 },
            ArrowRight: { x: step, y: 0 },
            ArrowUp: { x: 0, y: -step },
            ArrowDown: { x: 0, y: step }
        }[event.key]
        if (!delta) return

        event.preventDefault()
        updatePosition({
            x: resolvedPosition.x + delta.x,
            y: resolvedPosition.y + delta.y
        })
    }

    return (
        <div
            className={[
                editable ? 'group/order-block relative outline outline-1 outline-dashed outline-transparent hover:outline-primary/60' : undefined,
                wrapperClassName
            ].filter(Boolean).join(' ')}
            style={pushFlow ? {
                position: 'relative',
                transform: `translate(${resolvedPosition.x}mm, 0)`,
                marginTop: `${resolvedPosition.y}mm`,
                zIndex: 20
            } : {
                transform: `translate(${resolvedPosition.x}mm, ${resolvedPosition.y}mm)`,
                position: 'relative',
                zIndex: 20
            }}
            data-order-print-component={componentKey}
            data-pdf-template-object-id={`component:${componentKey}`}
            data-pdf-template-object-kind="component"
        >
            {children}
            {editable ? (
                <button
                    type="button"
                    className={`order-template-move-handle absolute -top-3 ${handleSide === 'left' ? 'start-1' : 'end-1'} z-50 inline-flex h-6 touch-none items-center gap-1 rounded border border-primary/30 bg-white px-1.5 text-[9px] font-semibold text-primary opacity-70 shadow-sm hover:opacity-100 focus:opacity-100`}
                    onPointerDown={handlePointerDown}
                    onKeyDown={handleKeyDown}
                    aria-label={`Move ${label}`}
                    title={`Move ${label}. Use arrow keys for 1mm steps; hold Shift for 5mm.`}
                >
                    <Move className="h-3 w-3" />
                    <span>{label}</span>
                </button>
            ) : null}
        </div>
    )
}
