import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
}

export function formatCurrency(
    amount: number,
    currency: string = 'usd',
    iqdPreference: 'IQD' | 'د.ع' = 'IQD'
): string {
    const code = currency.toLowerCase()

    if (code === 'iqd') {
        const formatted = new Intl.NumberFormat('en-US', {
            maximumFractionDigits: 0,
            minimumFractionDigits: 0
        }).format(amount)
        return iqdPreference === 'IQD' ? `${formatted} IQD` : `${formatted} د.ع`
    }

    if (code === 'eur') {
        return new Intl.NumberFormat('de-DE', {
            style: 'currency',
            currency: 'EUR',
        }).format(amount)
    }

    if (code === 'try') {
        return new Intl.NumberFormat('tr-TR', {
            style: 'currency',
            currency: 'TRY',
        }).format(amount)
    }

    // Default to USD
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
    }).format(amount)
}

export function formatDate(date: Date | string): string {
    return new Intl.DateTimeFormat('en-GB', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
    }).format(new Date(date))
}

export function formatDateTime(date: Date | string): string {
    return new Intl.DateTimeFormat('en-GB', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    }).format(new Date(date))
}

export function formatCompactDateTime(date: Date | string): string {
    const d = new Date(date)
    const month = d.toLocaleString('en-US', { month: 'short' })
    const day = d.getDate()
    const hh = d.getHours().toString().padStart(2, '0')
    const mm = d.getMinutes().toString().padStart(2, '0')
    return `${day} ${month}, ${hh}:${mm}`
}

export function formatSnapshotTime(date: Date | string): string {
    const d = new Date(date)
    const yy = d.getFullYear().toString().slice(-2)
    const mm = (d.getMonth() + 1).toString().padStart(2, '0')
    const dd = d.getDate().toString().padStart(2, '0')
    const hh = d.getHours().toString().padStart(2, '0')
    const min = d.getMinutes().toString().padStart(2, '0')
    return `${dd}/${mm}/${yy} ${hh}:${min}`
}

export function generateId(): string {
    return crypto.randomUUID()
}

// Convert camelCase to snake_case
export function toSnakeCase(obj: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    for (const key in obj) {
        const snakeKey = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)
        result[snakeKey] = obj[key]
    }
    return result
}

// Convert snake_case to camelCase
export function toCamelCase(obj: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    for (const key in obj) {
        const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
        result[camelKey] = obj[key]
    }
    return result
}
