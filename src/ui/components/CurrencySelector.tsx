import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select'
import { Label } from './label'
import type { CurrencyCode } from '@/local-db/models'

interface CurrencySelectorProps {
    value: CurrencyCode
    onChange: (value: CurrencyCode) => void
    label?: string
    iqdDisplayPreference?: 'IQD' | 'د.ع'
}

export function CurrencySelector({ value, onChange, label, iqdDisplayPreference = 'IQD' }: CurrencySelectorProps) {
    return (
        <div className="space-y-2">
            {label && <Label>{label}</Label>}
            <Select value={value} onValueChange={(v) => onChange(v as CurrencyCode)}>
                <SelectTrigger>
                    <SelectValue placeholder="Select Currency" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="usd">USD ($)</SelectItem>
                    <SelectItem value="eur">EUR (€)</SelectItem>
                    <SelectItem value="iqd">
                        {iqdDisplayPreference === 'IQD' ? 'IQD' : 'د.ع (IQD)'}
                    </SelectItem>
                </SelectContent>
            </Select>
        </div>
    )
}
