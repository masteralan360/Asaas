import type { PointerEvent, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Banknote, CalendarClock, CircleHelp, CreditCard, HandCoins, Landmark, Send, SlidersHorizontal } from 'lucide-react'

import {
    STANDARD_PAYMENT_METHODS,
    getPaymentMethodLabel,
    type PaymentMethodOption
} from '@/lib/paymentMethods'

import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/components/select'

interface PaymentMethodSelectProps {
    value: PaymentMethodOption
    onValueChange: (value: PaymentMethodOption) => void
    methods?: readonly PaymentMethodOption[]
    id?: string
    disabled?: boolean
    placeholder?: string
    triggerClassName?: string
    onOptionPointerDown?: (event: PointerEvent<HTMLDivElement>, method: PaymentMethodOption) => void
    renderOptionEnd?: (method: PaymentMethodOption) => ReactNode
}

function PaymentMethodVisual({ method }: { method: PaymentMethodOption }) {
    const brandLogos: Partial<Record<PaymentMethodOption, string>> = {
        fib: '/icons/payment-methods/fib.svg',
        qicard: '/icons/payment-methods/qicard.svg',
        zaincash: '/icons/payment-methods/zaincash.svg',
        fastpay: '/icons/payment-methods/fastpay.svg'
    }
    const brandLogo = brandLogos[method]

    if (brandLogo) {
        return (
            <span className="flex h-5 w-5 shrink-0 items-center">
                <img src={brandLogo} alt="" aria-hidden="true" className="h-5 w-full object-contain object-left" />
            </span>
        )
    }

    const Icon = method === 'cash'
        ? Banknote
        : method === 'bank_transfer'
            ? Landmark
            : method === 'loan'
                ? HandCoins
                : method === 'installments'
                    ? CalendarClock
                    : method === 'loan_adjustment'
                        ? SlidersHorizontal
                        : method === 'hawala'
                            ? Send
                        : method === 'credit'
                            ? CreditCard
                            : CircleHelp

    return (
        <span className="flex h-5 w-5 shrink-0 items-center">
            <Icon aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
        </span>
    )
}

export function PaymentMethodSelect({
    value,
    onValueChange,
    methods = STANDARD_PAYMENT_METHODS,
    id,
    disabled = false,
    placeholder,
    triggerClassName,
    onOptionPointerDown,
    renderOptionEnd
}: PaymentMethodSelectProps) {
    const { t } = useTranslation()

    return (
        <Select
            value={value}
            onValueChange={(nextValue) => onValueChange(nextValue as PaymentMethodOption)}
            disabled={disabled}
        >
            <SelectTrigger id={id} className={triggerClassName}>
                <SelectValue placeholder={placeholder} />
            </SelectTrigger>
            <SelectContent>
                {methods.map((method) => (
                    <SelectItem
                        key={method}
                        value={method}
                        onPointerDown={(event) => onOptionPointerDown?.(event, method)}
                    >
                        <span className="flex items-center gap-1.5">
                            <PaymentMethodVisual method={method} />
                            <span>{getPaymentMethodLabel(method, t)}</span>
                            {renderOptionEnd?.(method)}
                        </span>
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    )
}
