import type { MouseEventHandler } from 'react'
import { Plus } from 'lucide-react'

import { Button } from '@/ui/components'

interface AddPartnerButtonProps {
    onClick: MouseEventHandler<HTMLButtonElement>
    /** Accessible name announced by screen readers and shown on hover. */
    label?: string
    className?: string
    disabled?: boolean
}

/** Icon-only "+" button that opens a business partner creation dialog next to a partner picker. */
export function AddPartnerButton({ onClick, label, className, disabled = false }: AddPartnerButtonProps) {
    return (
        <Button
            type="button"
            size="icon"
            variant="outline"
            className={`shrink-0 ${className ?? ''}`}
            onClick={onClick}
            disabled={disabled}
            aria-label={label}
            title={label}
        >
            <Plus className="h-4 w-4" />
        </Button>
    )
}
