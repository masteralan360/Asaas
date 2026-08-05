import { Info } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/components'
import { ProductUnitIcon } from '@/ui/components/ProductUnitIcon'
import type { WorkspaceUnitOption } from '@/ui/components/unitRegistry'

interface FreeBonusUnitSelectProps {
    value: string
    productUnit?: string
    units?: WorkspaceUnitOption[]
    onValueChange: (value: string) => void
}

/**
 * Display-only unit override for a line's free bonus quantity.
 * The saved order always keeps the product unit; this only changes what the form and prints show.
 */
export function FreeBonusUnitSelect({ value, productUnit, units = [], onValueChange }: FreeBonusUnitSelectProps) {
    const { t } = useTranslation()
    const effectiveValue = value || productUnit || ''

    const handleChange = (next: string) => onValueChange(next === productUnit ? '' : next)

    return (
        <div className="space-y-1">
            <div className="flex items-center gap-1.5">
                <Label className="text-xs font-medium text-muted-foreground">
                    {t('orders.form.freeBonusDisplayUnit', { defaultValue: 'Free bonus display unit' })}
                </Label>
                <Info className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            </div>
            <Select value={effectiveValue} onValueChange={handleChange}>
                <SelectTrigger className="h-9 rounded-lg border-border/40 bg-muted/10 text-xs" allowViewer={true}>
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    {units.map((unit) => (
                        <SelectItem key={unit.value} value={unit.value}>
                            <span className="flex items-center gap-2">
                                <ProductUnitIcon unit={unit.value} iconName={unit.icon} />
                                {t(`products.units.${unit.value}`, unit.value)}
                            </span>
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
            <p className="text-[10px] leading-snug text-muted-foreground">
                {t('orders.form.freeBonusDisplayUnitHint', {
                    defaultValue: 'Display only - how the free bonus appears in this order. The saved unit stays the product unit.'
                })}
            </p>
        </div>
    )
}
