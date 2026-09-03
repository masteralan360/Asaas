import type { MouseEventHandler } from 'react'
import { Plus, SlidersHorizontal } from 'lucide-react'

import { Button } from '@/ui/components'

interface AddPartnerButtonProps {
    onClick: MouseEventHandler<HTMLButtonElement>
    /** Accessible name announced by screen readers and shown on hover. */
    label?: string
    className?: string
    disabled?: boolean
    /** Shows that this action opens the full partner form instead of quick creation. */
    advanced?: boolean
}

/** Icon-only "+" button that opens a business partner creation dialog next to a partner picker. */
export function AddPartnerButton({ onClick, label, className, disabled = false, advanced = false }: AddPartnerButtonProps) {
    return (
        <Button
            type="button"
            size="icon"
            variant="outline"
            className={`relative shrink-0 ${className ?? ''}`}
            onClick={onClick}
            disabled={disabled}
            aria-label={label}
            title={label}
        >
            <Plus className="h-4 w-4" />
            {advanced ? (
                <SlidersHorizontal
                    className="absolute -bottom-1 -end-1 h-3 w-3 rounded-full border border-background bg-background p-px text-primary"
                    aria-hidden="true"
                />
            ) : null}
        </Button>
    )
}
