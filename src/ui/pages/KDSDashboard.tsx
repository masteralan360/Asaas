import { useEffect, useMemo, useState, type DragEvent } from 'react'
import { useAuth } from '@/auth'
import { useKdsStream } from '@/hooks/useKdsStream'
import { useWorkspace } from '@/workspace'
import { useCategories, useProducts } from '@/local-db'
import { cn } from '@/lib/utils'
import { Check, Clock, GripVertical } from 'lucide-react'

const TICKETS_STORAGE_KEY = 'instant_pos_tickets'
const LATE_THRESHOLD_MS = 10 * 60 * 1000

type InstantPosStatus = 'pending' | 'preparing' | 'ready' | 'served' | 'paid'

type InstantPosItem = {
    productId: string
    name: string
    sku: string
    unitPrice: number
    quantity: number
    currency: string
}

type InstantPosTicket = {
    id: string
    number: string
    createdAt: string
    status: InstantPosStatus
    items: InstantPosItem[]
    kitchenRoutedAt?: string
}

type KdsColumnStatus = 'pending' | 'preparing' | 'ready' | 'served'

const COLUMN_ORDER: KdsColumnStatus[] = ['pending', 'preparing', 'ready', 'served']

const COLUMN_CONFIG: Record<KdsColumnStatus, {
    label: string
    accent: string
    dot: string
    card: string
    action?: {
        label: string
        next: KdsColumnStatus
        button: string
    }
}> = {
    pending: {
        label: 'Pending',
        accent: 'text-amber-400',
        dot: 'bg-amber-400',
        card: 'bg-amber-500/10 border-amber-500/20',
        action: {
            label: 'Start Cooking',
            next: 'preparing',
            button: 'bg-amber-500 text-slate-900 hover:bg-amber-400'
        }
    },
    preparing: {
        label: 'Preparing',
        accent: 'text-blue-400',
        dot: 'bg-blue-400',
        card: 'bg-blue-500/10 border-blue-500/20',
        action: {
            label: 'Mark Ready',
            next: 'ready',
            button: 'bg-blue-500 text-white hover:bg-blue-400'
        }
    },
    ready: {
        label: 'Ready',
        accent: 'text-emerald-400',
        dot: 'bg-emerald-400',
        card: 'bg-emerald-500/10 border-emerald-500/20',
        action: {
            label: 'Serve Order',
            next: 'served',
            button: 'bg-emerald-500 text-white hover:bg-emerald-400'
        }
    },
    served: {
        label: 'Served',
        accent: 'text-slate-300',
        dot: 'bg-slate-400',
        card: 'bg-slate-800/50 border-slate-700/50'
    }
}

function loadTickets(): InstantPosTicket[] {
    if (typeof window === 'undefined') return []
    try {
        const raw = localStorage.getItem(TICKETS_STORAGE_KEY)
        if (!raw) return []
        const parsed = JSON.parse(raw)
        return Array.isArray(parsed) ? parsed : []
    } catch {
        return []
    }
}

function saveTickets(tickets: InstantPosTicket[]) {
    if (typeof window === 'undefined') return
    const next = JSON.stringify(tickets)
    const current = localStorage.getItem(TICKETS_STORAGE_KEY)
    if (current === next) return
    localStorage.setItem(TICKETS_STORAGE_KEY, next)
    window.dispatchEvent(new CustomEvent('instant-pos-tickets-updated'))
}

function formatElapsed(start: string, now: Date) {
    const diff = Math.max(0, now.getTime() - new Date(start).getTime())
    const minutes = Math.floor(diff / 60000)
    const seconds = Math.floor((diff % 60000) / 1000)
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function formatClockTime(date: Date, withSeconds: boolean) {
    return date.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: withSeconds ? '2-digit' : undefined,
        hour12: false
    })
}

export function KDSDashboard() {
    const { user } = useAuth()
    const { features, workspaceName } = useWorkspace()
    const products = useProducts(user?.workspaceId)
    const categories = useCategories(user?.workspaceId)

    const [tickets, setTickets] = useState<InstantPosTicket[]>(() => loadTickets())
    const [now, setNow] = useState(() => new Date())
    const [draggingId, setDraggingId] = useState<string | null>(null)
    const [dragOverStatus, setDragOverStatus] = useState<KdsColumnStatus | null>(null)

    // @ts-ignore
    const isMain = !!window.__TAURI_INTERNALS__
    const { status: streamStatus, streamUrl, broadcast } = useKdsStream(isMain)

    useEffect(() => {
        const interval = window.setInterval(() => setNow(new Date()), 1000)
        return () => window.clearInterval(interval)
    }, [])

    useEffect(() => {
        saveTickets(tickets)
    }, [tickets])

    useEffect(() => {
        const handleStorage = (event: StorageEvent) => {
            if (event.key === TICKETS_STORAGE_KEY) {
                setTickets(loadTickets())
            }
        }
        window.addEventListener('storage', handleStorage)

        const handleStreamUpdate = (event: any) => {
            const updatedTickets = event.detail
            if (updatedTickets && Array.isArray(updatedTickets)) {
                // To avoid loops, we only set if it's actually different or if we are not main
                if (!isMain) {
                    setTickets(updatedTickets)
                }
            }
        }
        window.addEventListener('kds-stream-update', handleStreamUpdate)

        return () => {
            window.removeEventListener('storage', handleStorage)
            window.removeEventListener('kds-stream-update', handleStreamUpdate)
        }
    }, [isMain])

    const productById = useMemo(() => {
        const map = new Map<string, typeof products[number]>()
        products.forEach(product => map.set(product.id, product))
        return map
    }, [products])

    const categoryById = useMemo(() => {
        const map = new Map<string, string>()
        categories.forEach(category => map.set(category.id, category.name))
        return map
    }, [categories])

    const visibleTickets = useMemo(
        () => tickets.filter(ticket => ticket.items.length > 0),
        [tickets]
    )

    const groupedTickets = useMemo(() => {
        const groups: Record<KdsColumnStatus, InstantPosTicket[]> = {
            pending: [],
            preparing: [],
            ready: [],
            served: []
        }

        visibleTickets.forEach(ticket => {
            const normalized = ticket.status === 'paid' ? 'served' : ticket.status
            groups[normalized as KdsColumnStatus].push(ticket)
        })

        COLUMN_ORDER.forEach(status => {
            groups[status].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        })

        return groups
    }, [visibleTickets])

    const stationLabel = workspaceName ? `${workspaceName} - Kitchen` : 'Main Kitchen - Grill'
    const isOnline = typeof navigator === 'undefined' ? true : navigator.onLine
    const isSystemOnline = features.kds_enabled && isOnline
    const systemStatusLabel = features.kds_enabled
        ? (isOnline ? 'System Online' : 'System Offline')
        : 'KDS Disabled'

    const updateTicketStatus = (ticketId: string, status: KdsColumnStatus) => {
        setTickets(prev => prev.map(ticket => {
            if (ticket.id !== ticketId) return ticket
            return {
                ...ticket,
                status,
                kitchenRoutedAt: status === 'preparing'
                    ? (ticket.kitchenRoutedAt || new Date().toISOString())
                    : ticket.kitchenRoutedAt
            }
        }))
        // Broadcast the update if we are the main terminal
        if (isMain) {
            const nextTickets = tickets.map(ticket => {
                if (ticket.id !== ticketId) return ticket
                return {
                    ...ticket,
                    status,
                    kitchenRoutedAt: status === 'preparing'
                        ? (ticket.kitchenRoutedAt || new Date().toISOString())
                        : ticket.kitchenRoutedAt
                }
            })
            broadcast('TICKET_UPDATED', nextTickets)
        }
    }

    const handleDragStart = (event: DragEvent<HTMLElement>, ticketId: string) => {
        event.dataTransfer.setData('text/plain', ticketId)
        event.dataTransfer.effectAllowed = 'move'
        setDraggingId(ticketId)
    }

    const handleDragEnd = () => {
        setDraggingId(null)
        setDragOverStatus(null)
    }

    const handleDrop = (event: DragEvent<HTMLElement>, status: KdsColumnStatus) => {
        event.preventDefault()
        const ticketId = event.dataTransfer.getData('text/plain') || draggingId
        if (!ticketId) return
        updateTicketStatus(ticketId, status)
        setDraggingId(null)
        setDragOverStatus(null)
    }

    const getItemStation = (item: InstantPosItem) => {
        const product = productById.get(item.productId)
        if (!product?.categoryId) return null
        return categoryById.get(product.categoryId) || null
    }

    return (
        <div className="relative flex h-full min-h-[calc(100vh-180px)] flex-col overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900 text-slate-100 shadow-2xl">
            <div className="pointer-events-none absolute inset-0 opacity-50 [background-image:radial-gradient(circle_at_top,rgba(56,189,248,0.16),transparent_60%),radial-gradient(circle_at_bottom,rgba(16,185,129,0.14),transparent_55%)]" />

            <header className="relative z-10 flex flex-wrap items-center justify-between gap-4 border-b border-white/10 bg-slate-900/60 px-6 py-4 backdrop-blur">
                <div className="flex flex-wrap items-center gap-4">
                    <div>
                        <h1 className="text-xl font-semibold tracking-tight">KDS Dashboard</h1>
                        <p className="text-xs text-slate-400">Kitchen display for Instant POS tickets</p>
                    </div>
                    <span className={cn(
                        'rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-widest shadow-lg',
                        isSystemOnline ? 'bg-emerald-500/20 text-emerald-200 shadow-emerald-500/30' : 'bg-rose-500/20 text-rose-200 shadow-rose-500/30'
                    )}>
                        {systemStatusLabel}
                    </span>
                    {streamUrl && (
                        <span className="flex items-center gap-1.5 rounded-full bg-blue-500/20 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-blue-200 shadow-lg shadow-blue-500/30">
                            <span className={cn(
                                "h-1.5 w-1.5 rounded-full",
                                streamStatus === 'connected' || streamStatus === 'host' ? "bg-blue-400 animate-pulse" : "bg-slate-400"
                            )} />
                            {isMain ? 'Streaming' : 'Remote'}
                        </span>
                    )}
                </div>

                <div className="flex flex-wrap items-center gap-5">
                    <div className="text-right">
                        <div className="text-[10px] uppercase tracking-[0.3em] text-slate-400">Station</div>
                        <div className="text-sm font-semibold text-slate-100">{stationLabel}</div>
                    </div>
                    <div className="h-10 w-px bg-white/10" />
                    <div className="text-right">
                        <div className="text-[10px] uppercase tracking-[0.3em] text-slate-400">Current Time</div>
                        <div className="text-lg font-mono font-semibold text-slate-100">
                            {formatClockTime(now, true)}
                        </div>
                    </div>
                </div>
            </header>

            {!features.kds_enabled && (
                <div className="relative z-10 border-b border-amber-500/30 bg-amber-500/10 px-6 py-2 text-xs text-amber-200">
                    Kitchen routing is disabled. Enable KDS in Settings to auto-send tickets here.
                </div>
            )}

            <div className="relative z-10 flex-1 overflow-hidden p-4">
                <div className="grid h-full gap-4 xl:grid-cols-4">
                    {COLUMN_ORDER.map(status => {
                        const config = COLUMN_CONFIG[status]
                        const columnTickets = groupedTickets[status]
                        const isDropTarget = dragOverStatus === status

                        return (
                            <section
                                key={status}
                                onDragOver={(event) => {
                                    event.preventDefault()
                                    event.dataTransfer.dropEffect = 'move'
                                    if (dragOverStatus !== status) {
                                        setDragOverStatus(status)
                                    }
                                }}
                                onDrop={(event) => handleDrop(event, status)}
                                onDragLeave={() => setDragOverStatus(null)}
                                className={cn(
                                    'flex min-h-0 flex-col rounded-2xl border border-white/10 bg-slate-900/50 p-4 shadow-inner backdrop-blur',
                                    isDropTarget && 'ring-2 ring-emerald-400/60 ring-offset-2 ring-offset-slate-950'
                                )}
                            >
                                <div className="flex items-center justify-between">
                                    <div className={cn('flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.3em]', config.accent)}>
                                        <span className={cn('h-2 w-2 rounded-full', config.dot)} />
                                        {config.label}
                                    </div>
                                    <div className="rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-semibold text-slate-200">
                                        {columnTickets.length}
                                    </div>
                                </div>

                                <div className="mt-4 flex-1 min-h-0 space-y-4 overflow-y-auto custom-scrollbar pr-1">
                                    {columnTickets.length === 0 ? (
                                        <div className="rounded-xl border border-dashed border-white/10 px-3 py-6 text-center text-xs text-slate-400">
                                            Drag orders here
                                        </div>
                                    ) : (
                                        columnTickets.map(ticket => {
                                            const normalizedStatus = ticket.status === 'paid' ? 'served' : ticket.status
                                            const action = COLUMN_CONFIG[normalizedStatus as KdsColumnStatus].action
                                            const primaryItem = ticket.items[0]
                                            const extraItems = ticket.items.length - 1
                                            const elapsedFrom = ticket.kitchenRoutedAt || ticket.createdAt
                                            const elapsed = formatElapsed(elapsedFrom, now)
                                            const isLate = (normalizedStatus === 'pending' || normalizedStatus === 'preparing')
                                                && (now.getTime() - new Date(elapsedFrom).getTime()) > LATE_THRESHOLD_MS
                                            const timeLabel = normalizedStatus === 'served'
                                                ? formatClockTime(new Date(ticket.createdAt), false)
                                                : elapsed
                                            const timeCaption = normalizedStatus === 'served'
                                                ? 'Completed'
                                                : normalizedStatus === 'ready'
                                                    ? 'Ready'
                                                    : isLate
                                                        ? 'Late'
                                                        : 'Elapsed'

                                            return (
                                                <div
                                                    key={ticket.id}
                                                    draggable
                                                    onDragStart={(event) => handleDragStart(event, ticket.id)}
                                                    onDragEnd={handleDragEnd}
                                                    className={cn(
                                                        'rounded-2xl border p-4 shadow-lg transition-all select-none cursor-grab active:cursor-grabbing',
                                                        config.card,
                                                        draggingId === ticket.id ? 'opacity-60' : 'hover:-translate-y-0.5 hover:border-white/30'
                                                    )}
                                                >
                                                    <div className="flex items-start justify-between gap-3">
                                                        <div className="flex items-start gap-2">
                                                            <GripVertical className="mt-1 h-4 w-4 text-white/40" />
                                                            <div>
                                                                <div className="text-[10px] uppercase tracking-[0.3em] text-slate-400">
                                                                    Order {ticket.number}
                                                                </div>
                                                                <div className="text-lg font-semibold text-white line-clamp-1">
                                                                    {primaryItem?.name || 'New Ticket'}
                                                                </div>
                                                                {extraItems > 0 && (
                                                                    <div className="text-xs text-slate-400">+{extraItems} more items</div>
                                                                )}
                                                            </div>
                                                        </div>
                                                        <div className="text-right">
                                                            <div className="flex items-center justify-end gap-2">
                                                                {normalizedStatus === 'ready' && (
                                                                    <Check className="h-4 w-4 text-emerald-300" />
                                                                )}
                                                                <span className={cn(
                                                                    'text-sm font-bold',
                                                                    isLate ? 'text-rose-300' : 'text-slate-100'
                                                                )}>
                                                                    {timeLabel}
                                                                </span>
                                                            </div>
                                                            <div className={cn(
                                                                'text-[10px] uppercase tracking-[0.3em]',
                                                                isLate ? 'text-rose-300' : 'text-slate-400'
                                                            )}>
                                                                {timeCaption}
                                                            </div>
                                                        </div>
                                                    </div>

                                                    <div className="mt-4 space-y-2">
                                                        {ticket.items.map(item => {
                                                            const station = getItemStation(item)
                                                            return (
                                                                <div key={item.productId} className="flex items-center justify-between gap-2 text-sm">
                                                                    <span className="flex-1 font-medium text-slate-100 line-clamp-1">
                                                                        {item.quantity}x {item.name}
                                                                    </span>
                                                                    {station && (
                                                                        <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-200">
                                                                            {station}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            )
                                                        })}
                                                    </div>

                                                    {normalizedStatus === 'ready' && (
                                                        <div className="mt-3 rounded-lg bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-200">
                                                            Items ready for pickup
                                                        </div>
                                                    )}

                                                    {normalizedStatus === 'served' && (
                                                        <div className="mt-3 flex items-center gap-2 text-xs text-slate-400">
                                                            <Clock className="h-3.5 w-3.5" />
                                                            Completed on {formatClockTime(new Date(ticket.createdAt), false)}
                                                        </div>
                                                    )}

                                                    {action && (
                                                        <button
                                                            type="button"
                                                            onClick={() => updateTicketStatus(ticket.id, action.next)}
                                                            className={cn(
                                                                'mt-4 w-full rounded-lg px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.3em] transition',
                                                                action.button
                                                            )}
                                                        >
                                                            {action.label}
                                                        </button>
                                                    )}
                                                </div>
                                            )
                                        })
                                    )}
                                </div>
                            </section>
                        )
                    })}
                </div>
            </div>
        </div>
    )
}
