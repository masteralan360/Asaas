import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

export interface SelectionCardOption<Value extends string> {
    value: Value
    title: ReactNode
    description: ReactNode
}

interface SelectionCardsProps<Value extends string> {
    name: string
    ariaLabel: string
    value: Value | null
    options: readonly SelectionCardOption<Value>[]
    onValueChange: (value: Value) => void
    disabled?: boolean
}

/** A responsive, accessible pair-or-more of selectable cards backed by radio inputs. */
export function SelectionCards<Value extends string>({
    name,
    ariaLabel,
    value,
    options,
    onValueChange,
    disabled = false
}: SelectionCardsProps<Value>) {
    return (
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={ariaLabel}>
            {options.map((option) => {
                const isSelected = value === option.value

                return (
                    <label
                        key={option.value}
                        className={cn(
                            'cursor-pointer rounded-lg border p-3 transition-colors',
                            isSelected ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50',
                            disabled && 'cursor-not-allowed opacity-60'
                        )}
                    >
                        <input
                            type="radio"
                            name={name}
                            value={option.value}
                            className="sr-only"
                            checked={isSelected}
                            onChange={() => onValueChange(option.value)}
                            disabled={disabled}
                        />
                        <span className="block text-sm font-semibold">{option.title}</span>
                        <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{option.description}</span>
                    </label>
                )
            })}
        </div>
    )
}
