import { ArrowDownToLine, ArrowUpToLine, Move, RotateCw, Scaling, X } from 'lucide-react'
import type { PointerEvent as ReactPointerEvent } from 'react'

import { getPdfShapeHeight, type PdfShape } from '@/types'
import { PdfShapeGraphic } from '@/ui/components/PdfShapeGraphic'

type AttachedShapesOverlayProps = {
    shapes?: PdfShape[]
    onShapesChange?: (shapes: PdfShape[]) => void
    pageWidthMm?: number
}

type Corner = {
    x: -1 | 1
    y: -1 | 1
    className: string
}

type Side = {
    axis: 'x' | 'y'
    direction: -1 | 1
    className: string
}

const cornerHandles: Corner[] = [
    { x: -1, y: -1, className: 'left-0 top-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize' },
    { x: 1, y: -1, className: 'right-0 top-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize' },
    { x: -1, y: 1, className: 'bottom-0 left-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize' },
    { x: 1, y: 1, className: 'bottom-0 right-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize' }
]

const sideHandles: Side[] = [
    { axis: 'y', direction: -1, className: 'left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize' },
    { axis: 'x', direction: 1, className: 'right-0 top-1/2 translate-x-1/2 -translate-y-1/2 cursor-ew-resize' },
    { axis: 'y', direction: 1, className: 'bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 cursor-ns-resize' },
    { axis: 'x', direction: -1, className: 'left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize' }
]

export function AttachedShapesOverlay({ shapes = [], onShapesChange, pageWidthMm = 210 }: AttachedShapesOverlayProps) {
    const updateShape = (index: number, nextShape: PdfShape) => {
        onShapesChange?.(shapes.map((shape, shapeIndex) => (
            shapeIndex === index ? nextShape : shape
        )))
    }

    const moveLayer = (index: number, direction: -1 | 1) => {
        const targetIndex = index + direction
        if (!onShapesChange || targetIndex < 0 || targetIndex >= shapes.length) return

        const nextShapes = [...shapes]
        ;[nextShapes[index], nextShapes[targetIndex]] = [nextShapes[targetIndex], nextShapes[index]]
        onShapesChange(nextShapes)
    }

    const startMove = (event: ReactPointerEvent<HTMLDivElement>, shape: PdfShape, index: number) => {
        if (!onShapesChange) return
        event.preventDefault()
        event.stopPropagation()
        const parentRect = event.currentTarget.parentElement?.offsetParent?.getBoundingClientRect()
        if (!parentRect) return

        const startX = event.clientX
        const startY = event.clientY
        const scale = pageWidthMm / parentRect.width
        const onPointerMove = (moveEvent: PointerEvent) => {
            updateShape(index, {
                ...shape,
                x: shape.x + (moveEvent.clientX - startX) * scale,
                y: shape.y + (moveEvent.clientY - startY) * scale
            })
        }
        const onPointerUp = () => {
            window.removeEventListener('pointermove', onPointerMove)
            window.removeEventListener('pointerup', onPointerUp)
        }

        window.addEventListener('pointermove', onPointerMove)
        window.addEventListener('pointerup', onPointerUp)
    }

    const startScale = (
        event: ReactPointerEvent<HTMLDivElement>,
        shape: PdfShape,
        index: number,
        horizontalDirection: -1 | 0 | 1,
        verticalDirection: -1 | 0 | 1
    ) => {
        if (!onShapesChange) return
        event.preventDefault()
        event.stopPropagation()
        const parentRect = event.currentTarget.parentElement?.offsetParent?.getBoundingClientRect()
        if (!parentRect) return

        const startX = event.clientX
        const startY = event.clientY
        const scale = pageWidthMm / parentRect.width
        const initialWidth = shape.width
        const initialHeight = getPdfShapeHeight(shape)
        const radians = (shape.rotation || 0) * (Math.PI / 180)
        const cos = Math.cos(radians)
        const sin = Math.sin(radians)
        const onPointerMove = (moveEvent: PointerEvent) => {
            const worldX = (moveEvent.clientX - startX) * scale
            const worldY = (moveEvent.clientY - startY) * scale
            const localX = worldX * cos + worldY * sin
            const localY = -worldX * sin + worldY * cos
            const width = horizontalDirection === 0
                ? initialWidth
                : Math.max(10, initialWidth + horizontalDirection * localX)
            const height = verticalDirection === 0
                ? initialHeight
                : Math.max(10, initialHeight + verticalDirection * localY)
            const widthDelta = width - initialWidth
            const heightDelta = height - initialHeight
            const centerX = (horizontalDirection * widthDelta / 2) * cos - (verticalDirection * heightDelta / 2) * sin
            const centerY = (horizontalDirection * widthDelta / 2) * sin + (verticalDirection * heightDelta / 2) * cos

            updateShape(index, {
                ...shape,
                x: shape.x + centerX,
                y: shape.y + centerY,
                width,
                height
            })
        }
        const onPointerUp = () => {
            window.removeEventListener('pointermove', onPointerMove)
            window.removeEventListener('pointerup', onPointerUp)
        }

        window.addEventListener('pointermove', onPointerMove)
        window.addEventListener('pointerup', onPointerUp)
    }

    const startRotation = (event: ReactPointerEvent<HTMLDivElement>, shape: PdfShape, index: number) => {
        if (!onShapesChange) return
        event.preventDefault()
        event.stopPropagation()
        const rect = event.currentTarget.parentElement?.getBoundingClientRect()
        if (!rect) return

        const centerX = rect.left + rect.width / 2
        const centerY = rect.top + rect.height / 2
        const startAngle = Math.atan2(event.clientY - centerY, event.clientX - centerX)
        const initialRotation = shape.rotation || 0
        const onPointerMove = (moveEvent: PointerEvent) => {
            const angle = Math.atan2(moveEvent.clientY - centerY, moveEvent.clientX - centerX)
            updateShape(index, {
                ...shape,
                rotation: initialRotation + (angle - startAngle) * (180 / Math.PI)
            })
        }
        const onPointerUp = () => {
            window.removeEventListener('pointermove', onPointerMove)
            window.removeEventListener('pointerup', onPointerUp)
        }

        window.addEventListener('pointermove', onPointerMove)
        window.addEventListener('pointerup', onPointerUp)
    }

    return (
        <>
            {shapes.map((shape, index) => (
                <div
                    key={shape.id || `${shape.kind}-${index}`}
                    className="absolute group/pdf-shape"
                    style={{
                        left: `${shape.x}mm`,
                        top: `${shape.y}mm`,
                        width: `${shape.width}mm`,
                        height: `${getPdfShapeHeight(shape)}mm`,
                        transform: `translate(-50%, -50%) rotate(${shape.rotation || 0}deg)`,
                        transformOrigin: 'center',
                        zIndex: 75 + index
                    }}
                >
                    <PdfShapeGraphic kind={shape.kind} color={shape.color} />

                    {onShapesChange && (
                        <>
                            <button
                                type="button"
                                aria-label="Send shape backward"
                                title="Send backward"
                                disabled={index === 0}
                                className="absolute left-1/2 top-0 flex h-6 w-6 -translate-x-[185%] -translate-y-[135%] items-center justify-center rounded-full border border-slate-200 bg-white shadow-sm opacity-0 transition-opacity group-hover/pdf-shape:opacity-100 group-focus-within/pdf-shape:opacity-100 hover:bg-slate-50 active:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                                onClick={(event) => {
                                    event.stopPropagation()
                                    moveLayer(index, -1)
                                }}
                            >
                                <ArrowDownToLine className="h-3 w-3 text-primary" />
                            </button>

                            <div
                                className="absolute left-1/2 top-0 flex h-6 w-6 -translate-x-1/2 -translate-y-[135%] items-center justify-center rounded-full border border-slate-200 bg-white shadow-sm opacity-0 transition-opacity group-hover/pdf-shape:opacity-100 group-focus-within/pdf-shape:opacity-100 hover:bg-slate-50 active:bg-slate-100 cursor-alias"
                                onPointerDown={(event) => startRotation(event, shape, index)}
                            >
                                <RotateCw className="h-3 w-3 text-primary" />
                            </div>

                            <button
                                type="button"
                                aria-label="Bring shape forward"
                                title="Bring forward"
                                disabled={index === shapes.length - 1}
                                className="absolute left-1/2 top-0 flex h-6 w-6 translate-x-[85%] -translate-y-[135%] items-center justify-center rounded-full border border-slate-200 bg-white shadow-sm opacity-0 transition-opacity group-hover/pdf-shape:opacity-100 group-focus-within/pdf-shape:opacity-100 hover:bg-slate-50 active:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                                onClick={(event) => {
                                    event.stopPropagation()
                                    moveLayer(index, 1)
                                }}
                            >
                                <ArrowUpToLine className="h-3 w-3 text-primary" />
                            </button>

                            {cornerHandles.map((corner) => (
                                <div
                                    key={`${corner.x}-${corner.y}`}
                                    className={`absolute flex h-5 w-5 items-center justify-center rounded border border-slate-200 bg-white shadow-sm opacity-0 transition-opacity group-hover/pdf-shape:opacity-100 group-focus-within/pdf-shape:opacity-100 hover:bg-slate-50 active:bg-slate-100 ${corner.className}`}
                                    onPointerDown={(event) => startScale(event, shape, index, corner.x, corner.y)}
                                >
                                    <Scaling className="h-3 w-3 text-primary" />
                                </div>
                            ))}

                            {sideHandles.map((side) => (
                                <div
                                    key={`${side.axis}-${side.direction}`}
                                    className={`absolute flex h-4 w-4 items-center justify-center rounded border border-slate-200 bg-white shadow-sm opacity-0 transition-opacity group-hover/pdf-shape:opacity-100 group-focus-within/pdf-shape:opacity-100 hover:bg-slate-50 active:bg-slate-100 ${side.className}`}
                                    onPointerDown={(event) => startScale(
                                        event,
                                        shape,
                                        index,
                                        side.axis === 'x' ? side.direction : 0,
                                        side.axis === 'y' ? side.direction : 0
                                    )}
                                />
                            ))}

                            <div
                                className="absolute bottom-0 left-1/2 flex h-6 w-6 -translate-x-1/2 translate-y-[135%] items-center justify-center rounded-full border border-slate-200 bg-white shadow-sm opacity-0 transition-opacity group-hover/pdf-shape:opacity-100 group-focus-within/pdf-shape:opacity-100 hover:bg-slate-50 active:bg-slate-100 cursor-move"
                                onPointerDown={(event) => startMove(event, shape, index)}
                            >
                                <Move className="h-3 w-3 text-primary" />
                            </div>

                            <button
                                type="button"
                                aria-label="Delete shape"
                                className="absolute right-0 top-0 z-10 translate-x-[155%] -translate-y-1/2 rounded-full bg-red-500 p-1 text-white opacity-0 shadow-md transition-opacity group-hover/pdf-shape:opacity-100 group-focus-within/pdf-shape:opacity-100 hover:bg-red-600 active:scale-95"
                                onClick={(event) => {
                                    event.stopPropagation()
                                    onShapesChange(shapes.filter((_, shapeIndex) => shapeIndex !== index))
                                }}
                            >
                                <X className="h-3 w-3" />
                            </button>
                        </>
                    )}
                </div>
            ))}
        </>
    )
}
