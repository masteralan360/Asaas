import type { TFunction } from 'i18next'

export const CASH_AND_DIGITAL_PAYMENT_METHODS = [
    'cash',
    'fib',
    'qicard',
    'zaincash',
    'fastpay'
] as const

export const STANDARD_PAYMENT_METHODS = [
    ...CASH_AND_DIGITAL_PAYMENT_METHODS,
    'bank_transfer'
] as const

export const ORDER_FINANCING_PAYMENT_METHODS = [
    'loan',
    'installments'
] as const

export const LOAN_ADJUSTMENT_PAYMENT_METHOD = 'loan_adjustment' as const

export const ECOMMERCE_PAYMENT_METHOD = 'ecommerce' as const

export const ACTIVITY_PAYMENT_METHODS = [
    ...STANDARD_PAYMENT_METHODS,
    'credit',
    'unknown'
] as const

export type PaymentMethodOption =
    | (typeof STANDARD_PAYMENT_METHODS)[number]
    | (typeof ORDER_FINANCING_PAYMENT_METHODS)[number]
    | typeof LOAN_ADJUSTMENT_PAYMENT_METHOD
    | typeof ECOMMERCE_PAYMENT_METHOD
    | (typeof ACTIVITY_PAYMENT_METHODS)[number]

export function getPaymentMethodLabel(method: PaymentMethodOption, t: TFunction): string {
    switch (method) {
        case 'cash':
            return t('directTransactions.paymentMethod.cash', { defaultValue: 'Cash' })
        case 'fib':
            return t('directTransactions.paymentMethod.fib', { defaultValue: 'FIB' })
        case 'qicard':
            return t('directTransactions.paymentMethod.qicard', { defaultValue: 'QiCard' })
        case 'zaincash':
            return t('directTransactions.paymentMethod.zaincash', { defaultValue: 'ZainCash' })
        case 'fastpay':
            return t('directTransactions.paymentMethod.fastpay', { defaultValue: 'FastPay' })
        case 'bank_transfer':
            return t('directTransactions.paymentMethod.bankTransfer', { defaultValue: 'Bank Transfer' })
        case 'loan':
            return t('nav.loans', { defaultValue: 'Loans' })
        case 'installments':
            return t('nav.installments', { defaultValue: 'Installments' })
        case 'loan_adjustment':
            return t('directTransactions.paymentMethod.loanAdjustment', { defaultValue: 'Loan Adjustment' })
        case 'ecommerce':
            return t('directTransactions.paymentMethod.ecommerce', { defaultValue: 'E-Commerce' })
        case 'hawala':
            return t('directTransactions.paymentMethod.hawala', { defaultValue: 'Hawala' })
        case 'credit':
            return t('activities.paymentMethods.credit', { defaultValue: 'Credit' })
        case 'unknown':
            return t('activities.paymentMethods.unknown', { defaultValue: 'Unknown' })
    }
}
