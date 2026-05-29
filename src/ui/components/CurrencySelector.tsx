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
    allowedCurrencies?: CurrencyCode[]
}

const CURRENCY_LABELS: Record<string, { label: string; symbol: string }> = {
    usd: { label: 'USD', symbol: '$' },
    eur: { label: 'EUR', symbol: '€' },
    try: { label: 'TRY', symbol: '₺' },
    iqd: { label: 'IQD', symbol: '' }
}

export function CurrencySelector({ value, onChange, label, iqdDisplayPreference = 'IQD', disabled, allowedCurrencies }: CurrencySelectorProps) {
    const { features } = useWorkspace()
    const defaultCurrency = features.default_currency || 'usd'

    useEffect(() => {
        if (!allowedCurrencies && features.allowed_currencies.length <= 1 && value !== defaultCurrency) {
            onChange(defaultCurrency)
        }
    }, [features.allowed_currencies, allowedCurrencies, defaultCurrency, onChange, value])

    if (!allowedCurrencies && features.allowed_currencies.length <= 1) {
        return null
    }

    const currencies = allowedCurrencies ?? features.allowed_currencies

    return (
        <div className="space-y-2">
            {label && <Label>{label}</Label>}
            <Select value={value} onValueChange={(v) => onChange(v as CurrencyCode)} disabled={disabled}>
                <SelectTrigger allowViewer={true}>
                    <SelectValue placeholder="Select Currency" />
                </SelectTrigger>
                <SelectContent>
                    {currencies.map((code) => {
                        const info = CURRENCY_LABELS[code]
                        if (code === 'iqd') {
                            return (
                                <SelectItem key="iqd" value="iqd">
                                    {iqdDisplayPreference === 'IQD' ? 'IQD' : 'د.ع (IQD)'}
                                </SelectItem>
                            )
                        }
                        return (
                            <SelectItem key={code} value={code}>
                                {info ? `${info.label} (${info.symbol})` : code.toUpperCase()}
                            </SelectItem>
                        )
                    })}
                </SelectContent>
            </Select>
        </div>
    )
}
