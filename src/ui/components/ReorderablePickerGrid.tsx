import type { DragStart, DragUpdate, DraggableProvidedDragHandleProps, DropResult } from '@hello-pangea/dnd'
import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { cn } from '@/lib/utils'

interface ReorderablePickerGridProps<T> {
    droppableId: string
    items: T[]
    getItemId: (item: T) => string
    getSlotClassName?: (item: T, index: number) => string | undefined
    onItemsSwap: (items: T[]) => void
    renderItem: (item: T, dragHandleProps: DraggableProvidedDragHandleProps | null, isDragging: boolean) => ReactNode
    className?: string
}

type DndComponents = Pick<typeof import('@hello-pangea/dnd'), 'DragDropContext' | 'Draggable' | 'Droppable'>

type DragSlots = {
    sourceIndex: number
    destinationIndex: number | null
}

/**
 * Reorders a fixed visual grid by swapping the values assigned to its slots.
 * Each slot is its own droppable list so @hello-pangea/dnd can reliably support
 * grid-shaped pickers while retaining its list-based drag-and-drop model.
 */
export function ReorderablePickerGrid<T>({
    droppableId,
    items,
    getItemId,
    getSlotClassName,
    onItemsSwap,
    renderItem,
    className
}: ReorderablePickerGridProps<T>) {
    const [dnd, setDnd] = useState<DndComponents | null>(null)
    const [dragSlots, setDragSlots] = useState<DragSlots | null>(null)
    const slotIds = items.map((_, index) => `${droppableId}:slot-${index}`)

    useEffect(() => {
        let mounted = true
        void import('@hello-pangea/dnd').then(({ DragDropContext, Draggable, Droppable }) => {
            if (mounted) setDnd({ DragDropContext, Draggable, Droppable })
        })
        return () => {
            mounted = false
        }
    }, [])

    const getSlotIndex = (slotId: string) => slotIds.indexOf(slotId)

    const handleDragStart = (start: DragStart) => {
        const sourceIndex = getSlotIndex(start.source.droppableId)
        setDragSlots(sourceIndex < 0 ? null : { sourceIndex, destinationIndex: null })
    }

    const handleDragUpdate = (update: DragUpdate) => {
        const sourceIndex = getSlotIndex(update.source.droppableId)
        const destinationIndex = update.destination ? getSlotIndex(update.destination.droppableId) : -1
        setDragSlots(sourceIndex < 0 ? null : {
            sourceIndex,
            destinationIndex: destinationIndex >= 0 && destinationIndex !== sourceIndex ? destinationIndex : null
        })
    }

    const handleDragEnd = (result: DropResult) => {
        setDragSlots(null)
        const destination = result.destination
        if (!destination) return

        const sourceIndex = getSlotIndex(result.source.droppableId)
        const destinationIndex = getSlotIndex(destination.droppableId)
        if (sourceIndex < 0 || destinationIndex < 0 || sourceIndex === destinationIndex) return

        const nextItems = [...items]
        ;[nextItems[sourceIndex], nextItems[destinationIndex]] = [nextItems[destinationIndex], nextItems[sourceIndex]]
        onItemsSwap(nextItems)
    }

    const staticGrid = (
        <div className={className}>
            {items.map((item, index) => (
                <div key={getItemId(item)} className={cn('min-w-0', getSlotClassName?.(item, index))}>
                    {renderItem(item, null, false)}
                </div>
            ))}
        </div>
    )

    if (!dnd) return staticGrid

    const { DragDropContext, Draggable, Droppable } = dnd
    return (
        <DragDropContext onDragStart={handleDragStart} onDragUpdate={handleDragUpdate} onDragEnd={handleDragEnd}>
            <div className={className}>
                {items.map((item, index) => {
                    const previewItem = dragSlots?.sourceIndex === index && dragSlots.destinationIndex !== null
                        ? items[dragSlots.destinationIndex]
                        : null
                    const isDestinationSlot = dragSlots?.destinationIndex === index

                    return (
                    <Droppable key={slotIds[index]} droppableId={slotIds[index]} direction="vertical">
                        {(dropProvided) => (
                            <div
                                ref={dropProvided.innerRef}
                                {...dropProvided.droppableProps}
                                className={cn(
                                    'relative min-w-0',
                                    isDestinationSlot && 'rounded-md ring-2 ring-primary/40',
                                    getSlotClassName?.(item, index)
                                )}
                            >
                                {/*
                                    The droppable is a fixed position in the picker. Keep the
                                    draggable identity attached to that position as well: moving a
                                    field swaps slot contents, rather than re-parenting the same
                                    draggable ID into another droppable. This prevents stale drag
                                    registrations after repeated swaps.
                                */}
                                <Draggable draggableId={slotIds[index]} index={0}>
                                    {(dragProvided, snapshot) => {
                                        const draggable = (
                                            <div
                                                ref={dragProvided.innerRef}
                                                {...dragProvided.draggableProps}
                                                className={cn(
                                                    snapshot.isDragging && 'z-[70]',
                                                    isDestinationSlot && !snapshot.isDragging && 'invisible'
                                                )}
                                            >
                                                {renderItem(item, dragProvided.dragHandleProps, snapshot.isDragging)}
                                            </div>
                                        )

                                        return snapshot.isDragging && typeof document !== 'undefined'
                                            ? createPortal(draggable, document.body)
                                            : draggable
                                    }}
                                </Draggable>
                                {dropProvided.placeholder}
                                {previewItem ? (
                                    <div className="pointer-events-none absolute inset-0 z-10">
                                        {renderItem(previewItem, null, false)}
                                    </div>
                                ) : null}
                            </div>
                        )}
                    </Droppable>
                    )
                })}
            </div>
        </DragDropContext>
    )
}
