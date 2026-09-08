import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Crown, MoreVertical, MoveRight, Table2 } from 'lucide-react'

import type { RestaurantPosTicket } from '@/local-db/models'
import { cn } from '@/lib/utils'
import {
    AppDialog,
    AppDialogBody,
    AppDialogContent,
    AppDialogFooter,
    AppDialogHeader,
    AppDialogTitle,
    Button,
} from '@/ui/components'

interface RestaurantTableGridProps {
    tableCount: number
    vipTableNumbers: number[]
    tickets: RestaurantPosTicket[]
    formatTotal: (ticket: RestaurantPosTicket) => string
    onOpenTable: (tableNumber: number) => void
    onMoveTicket: (ticket: RestaurantPosTicket, destinationTableNumber: number) => Promise<void>
}

export function RestaurantTableGrid({
    tableCount,
    vipTableNumbers,
    tickets,
    formatTotal,
    onOpenTable,
    onMoveTicket,
}: RestaurantTableGridProps) {
    const { t } = useTranslation()
    const [actionTicket, setActionTicket] = useState<RestaurantPosTicket | null>(null)
    const [destinationTableNumber, setDestinationTableNumber] = useState<number | null>(null)
    const [isMoving, setIsMoving] = useState(false)
    const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const ticketByTable = new Map(tickets.map((ticket) => [ticket.tableNumber, ticket]))
    const vipTables = new Set(vipTableNumbers)

    const dismissAction = () => {
        if (isMoving) return
        setActionTicket(null)
        setDestinationTableNumber(null)
    }

    const openActions = (ticket: RestaurantPosTicket) => {
        setActionTicket(ticket)
        setDestinationTableNumber(null)
    }

    const startLongPress = (ticket: RestaurantPosTicket | undefined) => {
        if (!ticket) return
        pressTimer.current = setTimeout(() => {
            openActions(ticket)
            pressTimer.current = null
        }, 500)
    }

    const clearLongPress = () => {
        if (pressTimer.current) {
            clearTimeout(pressTimer.current)
            pressTimer.current = null
        }
    }

    const handleMove = async () => {
        if (!actionTicket || !destinationTableNumber || isMoving) return
        setIsMoving(true)
        try {
            await onMoveTicket(actionTicket, destinationTableNumber)
            setActionTicket(null)
            setDestinationTableNumber(null)
        } finally {
            setIsMoving(false)
        }
    }

    const emptyDestinationTables = Array.from({ length: tableCount }, (_, index) => index + 1)
        .filter((tableNumber) => tableNumber !== actionTicket?.tableNumber && !ticketByTable.has(tableNumber))

    return (
        <div className="flex h-full min-h-0 flex-col gap-5 overflow-auto bg-background p-4 text-foreground sm:p-6">
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
                <div className="rounded-xl bg-primary/10 p-2.5 text-primary">
                    <Table2 className="h-6 w-6" />
                </div>
                <div>
                    <h1 className="text-xl font-black tracking-tight">{t('restaurantTables.title')}</h1>
                    <p className="text-sm text-muted-foreground">{t('restaurantTables.description')}</p>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
                {Array.from({ length: tableCount }, (_, index) => index + 1).map((tableNumber) => {
                    const ticket = ticketByTable.get(tableNumber)
                    const occupied = !!ticket
                    const vip = vipTables.has(tableNumber)
                    return (
                        <div
                            key={tableNumber}
                            role="button"
                            tabIndex={0}
                            onClick={() => onOpenTable(tableNumber)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault()
                                    onOpenTable(tableNumber)
                                }
                            }}
                            onContextMenu={(event) => {
                                if (!ticket) return
                                event.preventDefault()
                                openActions(ticket)
                            }}
                            onTouchStart={() => startLongPress(ticket)}
                            onTouchEnd={clearLongPress}
                            onTouchCancel={clearLongPress}
                            className={cn(
                                'group relative min-h-40 overflow-hidden rounded-2xl border bg-card text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                                occupied ? 'border-primary/40' : 'border-border'
                            )}
                        >
                            <div className={cn('h-3 w-full', occupied ? 'bg-primary' : 'bg-black')} />
                            <div className="flex min-h-[9.25rem] flex-col justify-between p-4">
                                <div className="flex items-start justify-between gap-2">
                                    <span className={cn('text-5xl font-black leading-none', occupied ? 'text-primary' : 'text-foreground')}>
                                        {tableNumber}
                                    </span>
                                    <div className="flex items-center gap-1">
                                        {vip && (
                                            <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-amber-700 dark:text-amber-300">
                                                <Crown className="h-3 w-3" />
                                                {t('restaurantTables.vip')}
                                            </span>
                                        )}
                                        {ticket && (
                                            <button
                                                type="button"
                                                onClick={(event) => {
                                                    event.preventDefault()
                                                    event.stopPropagation()
                                                    openActions(ticket)
                                                }}
                                                onKeyDown={(event) => {
                                                    if (event.key === 'Enter' || event.key === ' ') {
                                                        event.preventDefault()
                                                        event.stopPropagation()
                                                        openActions(ticket)
                                                    }
                                                }}
                                                className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                                                aria-label={t('restaurantTables.openActions', { table: tableNumber })}
                                            >
                                                <MoreVertical className="h-4 w-4" />
                                            </button>
                                        )}
                                    </div>
                                </div>
                                {ticket ? (
                                    <div className="space-y-2">
                                        <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                                            {t(`instantPos.status.${ticket.status}`)}
                                        </div>
                                        <div className="rounded-lg bg-foreground px-3 py-2 text-right text-lg font-black text-background">
                                            {formatTotal(ticket)}
                                        </div>
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    )
                })}
            </div>

            <AppDialog open={!!actionTicket} onOpenChange={(open) => !open && dismissAction()}>
                <AppDialogContent className="max-w-xl">
                    <AppDialogHeader>
                        <AppDialogTitle>{t('restaurantTables.transferTitle')}</AppDialogTitle>
                    </AppDialogHeader>
                    <AppDialogBody className="space-y-5">
                        <div className="rounded-xl border border-border bg-muted/30 p-4">
                            <div className="flex items-center justify-between gap-4">
                                <span className="text-sm text-muted-foreground">
                                    {t('restaurantTables.transferFrom', { table: actionTicket?.tableNumber })}
                                </span>
                                <span className="font-black text-primary">
                                    {actionTicket ? formatTotal(actionTicket) : '--'}
                                </span>
                            </div>
                        </div>
                        <div>
                            <p className="mb-3 text-sm font-bold">{t('restaurantTables.transferDestinationRequired')}</p>
                            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                                {emptyDestinationTables.map((tableNumber) => (
                                    <Button
                                        key={tableNumber}
                                        type="button"
                                        variant={destinationTableNumber === tableNumber ? 'default' : 'outline'}
                                        onClick={() => setDestinationTableNumber(tableNumber)}
                                        className="h-11"
                                    >
                                        {tableNumber}
                                    </Button>
                                ))}
                            </div>
                            {emptyDestinationTables.length === 0 && (
                                <p className="mt-2 text-sm text-muted-foreground">{t('restaurantTables.noEmptyTables')}</p>
                            )}
                        </div>
                    </AppDialogBody>
                    <AppDialogFooter>
                        <Button variant="outline" onClick={dismissAction} disabled={isMoving}>
                            {t('common.cancel')}
                        </Button>
                        <Button onClick={() => void handleMove()} disabled={!destinationTableNumber || isMoving}>
                            <MoveRight className="h-4 w-4" />
                            {isMoving ? t('restaurantTables.transferring') : t('restaurantTables.transfer')}
                        </Button>
                    </AppDialogFooter>
                </AppDialogContent>
            </AppDialog>
        </div>
    )
}
