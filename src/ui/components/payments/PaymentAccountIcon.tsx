import type { LucideIcon } from 'lucide-react'
import {
  ArrowLeftRight,
  Banknote,
  Building2,
  Coins,
  CreditCard,
  Landmark,
  ReceiptText,
  Smartphone,
  Store,
  WalletCards,
} from 'lucide-react'

import type { PaymentAccountIconKey, PaymentAccountType } from '@/local-db'
import { cn } from '@/lib/utils'

export const PAYMENT_ACCOUNT_ICON_OPTIONS: Array<{ key: PaymentAccountIconKey; labelKey: string }> = [
  { key: 'cash_drawer', labelKey: 'paymentAccounts.iconNames.cashDrawer' },
  { key: 'bank', labelKey: 'paymentAccounts.iconNames.bank' },
  { key: 'wallet', labelKey: 'paymentAccounts.iconNames.wallet' },
  { key: 'card', labelKey: 'paymentAccounts.iconNames.card' },
  { key: 'phone', labelKey: 'paymentAccounts.iconNames.phone' },
  { key: 'transfer', labelKey: 'paymentAccounts.iconNames.transfer' },
  { key: 'coins', labelKey: 'paymentAccounts.iconNames.coins' },
  { key: 'receipt', labelKey: 'paymentAccounts.iconNames.receipt' },
  { key: 'building', labelKey: 'paymentAccounts.iconNames.building' },
  { key: 'store', labelKey: 'paymentAccounts.iconNames.store' },
  { key: 'fib', labelKey: 'paymentAccounts.iconNames.fib' },
  { key: 'qicard', labelKey: 'paymentAccounts.iconNames.qicard' },
  { key: 'zaincash', labelKey: 'paymentAccounts.iconNames.zaincash' },
  { key: 'fastpay', labelKey: 'paymentAccounts.iconNames.fastpay' },
]

const ICONS: Partial<Record<PaymentAccountIconKey, LucideIcon>> = {
  cash_drawer: Banknote,
  bank: Landmark,
  wallet: WalletCards,
  card: CreditCard,
  phone: Smartphone,
  transfer: ArrowLeftRight,
  coins: Coins,
  receipt: ReceiptText,
  building: Building2,
  store: Store,
}

// Keep these paths aligned with PaymentMethodSelect so account customization
// uses the same official provider SVGs everywhere in Atlas.
const BRAND_LOGOS: Partial<Record<PaymentAccountIconKey, string>> = {
  fib: '/icons/payment-methods/fib.svg',
  qicard: '/icons/payment-methods/qicard.svg',
  zaincash: '/icons/payment-methods/zaincash.svg',
  fastpay: '/icons/payment-methods/fastpay.svg',
}

export function defaultPaymentAccountIcon(accountType?: PaymentAccountType | null): PaymentAccountIconKey {
  switch (accountType) {
    case 'bank_account': return 'bank'
    case 'digital_wallet': return 'wallet'
    case 'other': return 'card'
    default: return 'cash_drawer'
  }
}

export function paymentAccountIconKey(
  iconKey?: PaymentAccountIconKey | null,
  accountType?: PaymentAccountType | null,
): PaymentAccountIconKey {
  return iconKey && PAYMENT_ACCOUNT_ICON_OPTIONS.some((option) => option.key === iconKey)
    ? iconKey
    : defaultPaymentAccountIcon(accountType)
}

interface PaymentAccountIconProps {
  iconKey?: PaymentAccountIconKey | null
  accountType?: PaymentAccountType | null
  className?: string
  title?: string
}

/** Renders the same account mark in account cards and every payment selector. */
export function PaymentAccountIcon({ iconKey, accountType, className, title }: PaymentAccountIconProps) {
  const key = paymentAccountIconKey(iconKey, accountType)
  const brandLogo = BRAND_LOGOS[key]

  if (brandLogo) {
    return (
      <span
        aria-hidden={title ? undefined : true}
        aria-label={title}
        title={title}
        className={cn('inline-flex shrink-0 items-center justify-center', className)}
      >
        <img src={brandLogo} alt="" aria-hidden="true" className="h-full w-full object-contain" />
      </span>
    )
  }

  const Icon = ICONS[key] ?? Banknote
  if (title) {
    return (
      <span title={title} aria-label={title} className="inline-flex shrink-0">
        <Icon aria-hidden="true" className={className} />
      </span>
    )
  }

  return <Icon aria-hidden="true" className={className} />
}
