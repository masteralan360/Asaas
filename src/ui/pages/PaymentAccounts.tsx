import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDownLeft, ArrowUpRight, LockKeyhole, Plus, RotateCcw, Search, SlidersHorizontal, Trash2, WalletCards, X } from 'lucide-react'

import { useAuth } from '@/auth'
import { useDateRange } from '@/context/DateRangeContext'
import {
  deletePaymentAccount,
  getPaymentAccountBalanceSummary,
  savePaymentAccount,
  usePaymentAccountBalances,
  usePaymentAccountMovements,
  usePaymentAccounts,
  DIGITAL_WALLET_PAYMENT_METHODS,
  type CurrencyCode,
  type DigitalWalletPaymentMethod,
  type PaymentAccount,
  type PaymentAccountMovement,
  type PaymentAccountIconKey,
  type PaymentAccountType,
  type PaymentTransaction,
  usePaymentTransactions,
} from '@/local-db'
import { cn, formatCurrency, formatDateTime, formatNumericInput, parseFormattedNumber, sanitizeNumericInput } from '@/lib/utils'
import { isDateInDateRange } from '@/lib/dateRangeFilters'
import {
  AppDialog,
  AppDialogBody,
  AppDialogContent,
  AppDialogFooter,
  AppDialogHeader,
  AppDialogTitle,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DateRangeFilters,
  Checkbox,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  useToast,
  PaymentMethodSelector,
} from '@/ui/components'
import { DeleteConfirmationModal } from '@/ui/components/DeleteConfirmationModal'
import { CurrencySelector } from '@/ui/components/CurrencySelector'
import { defaultPaymentAccountIcon, PAYMENT_ACCOUNT_ICON_OPTIONS, PaymentAccountIcon } from '@/ui/components/payments/PaymentAccountIcon'
import { useWorkspace } from '@/workspace'

const ACCOUNT_TYPES: PaymentAccountType[] = ['cash_drawer', 'bank_account', 'digital_wallet', 'other']
const CURRENCIES: CurrencyCode[] = ['iqd', 'usd', 'eur', 'try']
const MAX_OPENING_BALANCE_CURRENCIES = 4

interface OpeningBalanceRow {
  currency: CurrencyCode
  amount: string
}

function accountTypeLabel(type: PaymentAccountType, t: ReturnType<typeof useTranslation>['t']) {
  return t(`paymentAccounts.types.${type}`, { defaultValue: type.replace(/_/g, ' ') })
}

type AccountMovementRelationRole = 'origin' | 'repayment' | 'settlement'
type AccountMovementSort = 'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc'

interface AccountMovementFilters {
  search: string
  direction: 'all' | 'incoming' | 'outgoing'
  currency: 'all' | CurrencyCode
  minAmount: string
  maxAmount: string
  sort: AccountMovementSort
}

interface AccountMovementEntry {
  id: string
  movement: PaymentAccountMovement
  transaction: PaymentTransaction | null
  relationKey: string | null
  relationRole: AccountMovementRelationRole | null
}

const DEFAULT_MOVEMENT_FILTERS: AccountMovementFilters = {
  search: '',
  direction: 'all',
  currency: 'all',
  minAmount: '',
  maxAmount: '',
  sort: 'date_desc',
}

function humanizeIdentifier(value: string) {
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function sourceModuleLabel(transaction: PaymentTransaction | null, t: ReturnType<typeof useTranslation>['t']) {
  switch (transaction?.sourceModule) {
    case 'sales': return t('ledger.sourceModule.pos', { defaultValue: 'POS' })
    case 'loans': return t('ledger.sourceModule.loans', { defaultValue: 'Loans' })
    case 'orders': return t('ledger.sourceModule.orders', { defaultValue: 'Orders' })
    case 'budget': return t('navigation.modules.budget', { defaultValue: 'Budget' })
    case 'real_estate': return t('ledger.sourceModule.realEstate', { defaultValue: 'Real Estate' })
    case 'activities': return t('ledger.sourceModule.activities', { defaultValue: 'Activities' })
    case 'clinical_appointments': return t('ledger.sourceModule.clinicalAppointments', { defaultValue: 'Appointments' })
    case 'post_service': return t('ledger.sourceModule.postService', { defaultValue: 'Post Service' })
    case 'car_rental': return t('ledger.sourceModule.carRental', { defaultValue: 'Car Rental' })
    case 'travel_agency': return t('paymentAccounts.sourceModules.travelAgency', { defaultValue: 'Travel Agency' })
    case 'payments': return transaction?.sourceType === 'payment_account_opening_balance'
      ? t('paymentAccounts.title', { defaultValue: 'Payment Accounts' })
      : t('ledger.sourceModule.manual', { defaultValue: 'Manual' })
    default: return transaction?.sourceModule ? humanizeIdentifier(transaction.sourceModule) : '—'
  }
}

function movementTypeLabel(transaction: PaymentTransaction | null, t: ReturnType<typeof useTranslation>['t']) {
  if (!transaction) return t('paymentAccounts.unknownMovement', { defaultValue: 'Recorded movement' })

  switch (transaction.sourceType) {
    case 'pos_sale': return t('ledger.type.posSale', { defaultValue: 'POS Sale' })
    case 'travel_agency_sale': return t('paymentAccounts.transactionTypes.travelSale', { defaultValue: 'Travel Sale' })
    case 'loan_origination': return transaction.direction === 'incoming'
      ? t('ledger.type.loanTaken', { defaultValue: 'Loan Taken' })
      : t('ledger.type.loanGiven', { defaultValue: 'Loan Given' })
    case 'loan_payment': return transaction.direction === 'incoming'
      ? t('ledger.type.loanRepaymentReceived', { defaultValue: 'Loan Repayment Received' })
      : t('ledger.type.loanRepaymentPaid', { defaultValue: 'Loan Repayment Paid' })
    case 'simple_loan': return transaction.direction === 'incoming'
      ? t('ledger.type.loanRepaymentReceived', { defaultValue: 'Loan Repayment Received' })
      : t('ledger.type.loanRepaymentPaid', { defaultValue: 'Loan Repayment Paid' })
    case 'loan_installment': return transaction.direction === 'incoming'
      ? t('ledger.type.installmentReceived', { defaultValue: 'Installment Received' })
      : t('ledger.type.installmentPaid', { defaultValue: 'Installment Paid' })
    case 'real_estate_commission': return t('ledger.type.realEstateCommission', { defaultValue: 'Real Estate Commission' })
    case 'agent_commission_payout': return t('ledger.type.agentCommissionPayout', { defaultValue: 'Agent Commission Payout' })
    case 'activity_transaction': return t('ledger.type.activityTransaction', { defaultValue: 'Activity Transaction' })
    case 'activity_refund': return t('ledger.type.activityRefund', { defaultValue: 'Activity Refund' })
    case 'clinical_appointment': return t('ledger.type.clinicalAppointmentPayment', { defaultValue: 'Appointment Payment' })
    case 'sales_order': return t('ledger.type.salesOrderPayment', { defaultValue: 'Sales Order Payment' })
    case 'purchase_order': return t('ledger.type.purchaseOrderPayment', { defaultValue: 'Purchase Order Payment' })
    case 'order_return': return t('paymentAccounts.transactionTypes.orderReturn', { defaultValue: 'Order Return' })
    case 'expense_item': return t('ledger.type.expense', { defaultValue: 'Expense' })
    case 'payroll_status': return t('ledger.type.payrollPayment', { defaultValue: 'Payroll Payment' })
    case 'direct_transaction': return transaction.direction === 'incoming'
      ? t('ledger.type.directInflow', { defaultValue: 'Direct Inflow' })
      : t('ledger.type.directOutflow', { defaultValue: 'Direct Outflow' })
    case 'payment_account_opening_balance': return t('paymentAccounts.openingBalance', { defaultValue: 'Opening Balance' })
    case 'delivery_courier_remittance': return t('ledger.type.deliveryCourierRemittance', { defaultValue: 'Courier Remittance' })
    case 'delivery_courier_fee_payout': return t('ledger.type.deliveryCourierFeePayout', { defaultValue: 'Courier Fee Payment' })
    case 'delivery_merchant_payout': return t('ledger.type.deliveryMerchantPayout', { defaultValue: 'Merchant Payout' })
    case 'delivery_recipient_payout': return t('ledger.type.deliveryRecipientPayout', { defaultValue: 'Recipient Payout' })
    case 'delivery_merchant_repayment': return t('ledger.type.deliveryMerchantRepayment', { defaultValue: 'Merchant Repayment' })
    case 'rental_payment': return t('ledger.type.rentalPayment', { defaultValue: 'Rental Payment' })
    case 'rental_deposit': return t('ledger.type.rentalDeposit', { defaultValue: 'Security Deposit' })
    case 'rental_deposit_refund': return t('ledger.type.rentalDepositRefund', { defaultValue: 'Security Deposit Refund' })
    default: return humanizeIdentifier(transaction.sourceType)
  }
}

function paymentMethodLabel(value: string | null | undefined, t: ReturnType<typeof useTranslation>['t']) {
  if (!value) return '—'
  const key = value === 'bank_transfer' ? 'bankTransfer' : value
  return t(`ledger.paymentMethod.${key}`, { defaultValue: humanizeIdentifier(value) })
}

function movementSortLabel(sort: AccountMovementSort, t: ReturnType<typeof useTranslation>['t']) {
  switch (sort) {
    case 'date_asc': return t('ledger.sortOption.dateAsc', { defaultValue: 'Date: Oldest First' })
    case 'amount_desc': return t('ledger.sortOption.amountDesc', { defaultValue: 'Amount: Highest First' })
    case 'amount_asc': return t('ledger.sortOption.amountAsc', { defaultValue: 'Amount: Lowest First' })
    default: return t('ledger.sortOption.dateDesc', { defaultValue: 'Date: Newest First' })
  }
}

function paymentAccountMovementRelationKey(transaction: PaymentTransaction | null) {
  if (!transaction) return null

  switch (transaction.sourceType) {
    case 'loan_origination':
    case 'loan_payment':
    case 'simple_loan':
    case 'loan_installment':
      return `loan:${transaction.sourceRecordId}`
    default:
      return `${transaction.sourceType}:${transaction.sourceRecordId}`
  }
}

function countActiveMovementFilters(filters: AccountMovementFilters) {
  return [
    !!filters.search.trim(),
    filters.direction !== 'all',
    filters.currency !== 'all',
    !!filters.minAmount,
    !!filters.maxAmount,
    filters.sort !== 'date_desc',
  ].filter(Boolean).length
}

function formatMovementTotals(
  movements: PaymentAccountMovement[],
  iqdDisplayPreference: 'IQD' | 'د.ع',
  amountFor: (movement: PaymentAccountMovement) => number,
) {
  const totals = new Map<CurrencyCode, number>()
  movements.forEach((movement) => {
    totals.set(movement.currency, (totals.get(movement.currency) || 0) + amountFor(movement))
  })

  if (totals.size === 0) return '—'

  return Array.from(totals.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, amount]) => `${amount < 0 ? '−' : ''}${formatCurrency(Math.abs(amount), currency, iqdDisplayPreference)}`)
    .join(' · ')
}

function buildRelationMaps(entries: AccountMovementEntry[]) {
  const counts = new Map<string, number>()
  const ranges = new Map<string, { firstIndex: number; lastIndex: number }>()

  entries.forEach((entry, index) => {
    if (!entry.relationKey) return
    counts.set(entry.relationKey, (counts.get(entry.relationKey) || 0) + 1)
    const current = ranges.get(entry.relationKey)
    if (current) current.lastIndex = index
    else ranges.set(entry.relationKey, { firstIndex: index, lastIndex: index })
  })

  return { counts, ranges }
}

function applyMovementFilters(entries: AccountMovementEntry[], filters: AccountMovementFilters) {
  const normalizedSearch = filters.search.trim().toLowerCase()
  const minimum = filters.minAmount ? parseFormattedNumber(filters.minAmount) : null
  const maximum = filters.maxAmount ? parseFormattedNumber(filters.maxAmount) : null
  const matching = entries.filter((entry) => {
    const { movement, transaction } = entry
    if (filters.direction !== 'all' && movement.direction !== filters.direction) return false
    if (filters.currency !== 'all' && movement.currency !== filters.currency) return false
    if (minimum !== null && Number.isFinite(minimum) && Math.abs(movement.amount) < minimum) return false
    if (maximum !== null && Number.isFinite(maximum) && Math.abs(movement.amount) > maximum) return false
    if (!normalizedSearch) return true

    return [
      movement.paymentTransactionId,
      transaction?.referenceLabel,
      transaction?.counterpartyName,
      transaction?.note,
      transaction?.sourceModule,
      transaction?.sourceType,
      transaction?.paymentMethod,
    ].some((value) => value?.toLowerCase().includes(normalizedSearch))
  })

  return matching.sort((left, right) => {
    if (filters.sort === 'date_asc') return left.movement.occurredAt.localeCompare(right.movement.occurredAt)
    if (filters.sort === 'amount_desc') return Math.abs(right.movement.amount) - Math.abs(left.movement.amount)
    if (filters.sort === 'amount_asc') return Math.abs(left.movement.amount) - Math.abs(right.movement.amount)
    return right.movement.occurredAt.localeCompare(left.movement.occurredAt)
  })
}

export function PaymentAccounts() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const { user } = useAuth()
  const { features } = useWorkspace()
  const { dateRange, customDates } = useDateRange()
  const workspaceId = user?.workspaceId
  const accounts = usePaymentAccounts(workspaceId)
  const balances = usePaymentAccountBalances(workspaceId)
  const movements = usePaymentAccountMovements(workspaceId)
  const paymentTransactions = usePaymentTransactions(workspaceId, { includeReversals: true })

  const [accountDialogOpen, setAccountDialogOpen] = useState(false)
  const [editingAccount, setEditingAccount] = useState<PaymentAccount | null>(null)
  const [accountName, setAccountName] = useState('')
  const [accountType, setAccountType] = useState<PaymentAccountType>('cash_drawer')
  const [linkedPaymentMethod, setLinkedPaymentMethod] = useState<DigitalWalletPaymentMethod | null>(null)
  const [accountIconKey, setAccountIconKey] = useState<PaymentAccountIconKey>('cash_drawer')
  const [accountNotes, setAccountNotes] = useState('')
  const [openingBalanceRows, setOpeningBalanceRows] = useState<OpeningBalanceRow[]>([])
  const [makePrimary, setMakePrimary] = useState(false)
  const [preselectInPaymentForms, setPreselectInPaymentForms] = useState(false)
  const [iconPickerOpen, setIconPickerOpen] = useState(false)
  const [accountPendingDeletion, setAccountPendingDeletion] = useState<PaymentAccount | null>(null)
  const [saving, setSaving] = useState(false)
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null)
  const [hoveredRelationKey, setHoveredRelationKey] = useState<string | null>(null)
  const [movementFilters, setMovementFilters] = useState<AccountMovementFilters>(DEFAULT_MOVEMENT_FILTERS)
  const [draftMovementFilters, setDraftMovementFilters] = useState<AccountMovementFilters>(DEFAULT_MOVEMENT_FILTERS)
  const [movementFilterDialogOpen, setMovementFilterDialogOpen] = useState(false)

  const selectedAccount = useMemo(
    () => accounts.find((account) => account.id === selectedAccountId) ?? null,
    [accounts, selectedAccountId],
  )
  const activeAccountCount = useMemo(
    () => accounts.filter((account) => account.isActive).length,
    [accounts],
  )
  const isFirstAccount = !editingAccount && activeAccountCount === 0
  const isEditingPrimary = !!editingAccount?.isPrimary
  const openingBalanceCurrencies = useMemo(
    () => CURRENCIES.filter((currency) => features.allowed_currencies.includes(currency)),
    [features.allowed_currencies],
  )
  const canAddOpeningBalanceCurrency = !editingAccount
    && openingBalanceRows.length < Math.min(MAX_OPENING_BALANCE_CURRENCIES, openingBalanceCurrencies.length)
  const selectedAccountBalances = useMemo(
    () => selectedAccount ? getPaymentAccountBalanceSummary(balances, selectedAccount.id) : [],
    [balances, selectedAccount],
  )
  const transactionById = useMemo(
    () => new Map(paymentTransactions.map((transaction) => [transaction.id, transaction])),
    [paymentTransactions],
  )
  const selectedAccountMovements = useMemo(
    () => selectedAccountId ? movements.filter((movement) => movement.accountId === selectedAccountId) : [],
    [movements, selectedAccountId],
  )
  const dateScopedMovements = useMemo(
    () => selectedAccountMovements.filter((movement) => isDateInDateRange(movement.occurredAt, dateRange, customDates)),
    [customDates, dateRange, selectedAccountMovements],
  )
  const movementEntries = useMemo<AccountMovementEntry[]>(
    () => dateScopedMovements.map((movement) => {
      const transaction = transactionById.get(movement.paymentTransactionId) ?? null
      const relationKey = paymentAccountMovementRelationKey(transaction)
      const relationRole: AccountMovementRelationRole | null = transaction
        ? transaction.sourceType === 'loan_origination'
          ? 'origin'
          : transaction.sourceType === 'loan_payment' || transaction.sourceType === 'loan_installment' || transaction.sourceType === 'simple_loan'
            ? 'repayment'
            : 'settlement'
        : null

      return { id: movement.id, movement, transaction, relationKey, relationRole }
    }),
    [dateScopedMovements, transactionById],
  )
  const filteredMovementEntries = useMemo(
    () => applyMovementFilters(movementEntries, movementFilters),
    [movementEntries, movementFilters],
  )
  const draftPreviewMovementEntries = useMemo(
    () => applyMovementFilters(movementEntries, draftMovementFilters),
    [draftMovementFilters, movementEntries],
  )
  const movementRelationMaps = useMemo(
    () => buildRelationMaps(filteredMovementEntries),
    [filteredMovementEntries],
  )
  const activeMovementFilterCount = useMemo(
    () => countActiveMovementFilters(movementFilters),
    [movementFilters],
  )
  const movementInflows = useMemo(
    () => filteredMovementEntries.filter(({ movement }) => movement.direction === 'incoming').map(({ movement }) => movement),
    [filteredMovementEntries],
  )
  const movementOutflows = useMemo(
    () => filteredMovementEntries.filter(({ movement }) => movement.direction === 'outgoing').map(({ movement }) => movement),
    [filteredMovementEntries],
  )
  const postedBalance = useMemo(
    () => selectedAccountBalances.length
      ? selectedAccountBalances.map((balance) => formatCurrency(balance.balanceAmount, balance.currency, features.iqd_display_preference)).join(' · ')
      : '—',
    [features.iqd_display_preference, selectedAccountBalances],
  )

  useEffect(() => {
    if (selectedAccountId && !accounts.some((account) => account.id === selectedAccountId)) {
      setSelectedAccountId(null)
    }
  }, [accounts, selectedAccountId])

  useEffect(() => {
    if (hoveredRelationKey && !filteredMovementEntries.some((entry) => entry.relationKey === hoveredRelationKey)) {
      setHoveredRelationKey(null)
    }
  }, [filteredMovementEntries, hoveredRelationKey])

  useEffect(() => {
    if (movementFilterDialogOpen) setDraftMovementFilters(movementFilters)
  }, [movementFilterDialogOpen, movementFilters])

  const resetAccountForm = (account?: PaymentAccount | null) => {
    setEditingAccount(account ?? null)
    setAccountName(account?.name ?? '')
    setAccountType(account?.accountType ?? 'cash_drawer')
    setLinkedPaymentMethod(account?.linkedPaymentMethod ?? null)
    setAccountIconKey(account?.iconKey ?? defaultPaymentAccountIcon(account?.accountType ?? 'cash_drawer'))
    setAccountNotes(account?.notes ?? '')
    setOpeningBalanceRows([])
    setMakePrimary(account?.isPrimary ?? false)
    setPreselectInPaymentForms(account?.isDefaultForPaymentSelector ?? false)
    setIconPickerOpen(false)
  }

  const openAccountDialog = (account?: PaymentAccount) => {
    resetAccountForm(account)
    setAccountDialogOpen(true)
  }

  const updateOpeningBalanceRow = (index: number, next: Partial<OpeningBalanceRow>) => {
    setOpeningBalanceRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...next } : row))
  }

  const removeOpeningBalanceRow = (index: number) => {
    setOpeningBalanceRows((current) => current.filter((_, rowIndex) => rowIndex !== index))
  }

  const addOpeningBalanceCurrency = () => {
    setOpeningBalanceRows((current) => {
      if (current.length >= Math.min(MAX_OPENING_BALANCE_CURRENCIES, openingBalanceCurrencies.length)) return current
      const selectedCurrencies = new Set(current.map((row) => row.currency))
      const nextCurrency = openingBalanceCurrencies.find((currency) => !selectedCurrencies.has(currency))
      return nextCurrency ? [...current, { currency: nextCurrency, amount: '' }] : current
    })
  }

  const saveAccount = async () => {
    if (!workspaceId || !accountName.trim()) return
    setSaving(true)
    try {
      await savePaymentAccount(workspaceId, {
        id: editingAccount?.id,
        name: accountName,
        accountType,
        linkedPaymentMethod,
        iconKey: accountIconKey,
        notes: accountNotes,
        isActive: editingAccount?.isActive ?? true,
        isPrimary: isFirstAccount || isEditingPrimary || makePrimary,
        isDefaultForPaymentSelector: preselectInPaymentForms,
        createdBy: user?.id ?? null,
        openingBalances: editingAccount
          ? undefined
          : openingBalanceRows
            .map((row) => ({ currency: row.currency, amount: parseFormattedNumber(row.amount) }))
            .filter((row) => Number.isFinite(row.amount) && row.amount > 0),
      })
      toast({ title: t('paymentAccounts.saved', { defaultValue: 'Payment account saved' }) })
      setAccountDialogOpen(false)
    } catch (error: any) {
      toast({ title: t('common.error', { defaultValue: 'Error' }), description: error?.message, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const removeAccount = async () => {
    if (!workspaceId || !accountPendingDeletion) return
    setSaving(true)
    try {
      const { fallbackPrimary } = await deletePaymentAccount(workspaceId, accountPendingDeletion.id)
      if (selectedAccountId === accountPendingDeletion.id) setSelectedAccountId(fallbackPrimary?.id ?? null)
      toast({ title: t('paymentAccounts.removed', { defaultValue: 'Payment account removed' }) })
      setAccountPendingDeletion(null)
      setAccountDialogOpen(false)
    } catch (error: any) {
      toast({ title: t('common.error', { defaultValue: 'Error' }), description: error?.message, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  if (!workspaceId) return null

  return (
    <div className="space-y-8 p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('paymentAccounts.title', { defaultValue: 'Payment Accounts' })}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('paymentAccounts.subtitle', { defaultValue: 'Optional payment destinations. Payments without an account remain normal ledger transactions.' })}</p>
        </div>
        <Button onClick={() => openAccountDialog()}><Plus className="mr-2 h-4 w-4" />{t('paymentAccounts.newAccount', { defaultValue: 'New Payment Account' })}</Button>
      </div>

      <Card className="overflow-hidden">
        <CardHeader className="border-b border-border/60 pb-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>{t('paymentAccounts.accountsSectionTitle', { defaultValue: 'Payment Accounts' })}</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">{t('paymentAccounts.accountsSectionDescription', { defaultValue: 'Choose one account to inspect its posted movement trail.' })}</p>
            </div>
            <span className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
              {t('paymentAccounts.accountCount', { count: accounts.length, defaultValue: 'Accounts: {{count}}' })}
            </span>
          </div>
        </CardHeader>
        <CardContent className="pt-6">
          {accounts.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">{t('paymentAccounts.empty', { defaultValue: 'No payment accounts yet. Create one when you want a payment to carry account context.' })}</div>
          ) : (
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label={t('paymentAccounts.accountsSectionTitle', { defaultValue: 'Payment Accounts' })}>
              {accounts.map((account) => {
                const accountBalances = getPaymentAccountBalanceSummary(balances, account.id)
                const isSelected = selectedAccountId === account.id
                return (
                  <Card
                    key={account.id}
                    role="button"
                    tabIndex={0}
                    aria-pressed={isSelected}
                    onClick={() => setSelectedAccountId(account.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        setSelectedAccountId(account.id)
                      }
                    }}
                    className={cn(
                      'cursor-pointer border-border/60 transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      isSelected && 'border-primary ring-1 ring-primary',
                      !account.isActive && 'opacity-60',
                    )}
                  >
                    <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="rounded-xl bg-primary/10 p-2 text-primary"><PaymentAccountIcon iconKey={account.iconKey} accountType={account.accountType} className="h-5 w-5" /></span>
                        <div className="min-w-0">
                          <CardTitle className="truncate text-base">{account.name}</CardTitle>
                          <p className="mt-1 text-xs text-muted-foreground">{accountTypeLabel(account.accountType, t)}</p>
                          {account.linkedPaymentMethod ? <p className="mt-1 text-xs font-medium text-primary">{t('paymentAccounts.linkedPaymentMethod', { defaultValue: 'Linked payment method' })}: {paymentMethodLabel(account.linkedPaymentMethod, t)}</p> : null}
                        </div>
                      </div>
                      <Button variant="ghost" size="sm" onClick={(event) => { event.stopPropagation(); openAccountDialog(account) }}>{t('common.edit', { defaultValue: 'Edit' })}</Button>
                    </CardHeader>
                    <CardContent>
                      <div className="flex flex-wrap gap-2">
                        {account.isPrimary ? <span className="rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">{t('paymentAccounts.primaryAccount', { defaultValue: 'Primary account' })}</span> : null}
                        {account.isDefaultForPaymentSelector ? <span className="rounded-full border border-sky-500/20 bg-sky-500/10 px-2.5 py-1 text-xs font-semibold text-sky-700">{t('paymentAccounts.preselectedForPayments', { defaultValue: 'Preselected in payment forms' })}</span> : null}
                        {accountBalances.length
                          ? accountBalances.map((balance) => <span key={balance.id} className="rounded-full border bg-muted/40 px-2.5 py-1 text-xs font-semibold">{formatCurrency(balance.balanceAmount, balance.currency, features.iqd_display_preference)}</span>)
                          : <span className="text-sm text-muted-foreground">{t('paymentAccounts.noBalance', { defaultValue: 'No posted balance' })}</span>}
                      </div>
                      {account.notes ? <p className="mt-3 line-clamp-2 text-xs text-muted-foreground">{account.notes}</p> : null}
                    </CardContent>
                  </Card>
                )
              })}
            </section>
          )}
        </CardContent>
      </Card>

      {!selectedAccount ? (
        <Card className="border-dashed">
          <CardContent className="py-14 text-center">
            <WalletCards className="mx-auto h-8 w-8 text-primary" />
            <h2 className="mt-4 text-lg font-semibold">{t('paymentAccounts.selectAccountTitle', { defaultValue: 'Select an account' })}</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{t('paymentAccounts.selectAccountDescription', { defaultValue: 'Choose a payment account above to view its totals, filters, and complete movement history.' })}</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <section className="space-y-4" aria-label={t('paymentAccounts.accountOverview', { defaultValue: 'Account overview' })}>
            <div className="flex flex-wrap items-center gap-3">
              <span className="rounded-xl bg-primary/10 p-2 text-primary"><PaymentAccountIcon iconKey={selectedAccount.iconKey} accountType={selectedAccount.accountType} className="h-5 w-5" /></span>
              <h2 className="text-xl font-bold tracking-tight">{selectedAccount.name}</h2>
              <span className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">{t('paymentAccounts.selectedAccount', { defaultValue: 'Selected account' })}</span>
              {selectedAccount.isPrimary ? <span className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">{t('paymentAccounts.primaryAccount', { defaultValue: 'Primary account' })}</span> : null}
              {selectedAccount.isDefaultForPaymentSelector ? <span className="rounded-full border border-sky-500/20 bg-sky-500/10 px-3 py-1 text-xs font-semibold text-sky-700">{t('paymentAccounts.preselectedForPayments', { defaultValue: 'Preselected in payment forms' })}</span> : null}
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Card><CardContent className="min-h-36 p-6"><p className="text-xs font-bold uppercase tracking-wide text-emerald-700">{t('ledger.kpis.totalInflow', { defaultValue: 'Total Inflow' })}</p><p className="mt-4 break-words text-2xl font-black text-emerald-700">{formatMovementTotals(movementInflows, features.iqd_display_preference, (movement) => movement.amount)}</p><p className="mt-2 text-xs text-muted-foreground">{t('paymentAccounts.currentPageRange', { defaultValue: 'Current selected range' })}</p></CardContent></Card>
              <Card><CardContent className="min-h-36 p-6"><p className="text-xs font-bold uppercase tracking-wide text-amber-700">{t('ledger.kpis.totalOutflow', { defaultValue: 'Total Outflow' })}</p><p className="mt-4 break-words text-2xl font-black text-amber-700">{formatMovementTotals(movementOutflows, features.iqd_display_preference, (movement) => movement.amount)}</p><p className="mt-2 text-xs text-muted-foreground">{t('paymentAccounts.currentPageRange', { defaultValue: 'Current selected range' })}</p></CardContent></Card>
              <Card><CardContent className="min-h-36 p-6"><p className="text-xs font-bold uppercase tracking-wide text-primary">{t('ledger.kpis.netFlow', { defaultValue: 'Net Flow' })}</p><p className="mt-4 break-words text-2xl font-black text-primary">{formatMovementTotals(filteredMovementEntries.map((entry) => entry.movement), features.iqd_display_preference, (movement) => movement.deltaAmount)}</p><p className="mt-2 text-xs text-muted-foreground">{t('paymentAccounts.currentPageRange', { defaultValue: 'Current selected range' })}</p></CardContent></Card>
              <Card><CardContent className="min-h-36 p-6"><p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{t('paymentAccounts.postedBalance', { defaultValue: 'Posted Balance' })}</p><p className="mt-4 break-words text-2xl font-black">{postedBalance}</p><p className="mt-2 text-xs text-muted-foreground">{t('paymentAccounts.movementCount', { count: filteredMovementEntries.length, defaultValue: '{{count}} matching movements' })}</p></CardContent></Card>
            </div>
          </section>

          <Card>
            <CardContent className="space-y-4 p-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-wrap items-center gap-3">
                  <Button type="button" variant="outline" className="rounded-2xl" onClick={() => setMovementFilterDialogOpen(true)}>
                    <SlidersHorizontal className="mr-2 h-4 w-4" />
                    {t('ledger.filters.title', { defaultValue: 'Filters' })}
                    {activeMovementFilterCount > 0 ? <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">{activeMovementFilterCount}</span> : null}
                  </Button>
                  <DateRangeFilters />
                </div>
                {activeMovementFilterCount > 0 ? <Button type="button" variant="ghost" onClick={() => setMovementFilters(DEFAULT_MOVEMENT_FILTERS)}><RotateCcw className="mr-2 h-4 w-4" />{t('ledger.filters.clearFilters', { defaultValue: 'Clear Filters' })}</Button> : null}
              </div>
              <div className="rounded-2xl border border-border/60 bg-secondary/20 p-4">
                <p className="font-bold">{t('paymentAccounts.matchingMovements', { count: filteredMovementEntries.length, defaultValue: '{{count}} matching movements' })}</p>
                <p className="mt-1 text-sm text-muted-foreground">{t('paymentAccounts.filterPreviewDescription', { defaultValue: 'Account-scoped filters preview the movement trail before you inspect a transaction.' })}</p>
              </div>
              <div className="rounded-2xl border border-dashed border-border/70 px-4 py-3 text-sm text-muted-foreground">
                {activeMovementFilterCount > 0
                  ? t('paymentAccounts.activeFiltersDescription', { count: activeMovementFilterCount, defaultValue: '{{count}} advanced movement filters applied.' })
                  : t('paymentAccounts.noMovementFilters', { defaultValue: 'No advanced filters applied. Open the filter modal to narrow this account by direction, currency, amount, or payment details.' })}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
              <div>
                <CardTitle>{t('paymentAccounts.movements', { defaultValue: 'Account Movements' })}</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">{selectedAccount.name}</p>
              </div>
              <span className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">{filteredMovementEntries.length}</span>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table className="ms-6 w-[calc(100%-1.5rem)] min-w-[1120px]">
                <TableHeader><TableRow>
                  <TableHead>{t('ledger.table.transactionId', { defaultValue: 'Transaction ID' })}</TableHead>
                  <TableHead>{t('ledger.table.date', { defaultValue: 'Date' })}</TableHead>
                  <TableHead>{t('ledger.table.type', { defaultValue: 'Type' })}</TableHead>
                  <TableHead>{t('ledger.table.direction', { defaultValue: 'Direction' })}</TableHead>
                  <TableHead>{t('ledger.table.amount', { defaultValue: 'Amount' })}</TableHead>
                  <TableHead>{t('ledger.table.sourceModule', { defaultValue: 'Source Module' })}</TableHead>
                  <TableHead>{t('ledger.table.referenceId', { defaultValue: 'Reference ID' })}</TableHead>
                  <TableHead>{t('ledger.table.partner', { defaultValue: 'Partner' })}</TableHead>
                  <TableHead>{t('ledger.filters.paymentMethod', { defaultValue: 'Payment Method' })}</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {filteredMovementEntries.length === 0 ? <TableRow><TableCell colSpan={9} className="py-12 text-center text-muted-foreground">{t('paymentAccounts.noFilteredMovements', { defaultValue: 'No account movements match the current filters.' })}</TableCell></TableRow> : filteredMovementEntries.map((entry, rowIndex) => {
                    const relatedCount = entry.relationKey ? movementRelationMaps.counts.get(entry.relationKey) || 0 : 0
                    const relationRange = hoveredRelationKey ? movementRelationMaps.ranges.get(hoveredRelationKey) ?? null : null
                    const isRelationHovered = !!hoveredRelationKey && entry.relationKey === hoveredRelationKey
                    const showHierarchyLine = !!relationRange && relationRange.firstIndex !== relationRange.lastIndex && rowIndex >= relationRange.firstIndex && rowIndex <= relationRange.lastIndex
                    const showHierarchyTurn = isRelationHovered && relatedCount > 1
                    const verticalClass = relationRange && rowIndex === relationRange.firstIndex ? 'top-1/2 bottom-0' : relationRange && rowIndex === relationRange.lastIndex ? 'top-0 bottom-1/2' : 'top-0 bottom-0'
                    const relationClass = entry.relationRole === 'origin' ? 'bg-sky-500/5' : entry.relationRole === 'repayment' ? 'bg-amber-500/10' : 'bg-primary/5'
                    const relationLineClass = entry.relationRole === 'origin' ? 'bg-sky-500' : entry.relationRole === 'repayment' ? 'bg-amber-500' : 'bg-primary'
                    const roleLabel = entry.relationRole === 'origin'
                      ? t('ledger.relationRole.origin', { defaultValue: 'Origin' })
                      : entry.relationRole === 'repayment'
                        ? t('ledger.relationRole.repayment', { defaultValue: 'Repayment' })
                        : t('ledger.relationRole.settlement', { defaultValue: 'Settlement' })
                    const transactionId = entry.transaction?.id || entry.movement.paymentTransactionId
                    return <TableRow
                      key={entry.id}
                      className={cn(isRelationHovered && relationClass, entry.relationKey && 'transition-colors duration-150')}
                      onMouseEnter={() => entry.relationKey && setHoveredRelationKey(entry.relationKey)}
                      onMouseLeave={() => entry.relationKey && setHoveredRelationKey((current) => current === entry.relationKey ? null : current)}
                    >
                      <TableCell className="relative max-w-[150px] font-mono text-xs text-muted-foreground">
                        {showHierarchyLine ? <div className="pointer-events-none absolute inset-y-0 -start-6 w-5"><span className={cn('absolute start-1.5 w-px', relationLineClass, verticalClass)} />{showHierarchyTurn ? <span className={cn('absolute start-1.5 top-1/2 h-px w-3 -translate-y-1/2', relationLineClass)} /> : null}</div> : null}
                        <span className="block truncate" title={transactionId}>{transactionId}</span>
                      </TableCell>
                      <TableCell>{formatDateTime(entry.movement.occurredAt)}</TableCell>
                      <TableCell className="font-medium"><div className="inline-flex max-w-[220px] items-center gap-2"><span className="truncate">{movementTypeLabel(entry.transaction, t)}</span>{entry.relationRole ? <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide', entry.relationRole === 'origin' ? 'border-sky-200 bg-sky-50 text-sky-700' : entry.relationRole === 'repayment' ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-primary/20 bg-primary/10 text-primary')}>{roleLabel}</span> : null}</div></TableCell>
                      <TableCell><span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide', entry.movement.direction === 'incoming' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700')}>{entry.movement.direction === 'incoming' ? <ArrowDownLeft className="h-3 w-3" /> : <ArrowUpRight className="h-3 w-3" />}{entry.movement.direction === 'incoming' ? t('ledger.direction.in', { defaultValue: 'IN' }) : t('ledger.direction.out', { defaultValue: 'OUT' })}</span></TableCell>
                      <TableCell className="font-semibold">{formatCurrency(Math.abs(entry.movement.amount), entry.movement.currency, features.iqd_display_preference)}</TableCell>
                      <TableCell>{sourceModuleLabel(entry.transaction, t)}</TableCell>
                      <TableCell className="max-w-[160px] font-medium"><span className="block truncate" title={entry.transaction?.referenceLabel || undefined}>{entry.transaction?.referenceLabel || '—'}</span></TableCell>
                      <TableCell className="max-w-[160px]"><span className="block truncate" title={entry.transaction?.counterpartyName || undefined}>{entry.transaction?.counterpartyName || '—'}</span></TableCell>
                      <TableCell>{paymentMethodLabel(entry.transaction?.paymentMethod, t)}</TableCell>
                    </TableRow>
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

      <AppDialog open={movementFilterDialogOpen} onOpenChange={setMovementFilterDialogOpen}>
        <AppDialogContent className="max-w-4xl" showCloseButton>
          <AppDialogHeader>
            <AppDialogTitle className="flex items-center gap-3"><span className="rounded-xl bg-primary/10 p-2 text-primary"><SlidersHorizontal className="h-5 w-5" /></span>{t('paymentAccounts.movementFilterDialogTitle', { defaultValue: 'Account Movement Filters' })}</AppDialogTitle>
          </AppDialogHeader>
          <AppDialogBody>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-emerald-500/15 bg-emerald-500/5 p-4"><p className="text-xs font-bold uppercase tracking-wide text-emerald-700">{t('ledger.filters.preview', { defaultValue: 'Preview' })}</p><p className="mt-2 text-2xl font-black text-emerald-700">{draftPreviewMovementEntries.length}</p><p className="mt-1 text-xs text-muted-foreground">{t('paymentAccounts.previewMovementDescription', { defaultValue: 'movements match this draft' })}</p></div>
              <div className="rounded-2xl border border-border/60 bg-secondary/20 p-4"><p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{t('paymentAccounts.selectedAccount', { defaultValue: 'Selected account' })}</p><p className="mt-2 truncate font-bold">{selectedAccount?.name || '—'}</p><p className="mt-1 text-xs text-muted-foreground">{t('paymentAccounts.accountScopedFilters', { defaultValue: 'Filters apply only to this account' })}</p></div>
              <div className="rounded-2xl border border-border/60 bg-secondary/20 p-4"><p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{t('ledger.filters.draftFilters', { defaultValue: 'Draft Filters' })}</p><p className="mt-2 text-2xl font-black">{countActiveMovementFilters(draftMovementFilters)}</p><p className="mt-1 text-xs text-muted-foreground">{t('ledger.filters.draftFiltersDescription', { defaultValue: 'advanced conditions configured' })}</p></div>
            </div>
            <div className="mt-6 grid gap-5 md:grid-cols-2">
              <div className="space-y-4 rounded-2xl border border-border/60 p-5">
                <div><h3 className="font-bold">{t('paymentAccounts.searchAndMovement', { defaultValue: 'Search & Movement' })}</h3><p className="mt-1 text-sm text-muted-foreground">{t('paymentAccounts.searchAndMovementDescription', { defaultValue: 'Search the selected account by transaction, reference, partner, note, or source.' })}</p></div>
                <div className="grid gap-2"><Label htmlFor="account-movement-search">{t('ledger.filters.keywordSearch', { defaultValue: 'Keyword Search' })}</Label><div className="relative"><Search className="pointer-events-none absolute start-3 top-3 h-4 w-4 text-muted-foreground" /><Input id="account-movement-search" value={draftMovementFilters.search} onChange={(event) => setDraftMovementFilters((current) => ({ ...current, search: event.target.value }))} placeholder={t('paymentAccounts.searchMovementsPlaceholder', { defaultValue: 'Search transaction, partner, or note' })} className="ps-9" /></div></div>
                <div className="grid gap-4 sm:grid-cols-2"><div className="grid gap-2"><Label>{t('ledger.filters.direction', { defaultValue: 'Direction' })}</Label><Select value={draftMovementFilters.direction} onValueChange={(direction) => setDraftMovementFilters((current) => ({ ...current, direction: direction as AccountMovementFilters['direction'] }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">{t('ledger.direction.allDirections', { defaultValue: 'All Directions' })}</SelectItem><SelectItem value="incoming">{t('paymentAccounts.incoming', { defaultValue: 'Incoming' })}</SelectItem><SelectItem value="outgoing">{t('paymentAccounts.outgoing', { defaultValue: 'Outgoing' })}</SelectItem></SelectContent></Select></div><div className="grid gap-2"><Label>{t('ledger.filters.sortBy', { defaultValue: 'Sort By' })}</Label><Select value={draftMovementFilters.sort} onValueChange={(sort) => setDraftMovementFilters((current) => ({ ...current, sort: sort as AccountMovementSort }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{(['date_desc', 'date_asc', 'amount_desc', 'amount_asc'] as AccountMovementSort[]).map((sort) => <SelectItem key={sort} value={sort}>{movementSortLabel(sort, t)}</SelectItem>)}</SelectContent></Select></div></div>
              </div>
              <div className="space-y-4 rounded-2xl border border-border/60 p-5">
                <div><h3 className="font-bold">{t('paymentAccounts.currencyAndAmount', { defaultValue: 'Currency & Amount' })}</h3><p className="mt-1 text-sm text-muted-foreground">{t('paymentAccounts.currencyAndAmountDescription', { defaultValue: 'Use the page date range above, then refine this account by currency and amount.' })}</p></div>
                <div className="grid gap-2"><Label>{t('ledger.filters.currency', { defaultValue: 'Currency' })}</Label><Select value={draftMovementFilters.currency} onValueChange={(currency) => setDraftMovementFilters((current) => ({ ...current, currency: currency as AccountMovementFilters['currency'] }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">{t('ledger.filters.allCurrencies', { defaultValue: 'All Currencies' })}</SelectItem>{CURRENCIES.map((currency) => <SelectItem key={currency} value={currency}>{currency.toUpperCase()}</SelectItem>)}</SelectContent></Select></div>
                <div className="grid gap-4 sm:grid-cols-2"><div className="grid gap-2"><Label htmlFor="account-movement-minimum">{t('ledger.filters.minimumAmount', { defaultValue: 'Minimum Amount' })}</Label><Input id="account-movement-minimum" inputMode="decimal" placeholder="0" value={formatNumericInput(draftMovementFilters.minAmount)} onChange={(event) => setDraftMovementFilters((current) => ({ ...current, minAmount: sanitizeNumericInput(event.target.value, { allowDecimal: true }) }))} /></div><div className="grid gap-2"><Label htmlFor="account-movement-maximum">{t('ledger.filters.maximumAmount', { defaultValue: 'Maximum Amount' })}</Label><Input id="account-movement-maximum" inputMode="decimal" placeholder="0" value={formatNumericInput(draftMovementFilters.maxAmount)} onChange={(event) => setDraftMovementFilters((current) => ({ ...current, maxAmount: sanitizeNumericInput(event.target.value, { allowDecimal: true }) }))} /></div></div>
              </div>
            </div>
          </AppDialogBody>
          <AppDialogFooter><Button type="button" variant="ghost" onClick={() => setDraftMovementFilters(DEFAULT_MOVEMENT_FILTERS)}><RotateCcw className="mr-2 h-4 w-4" />{t('ledger.filters.resetDraft', { defaultValue: 'Reset Draft' })}</Button><div className="flex gap-2"><Button type="button" variant="outline" onClick={() => setMovementFilterDialogOpen(false)}>{t('common.cancel', { defaultValue: 'Cancel' })}</Button><Button type="button" onClick={() => { setMovementFilters(draftMovementFilters); setMovementFilterDialogOpen(false) }}>{t('paymentAccounts.applyMovementFilters', { count: draftPreviewMovementEntries.length, defaultValue: 'Apply Filters ({{count}})' })}</Button></div></AppDialogFooter>
        </AppDialogContent>
      </AppDialog>

      <AppDialog open={accountDialogOpen} onOpenChange={(next) => !saving && setAccountDialogOpen(next)}>
        <AppDialogContent className="max-w-3xl" showCloseButton={!saving} onPointerDownOutside={(event) => saving && event.preventDefault()} onEscapeKeyDown={(event) => saving && event.preventDefault()}>
          <AppDialogHeader>
            <AppDialogTitle>{editingAccount ? t('paymentAccounts.editAccount', { defaultValue: 'Edit Payment Account' }) : t('paymentAccounts.newAccount', { defaultValue: 'New Payment Account' })}</AppDialogTitle>
          </AppDialogHeader>
          <AppDialogBody>
            <div className="grid gap-5">
              <div className="flex items-center gap-4 rounded-2xl border border-border/60 bg-secondary/20 p-4">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  disabled={saving}
                  onClick={() => setIconPickerOpen(true)}
                  className="h-14 w-14 shrink-0 rounded-2xl border-primary/20 bg-primary/10 text-primary hover:bg-primary/15"
                  aria-label={t('paymentAccounts.chooseIcon', { defaultValue: 'Choose account icon' })}
                >
                  <PaymentAccountIcon iconKey={accountIconKey} accountType={accountType} className="h-6 w-6" />
                </Button>
                <div className="min-w-0">
                  <p className="font-semibold">{t('paymentAccounts.accountIcon', { defaultValue: 'Account icon' })}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{t('paymentAccounts.accountIconDescription', { defaultValue: 'Choose a visual marker that appears wherever this account is selected.' })}</p>
                </div>
              </div>

              <div className="grid gap-2">
                <Label>{t('common.name', { defaultValue: 'Name' })} *</Label>
                <Input value={accountName} disabled={saving} onChange={(event) => setAccountName(event.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label>{t('paymentAccounts.accountType', { defaultValue: 'Account type' })}</Label>
                <Select value={accountType} onValueChange={(value) => {
                  const nextType = value as PaymentAccountType
                  setAccountType(nextType)
                  if (nextType !== 'digital_wallet') setLinkedPaymentMethod(null)
                }} disabled={saving}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{ACCOUNT_TYPES.map((type) => <SelectItem key={type} value={type}>{accountTypeLabel(type, t)}</SelectItem>)}</SelectContent>
                </Select>
              </div>

              {accountType === 'digital_wallet' ? (
                <div className="grid gap-2 rounded-2xl border border-primary/20 bg-primary/[0.03] p-4">
                  <Label>{t('paymentAccounts.linkedPaymentMethod', { defaultValue: 'Linked payment method' })}</Label>
                  <PaymentMethodSelector
                    value={linkedPaymentMethod}
                    onValueChange={(method) => setLinkedPaymentMethod(method as DigitalWalletPaymentMethod | null)}
                    methods={DIGITAL_WALLET_PAYMENT_METHODS}
                    workspaceId={workspaceId}
                    allowNone
                    noneLabel={t('paymentAccounts.noLinkedPaymentMethod', { defaultValue: 'None' })}
                    disabled={saving}
                  />
                  <p className="text-sm text-muted-foreground">{t('paymentAccounts.linkedPaymentMethodHint', { defaultValue: 'When this payment method is selected, this account is proposed automatically. The user can still choose another account.' })}</p>
                </div>
              ) : null}

              {!editingAccount ? (
                <section className="space-y-4 rounded-2xl border border-border/60 bg-secondary/10 p-4" aria-label={t('paymentAccounts.openingBalances', { defaultValue: 'Opening balances (optional)' })}>
                  <div>
                    <h3 className="font-semibold">{t('paymentAccounts.openingBalances', { defaultValue: 'Opening balances (optional)' })}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{t('paymentAccounts.openingBalancesDescription', { defaultValue: 'Add the amount currently held in this account for each currency. Each completed row creates an opening-balance movement.' })}</p>
                  </div>

                  {openingBalanceRows.map((row, index) => {
                    const selectedCurrencies = new Set(openingBalanceRows.filter((_, rowIndex) => rowIndex !== index).map((item) => item.currency))
                    const selectableCurrencies = openingBalanceCurrencies.filter((currency) => currency === row.currency || !selectedCurrencies.has(currency))
                    return (
                      <div key={row.currency} className="grid gap-3 rounded-xl border border-border/60 bg-background/60 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
                        <CurrencySelector
                          value={row.currency}
                          onChange={(currency) => updateOpeningBalanceRow(index, { currency })}
                          label={t('common.currency', { defaultValue: 'Currency' })}
                          iqdDisplayPreference={features.iqd_display_preference}
                          allowedCurrencies={selectableCurrencies}
                          disabled={saving}
                        />
                        <div className="grid gap-2">
                          <Label htmlFor={`payment-account-opening-amount-${row.currency}`}>{t('paymentAccounts.openingAmount', { defaultValue: 'Opening amount' })}</Label>
                          <Input
                            id={`payment-account-opening-amount-${row.currency}`}
                            inputMode="decimal"
                            placeholder="0"
                            disabled={saving}
                            value={formatNumericInput(row.amount)}
                            onChange={(event) => updateOpeningBalanceRow(index, { amount: sanitizeNumericInput(event.target.value, { allowDecimal: true }) })}
                          />
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          disabled={saving}
                          onClick={() => removeOpeningBalanceRow(index)}
                          aria-label={t('common.remove', { defaultValue: 'Remove' })}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    )
                  })}

                  {canAddOpeningBalanceCurrency ? (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={saving}
                      onClick={addOpeningBalanceCurrency}
                      className="h-12 w-full border-dashed border-primary/40 bg-primary/[0.03] text-primary hover:border-primary hover:bg-primary/10"
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      {t('paymentAccounts.addCurrency', { defaultValue: 'Add Currency' })}
                    </Button>
                  ) : null}
                </section>
              ) : null}

              <div className="space-y-4 rounded-2xl border border-border/60 p-4">
                <div className="flex items-start gap-3">
                  <Checkbox
                    id="payment-account-primary"
                    checked={isFirstAccount || isEditingPrimary || makePrimary}
                    disabled={saving || isFirstAccount || isEditingPrimary}
                    onCheckedChange={(checked) => setMakePrimary(checked === true)}
                  />
                  <div className="grid gap-1.5">
                    <Label htmlFor="payment-account-primary" className="cursor-pointer font-semibold">{t('paymentAccounts.makePrimary', { defaultValue: 'Make this the primary account' })}</Label>
                    <p className="text-sm text-muted-foreground">
                      {isFirstAccount
                        ? <span className="inline-flex items-center gap-1.5"><LockKeyhole className="h-3.5 w-3.5" />{t('paymentAccounts.firstAccountPrimary', { defaultValue: 'Your first payment account is always primary.' })}</span>
                        : isEditingPrimary
                          ? t('paymentAccounts.switchPrimaryHint', { defaultValue: 'To change the primary account, edit another account and choose this option there.' })
                          : t('paymentAccounts.makePrimaryHint', { defaultValue: 'Use this as the main account in account lists.' })}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3 border-t border-border/60 pt-4">
                  <Checkbox
                    id="payment-account-default-selection"
                    checked={preselectInPaymentForms}
                    disabled={saving}
                    onCheckedChange={(checked) => setPreselectInPaymentForms(checked === true)}
                  />
                  <div className="grid gap-1.5">
                    <Label htmlFor="payment-account-default-selection" className="cursor-pointer font-semibold">{t('paymentAccounts.preselectInPaymentForms', { defaultValue: 'Preselect in payment forms' })}</Label>
                    <p className="text-sm text-muted-foreground">{t('paymentAccounts.preselectInPaymentFormsHint', { defaultValue: 'New payment forms start with this account. Users can still choose No account.' })}</p>
                  </div>
                </div>
              </div>

              <div className="grid gap-2">
                <Label>{t('common.notes', { defaultValue: 'Notes' })}</Label>
                <Textarea value={accountNotes} disabled={saving} onChange={(event) => setAccountNotes(event.target.value)} />
              </div>
            </div>
          </AppDialogBody>
          <AppDialogFooter>
            {editingAccount ? <Button type="button" variant="destructive" onClick={() => setAccountPendingDeletion(editingAccount)} disabled={saving}><Trash2 className="mr-2 h-4 w-4" />{t('common.delete', { defaultValue: 'Delete' })}</Button> : <span />}
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setAccountDialogOpen(false)} disabled={saving}>{t('common.cancel', { defaultValue: 'Cancel' })}</Button>
              <Button type="button" onClick={saveAccount} disabled={saving || !accountName.trim()}>{t('common.save', { defaultValue: 'Save' })}</Button>
            </div>
          </AppDialogFooter>
        </AppDialogContent>
      </AppDialog>

      <AppDialog open={iconPickerOpen} onOpenChange={(next) => !saving && setIconPickerOpen(next)}>
        <AppDialogContent className="max-w-2xl" showCloseButton={!saving} onPointerDownOutside={(event) => saving && event.preventDefault()} onEscapeKeyDown={(event) => saving && event.preventDefault()}>
          <AppDialogHeader>
            <AppDialogTitle>{t('paymentAccounts.chooseIcon', { defaultValue: 'Choose account icon' })}</AppDialogTitle>
          </AppDialogHeader>
          <AppDialogBody>
            <p className="text-sm text-muted-foreground">{t('paymentAccounts.chooseIconDescription', { defaultValue: 'This is only a visual marker; it does not change how payments are recorded.' })}</p>
            <div className="mt-5 grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
              {PAYMENT_ACCOUNT_ICON_OPTIONS.map((option) => {
                const selected = accountIconKey === option.key
                return (
                  <Button
                    key={option.key}
                    type="button"
                    variant="outline"
                    disabled={saving}
                    aria-pressed={selected}
                    onClick={() => { setAccountIconKey(option.key); setIconPickerOpen(false) }}
                    className={cn('h-24 flex-col gap-2 rounded-2xl border-border/60', selected && 'border-primary bg-primary/10 text-primary ring-1 ring-primary')}
                  >
                    <PaymentAccountIcon iconKey={option.key} className="h-6 w-6" />
                    <span className="max-w-full truncate text-xs">{t(option.labelKey)}</span>
                  </Button>
                )
              })}
            </div>
          </AppDialogBody>
          <AppDialogFooter>
            <Button type="button" variant="outline" onClick={() => setIconPickerOpen(false)} disabled={saving}>{t('common.cancel', { defaultValue: 'Cancel' })}</Button>
          </AppDialogFooter>
        </AppDialogContent>
      </AppDialog>

      <DeleteConfirmationModal
        isOpen={!!accountPendingDeletion}
        onClose={() => { if (!saving) setAccountPendingDeletion(null) }}
        onConfirm={removeAccount}
        isLoading={saving}
        itemName={accountPendingDeletion?.name || ''}
        title={t('paymentAccounts.removeAccount', { defaultValue: 'Remove payment account' })}
        description={t('paymentAccounts.removeAccountDescription', { defaultValue: 'Historic payment movements stay in the ledger. If this is the primary account, the next available account becomes primary.' })}
      />

    </div>
  )
}
