import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { usePaymentAccounts, type PaymentAccount } from '@/local-db'
import { Label } from '@/ui/components/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/components/select'
import { PaymentAccountIcon } from './PaymentAccountIcon'

interface PaymentAccountSelectorProps {
  workspaceId?: string
  value?: string | null
  onValueChange: (account: PaymentAccount | null) => void
  disabled?: boolean
  label?: string
  cashDrawerOnly?: boolean
  /** Use false when an owning workflow requires a real payment account. */
  allowNoAccount?: boolean
  /** Payment forms can opt into their workspace's preselected account. */
  applyDefault?: boolean
  placeholder?: string
}

/** Optional by design: leaving it empty preserves a normal ledger payment. */
export function PaymentAccountSelector({
  workspaceId,
  value,
  onValueChange,
  disabled = false,
  label,
  cashDrawerOnly = false,
  allowNoAccount = true,
  applyDefault = true,
  placeholder,
}: PaymentAccountSelectorProps) {
  const { t } = useTranslation()
  const accounts = usePaymentAccounts(workspaceId)
  const options = useMemo(
    () => accounts.filter((account) => account.isActive && (!cashDrawerOnly || account.accountType === 'cash_drawer')),
    [accounts, cashDrawerOnly],
  )
  const defaultAccount = useMemo(
    () => options.find((account) => account.isDefaultForPaymentSelector) ?? null,
    [options],
  )
  const defaultWasApplied = useRef(false)
  const selectedValue = value && options.some((account) => account.id === value)
    ? value
    : allowNoAccount ? '__none__' : undefined

  useEffect(() => {
    // A workspace explicitly chooses this behavior in the account editor. The
    // primary account is intentionally irrelevant here, and an explicit
    // "No account" selection remains respected for this mounted form.
    if (!applyDefault || defaultWasApplied.current || value || !defaultAccount) return
    defaultWasApplied.current = true
    onValueChange(defaultAccount)
  }, [applyDefault, defaultAccount, onValueChange, value])

  const handleValueChange = (next: string) => {
    defaultWasApplied.current = true
    onValueChange(next === '__none__' ? null : options.find((account) => account.id === next) ?? null)
  }

  return (
    <div className="grid gap-2">
      <Label>{label ?? t('paymentAccounts.selectorLabel', { defaultValue: 'Payment Account (optional)' })}</Label>
      <Select
        value={selectedValue}
        onValueChange={handleValueChange}
        disabled={disabled}
      >
        <SelectTrigger>
          <SelectValue placeholder={placeholder ?? t('paymentAccounts.noAccount', { defaultValue: 'No account — ledger only' })} />
        </SelectTrigger>
        <SelectContent>
          {allowNoAccount ? <SelectItem value="__none__">{t('paymentAccounts.noAccount', { defaultValue: 'No account — ledger only' })}</SelectItem> : null}
          {options.map((account) => {
            return (
              <SelectItem key={account.id} value={account.id}>
                <span className="flex items-center gap-2"><PaymentAccountIcon iconKey={account.iconKey} accountType={account.accountType} className="h-4 w-4 text-muted-foreground" />{account.name}</span>
              </SelectItem>
            )
          })}
        </SelectContent>
      </Select>
    </div>
  )
}
