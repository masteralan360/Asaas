import { useEffect } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select'
import { Label } from './label'
import type { CurrencyCode } from '@/local-db/models'
import { useWorkspace } from '@/workspace'

interface CurrencySelectorProps {
    value: CurrencyCode
    onChange: (value: CurrencyCode) => void
    label?: string
    iqdDisplayPreference?: 'IQD' | 'د.ع'
    disabled?: boolean
}

export function CurrencySelector({ value, onChange, label, iqdDisplayPreference = 'IQD', disabled }: CurrencySelectorProps) {
    const { features, hasCapability } = useWorkspace()
    const canUseMultiCurrency = hasCapability('multiCurrency')
    const defaultCurrency = features.default_currency || 'usd'

    useEffect(() => {
        if (!canUseMultiCurrency && value !== defaultCurrency) {
            onChange(defaultCurrency)
        }
    }, [canUseMultiCurrency, defaultCurrency, onChange, value])

    if (!canUseMultiCurrency) {
        return null
    }

    return (
        <div className="space-y-2">
            {label && <Label>{label}</Label>}
            <Select value={value} onValueChange={(v) => onChange(v as CurrencyCode)} disabled={disabled}>
                <SelectTrigger allowViewer={true}>
                    <SelectValue placeholder="Select Currency" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="usd">USD ($)</SelectItem>
                    <SelectItem value="eur">EUR (€)</SelectItem>
                    <SelectItem value="try">TRY (₺)</SelectItem>
                    <SelectItem value="iqd">
                        {iqdDisplayPreference === 'IQD' ? 'IQD' : 'د.ع (IQD)'}
                    </SelectItem>
                </SelectContent>
            </Select>
        </div>
    )
}
