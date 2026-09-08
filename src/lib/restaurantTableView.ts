import type { RestaurantPosTicketItem, RestaurantPosTicketStatus } from '@/local-db/models'

export const RESTAURANT_TICKET_STATUSES: readonly RestaurantPosTicketStatus[] = [
    'pending',
    'preparing',
    'ready',
    'served'
]

export function isRestaurantTicketStatus(value: unknown): value is RestaurantPosTicketStatus {
    return typeof value === 'string'
        && (RESTAURANT_TICKET_STATUSES as readonly string[]).includes(value)
}

export function normalizeRestaurantTableCount(value: number) {
    if (!Number.isInteger(value) || value < 1 || value > 100) return null
    return value
}

export function normalizeVipTableNumbers(values: readonly number[], tableCount: number) {
    const normalized = [...new Set(values.filter((value) => (
        Number.isInteger(value) && value >= 1 && value <= tableCount
    )))].sort((left, right) => left - right)
    return normalized
}

export function calculateRestaurantTicketTotal(items: readonly Pick<RestaurantPosTicketItem, 'quantity' | 'unitPrice'>[]) {
    const total = items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0)
    return Number(total.toFixed(6))
}

export function canChangeRestaurantTableConfiguration({
    currentEnabled,
    nextEnabled,
    currentTableCount,
    nextTableCount,
    activeTableNumbers
}: {
    currentEnabled: boolean
    nextEnabled: boolean
    currentTableCount: number
    nextTableCount: number
    activeTableNumbers: readonly number[]
}) {
    if (currentEnabled && !nextEnabled && activeTableNumbers.length > 0) return false
    if (nextTableCount < currentTableCount && activeTableNumbers.some((tableNumber) => tableNumber > nextTableCount)) return false
    return true
}
