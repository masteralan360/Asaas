import type { LucideIcon } from 'lucide-react'
import { ChevronDown } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Button } from './button'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from './ui/dropdown-menu'

export type FilterDropdownOption<Value extends string> = {
    value: Value
    label: string
    icon: LucideIcon
    tone?: 'danger'
}

type FilterDropdownProps<Value extends string> = {
    value: Value
    label: string
    options: readonly FilterDropdownOption<Value>[]
    onValueChange: (value: Value) => void
    dir?: 'ltr' | 'rtl'
    hasActiveFilter?: boolean
    contentClassName?: string
}

export function FilterDropdown<Value extends string>({
    value,
    label,
    options,
    onValueChange,
    dir,
    hasActiveFilter = false,
    contentClassName,
}: FilterDropdownProps<Value>) {
    const selectedOption = options.find((option) => option.value === value)

    if (!selectedOption) return null

    const SelectedIcon = selectedOption.icon

    return (
        <DropdownMenu dir={dir}>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="outline"
                    allowViewer
                    aria-label={`${label}: ${selectedOption.label}`}
                    className={cn(
                        'h-10 justify-between gap-2 rounded-xl border-border/70 bg-background px-3 font-semibold shadow-sm hover:border-primary/30 hover:bg-primary/5',
                        hasActiveFilter && 'border-primary/30 bg-primary/5 text-primary',
                    )}
                >
                    <span className="flex min-w-0 items-center gap-2">
                        <SelectedIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
                        <span className="hidden text-xs text-muted-foreground sm:inline">{label}</span>
                        <span className="truncate text-sm">{selectedOption.label}</span>
                    </span>
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className={cn('min-w-44 rounded-xl border-border/70 p-1.5', contentClassName)}>
                {options.map((option) => {
                    const OptionIcon = option.icon
                    const isSelected = value === option.value
                    const isDanger = option.tone === 'danger'

                    return (
                        <DropdownMenuItem
                            key={option.value}
                            onSelect={() => onValueChange(option.value)}
                            className={cn(
                                'rounded-lg px-3 py-2 text-sm font-medium',
                                isDanger && 'text-rose-600 focus:text-rose-700 dark:text-rose-400',
                                isSelected && (isDanger
                                    ? 'bg-rose-500/10 text-rose-700 focus:bg-rose-500/10 focus:text-rose-700 dark:text-rose-300'
                                    : 'bg-primary/10 text-primary focus:bg-primary/10 focus:text-primary'),
                            )}
                        >
                            <OptionIcon className="me-2 h-4 w-4" aria-hidden="true" />
                            {option.label}
                        </DropdownMenuItem>
                    )
                })}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
