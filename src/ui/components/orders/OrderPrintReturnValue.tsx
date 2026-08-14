import type { ReactNode } from 'react'

import type { OrderPrintReturnState } from '@/lib/orderPrintReturnState'
import { cn } from '@/lib/utils'

export function OrderPrintReturnValue({
    state,
    original,
    remaining,
    stacked = false,
    className
}: {
    state: OrderPrintReturnState
    original: ReactNode
    remaining: ReactNode
    /** Keep multi-line currency values within narrow print-table columns. */
    stacked?: boolean
    className?: string
}) {
    if (state.status === 'active') return <>{original}</>

    return (
        <div
            className={cn(
                'flex max-w-full',
                stacked ? 'flex-col gap-0 text-[9px] leading-[1.05]' : 'items-start gap-1',
                className
            )}
            data-order-print-return-value={state.status}
        >
            <span className="min-w-0 line-through decoration-2 opacity-70">{original}</span>
            <span className="min-w-0 font-bold">{remaining}</span>
        </div>
    )
}
