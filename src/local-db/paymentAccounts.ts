import { useEffect, useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'

import { useNetworkStatus } from '@/hooks/useNetworkStatus'
import { generateId, toSnakeCase } from '@/lib/utils'
import { getSupabaseClientForTable, getSupabaseRemoteTableName } from '@/lib/supabaseSchema'
import { isOnline } from '@/lib/network'
import { isLocalWorkspaceMode } from '@/workspace/workspaceMode'

import { db } from './database'
import { addToOfflineMutations, fetchTableFromSupabase } from './hooks'
import { DIGITAL_WALLET_PAYMENT_METHODS } from './models'
import type {
  CashierShift,
  CashierShiftCurrencyCount,
  CashierShiftAssignment,
  CashierShiftOccurrence,
  CashierShiftTemplate,
  CurrencyCode,
  DigitalWalletPaymentMethod,
  PaymentAccount,
  PaymentAccountIconKey,
  PaymentAccountBalance,
  PaymentAccountMovement,
  PaymentAccountType,
  PaymentTransaction,
} from './models'

const PAYMENT_ACCOUNT_TABLES = [
  'payment_accounts',
  'payment_account_balances',
  'payment_account_movements',
  'cashier_shifts',
  'cashier_shift_currency_counts',
  'cashier_shift_templates',
  'cashier_shift_assignments',
  'cashier_shift_occurrences',
] as const

type PaymentAccountTable = (typeof PAYMENT_ACCOUNT_TABLES)[number]

function syncMeta(workspaceId: string, now: string) {
  return isLocalWorkspaceMode(workspaceId)
    ? { syncStatus: 'synced' as const, lastSyncedAt: now }
    : { syncStatus: 'pending' as const, lastSyncedAt: null }
}

function cloudWorkspace(workspaceId: string) {
  return !isLocalWorkspaceMode(workspaceId)
}

function payload(row: Record<string, unknown>) {
  return toSnakeCase({ ...row, syncStatus: undefined, lastSyncedAt: undefined })
}

async function persist<T extends { id: string; workspaceId: string }>(
  tableName: PaymentAccountTable,
  row: T,
  operation: 'create' | 'update' = 'create',
) {
  const table = db.table(tableName)
  await table.put(row)

  if (!cloudWorkspace(row.workspaceId)) return row

  if (!isOnline()) {
    await addToOfflineMutations(tableName, row.id, operation, row as Record<string, unknown>, row.workspaceId)
    return row
  }

  try {
    const client = getSupabaseClientForTable(tableName)
    const { error } = await client.from(getSupabaseRemoteTableName(tableName)).upsert(payload(row as Record<string, unknown>))
    if (error) throw error
    const synced = { ...row, syncStatus: 'synced' as const, lastSyncedAt: new Date().toISOString() }
    await table.put(synced)
    return synced
  } catch (error) {
    // Account configuration and shift records follow Atlas's normal offline
    // queue contract. The payment itself remains the financial source of truth.
    await addToOfflineMutations(tableName, row.id, operation, row as Record<string, unknown>, row.workspaceId)
    return row
  }
}

function usePaymentAccountTable<T extends { id: string; workspaceId: string }>(
  tableName: PaymentAccountTable,
  workspaceId?: string,
) {
  const online = useNetworkStatus()
  const rows = useLiveQuery(
    () => workspaceId ? db.table(tableName).where('workspaceId').equals(workspaceId).toArray() as Promise<T[]> : Promise.resolve([] as T[]),
    [tableName, workspaceId],
    [],
  )

  useEffect(() => {
    if (!workspaceId || !online || !cloudWorkspace(workspaceId)) return
    void fetchTableFromSupabase(tableName, db.table(tableName), workspaceId)
  }, [online, tableName, workspaceId])

  return rows ?? []
}

export function usePaymentAccounts(workspaceId?: string) {
  const rows = usePaymentAccountTable<PaymentAccount>('payment_accounts', workspaceId)
  return useMemo(
    () => {
      const accounts = rows.filter((row) => !row.isDeleted)
      const activeAccounts = accounts
        .filter((row) => row.isActive)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.name.localeCompare(b.name))
      const needsLegacyPrimary = activeAccounts.length > 0 && !activeAccounts.some((row) => row.isPrimary)
      const derivedPrimaryId = needsLegacyPrimary ? activeAccounts[0].id : null

      return accounts
        .map((account) => account.id === derivedPrimaryId ? { ...account, isPrimary: true } : account)
        .sort((a, b) => Number(!!b.isPrimary) - Number(!!a.isPrimary) || a.name.localeCompare(b.name))
    },
    [rows],
  )
}

export function usePaymentAccountBalances(workspaceId?: string) {
  const rows = usePaymentAccountTable<PaymentAccountBalance>('payment_account_balances', workspaceId)
  return useMemo(() => rows.filter((row) => !row.isDeleted), [rows])
}

export function usePaymentAccountMovements(workspaceId?: string) {
  const rows = usePaymentAccountTable<PaymentAccountMovement>('payment_account_movements', workspaceId)
  return useMemo(
    () => rows.filter((row) => !row.isDeleted).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)),
    [rows],
  )
}

export function useCashierShifts(workspaceId?: string) {
  const rows = usePaymentAccountTable<CashierShift>('cashier_shifts', workspaceId)
  return useMemo(() => rows.filter((row) => !row.isDeleted).sort((a, b) => b.openedAt.localeCompare(a.openedAt)), [rows])
}

export function useCashierShiftCurrencyCounts(workspaceId?: string) {
  const rows = usePaymentAccountTable<CashierShiftCurrencyCount>('cashier_shift_currency_counts', workspaceId)
  return useMemo(() => rows.filter((row) => !row.isDeleted), [rows])
}

export function useCashierShiftTemplates(workspaceId?: string) {
  const rows = usePaymentAccountTable<CashierShiftTemplate>('cashier_shift_templates', workspaceId)
  return useMemo(
    () => rows.filter((row) => !row.isDeleted).sort((left, right) => left.name.localeCompare(right.name)),
    [rows],
  )
}

export function useCashierShiftAssignments(workspaceId?: string) {
  const rows = usePaymentAccountTable<CashierShiftAssignment>('cashier_shift_assignments', workspaceId)
  return useMemo(
    () => rows.filter((row) => !row.isDeleted).sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    [rows],
  )
}

export function useCashierShiftOccurrences(workspaceId?: string) {
  const rows = usePaymentAccountTable<CashierShiftOccurrence>('cashier_shift_occurrences', workspaceId)
  return useMemo(
    () => rows.filter((row) => !row.isDeleted).sort((left, right) => right.scheduledStartAt.localeCompare(left.scheduledStartAt)),
    [rows],
  )
}

export interface SavePaymentAccountInput {
  id?: string
  name: string
  accountType: PaymentAccountType
  iconKey?: PaymentAccountIconKey | null
  /** Optional branded method this Digital Wallet should be proposed for. */
  linkedPaymentMethod?: DigitalWalletPaymentMethod | null
  notes?: string | null
  isActive?: boolean
  /** Switching this also clears the primary flag on the workspace's other accounts. */
  isPrimary?: boolean
  /** Only one active account can be preselected in a new payment form. */
  isDefaultForPaymentSelector?: boolean
  createdBy?: string | null
  /** Optional opening amounts, posted as incoming account movements on creation. */
  openingBalances?: Array<{ currency: CurrencyCode; amount: number }>
}

export async function savePaymentAccount(workspaceId: string, input: SavePaymentAccountInput) {
  const now = new Date().toISOString()
  const existing = input.id ? await db.payment_accounts.get(input.id) : undefined
  if (existing && existing.workspaceId !== workspaceId) throw new Error('Payment account does not belong to this workspace.')

  const requestedOpeningBalances = existing ? [] : input.openingBalances ?? []
  if (requestedOpeningBalances.length > 4) {
    throw new Error('A payment account can have opening balances in up to four currencies.')
  }

  const seenOpeningCurrencies = new Set<CurrencyCode>()
  const openingBalances = requestedOpeningBalances.filter(({ currency, amount }) => {
    if (seenOpeningCurrencies.has(currency)) {
      throw new Error('An opening balance can be recorded only once per currency.')
    }
    seenOpeningCurrencies.add(currency)
    return Number.isFinite(amount) && amount > 0
  })

  const activeAccounts = (await db.payment_accounts.where('workspaceId').equals(workspaceId).toArray())
    .filter((item) => !item.isDeleted && item.isActive && item.id !== existing?.id)
  const isActive = input.isActive ?? existing?.isActive ?? true
  const linkedPaymentMethod = isActive && input.accountType === 'digital_wallet'
    ? input.linkedPaymentMethod === undefined
      ? existing?.linkedPaymentMethod ?? null
      : input.linkedPaymentMethod
    : null
  if (linkedPaymentMethod && !DIGITAL_WALLET_PAYMENT_METHODS.includes(linkedPaymentMethod)) {
    throw new Error('Only supported digital payment methods can be linked to a Digital Wallet account.')
  }
  const hasOtherPrimary = activeAccounts.some((item) => item.isPrimary)
  const shouldBePrimary = isActive && (
    input.isPrimary === true
    || existing?.isPrimary === true
    || !hasOtherPrimary
  )
  const shouldBeDefaultForPaymentSelector = isActive && (
    input.isDefaultForPaymentSelector ?? existing?.isDefaultForPaymentSelector ?? false
  )
  const account: PaymentAccount = {
    id: input.id ?? generateId(),
    workspaceId,
    name: input.name.trim(),
    accountType: input.accountType,
    linkedPaymentMethod,
    iconKey: input.iconKey ?? existing?.iconKey ?? null,
    notes: input.notes?.trim() || null,
    isActive,
    isPrimary: shouldBePrimary,
    isDefaultForPaymentSelector: shouldBeDefaultForPaymentSelector,
    createdBy: existing?.createdBy ?? input.createdBy ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    version: (existing?.version ?? 0) + 1,
    isDeleted: false,
    ...syncMeta(workspaceId, now),
  }

  const relatedUpdates = activeAccounts.reduce<PaymentAccount[]>((updates, other) => {
    const shouldClearPrimary = account.isPrimary && other.isPrimary
    const shouldClearDefault = account.isDefaultForPaymentSelector && other.isDefaultForPaymentSelector
    const shouldClearLinkedPaymentMethod = !!account.linkedPaymentMethod
      && other.accountType === 'digital_wallet'
      && other.linkedPaymentMethod === account.linkedPaymentMethod
    if (!shouldClearPrimary && !shouldClearDefault && !shouldClearLinkedPaymentMethod) return updates

    updates.push({
      ...other,
      isPrimary: shouldClearPrimary ? false : other.isPrimary,
      isDefaultForPaymentSelector: shouldClearDefault ? false : other.isDefaultForPaymentSelector,
      linkedPaymentMethod: shouldClearLinkedPaymentMethod ? null : other.linkedPaymentMethod,
      updatedAt: now,
      version: other.version + 1,
      ...syncMeta(workspaceId, now),
    })
    return updates
  }, [])

  // Update the local view as one operation, then let normal persistence queue or
  // synchronize each changed record. This keeps a primary/default switch instant offline.
  await db.transaction('rw', db.payment_accounts, async () => {
    await db.payment_accounts.bulkPut([...relatedUpdates, account])
  })
  for (const related of relatedUpdates) await persist('payment_accounts', related, 'update')
  const savedAccount = await persist('payment_accounts', account, existing ? 'update' : 'create')

  if (openingBalances.length) {
    const { appendPaymentTransaction } = await import('./payments')
    for (const openingBalance of openingBalances) {
      await appendPaymentTransaction(workspaceId, {
        sourceModule: 'payments',
        sourceType: 'payment_account_opening_balance',
        sourceRecordId: savedAccount.id,
        direction: 'incoming',
        amount: openingBalance.amount,
        currency: openingBalance.currency,
        paymentMethod: 'unknown',
        paidAt: now,
        createdBy: input.createdBy ?? null,
        accountId: savedAccount.id,
        accountNameSnapshot: savedAccount.name,
        metadata: { paymentAccountOpeningBalance: true },
      })
    }
  }

  return savedAccount
}

/** Soft-delete an account while preserving its historic movements and payment snapshots. */
export async function deletePaymentAccount(workspaceId: string, accountId: string) {
  const account = await db.payment_accounts.get(accountId)
  if (!account || account.workspaceId !== workspaceId || account.isDeleted) {
    throw new Error('Payment account was not found.')
  }

  const now = new Date().toISOString()
  const activeRemaining = (await db.payment_accounts.where('workspaceId').equals(workspaceId).toArray())
    .filter((item) => !item.isDeleted && item.isActive && item.id !== accountId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.name.localeCompare(b.name))
  const existingPrimary = activeRemaining.find((item) => item.isPrimary)
  const accountActsAsPrimary = account.isPrimary || (
    !existingPrimary
    && [account, ...activeRemaining]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.name.localeCompare(b.name))[0]?.id === account.id
  )
  const fallbackPrimary = accountActsAsPrimary && !existingPrimary ? activeRemaining[0] : undefined
  const deleted: PaymentAccount = {
    ...account,
    isActive: false,
    isPrimary: false,
    isDefaultForPaymentSelector: false,
    isDeleted: true,
    updatedAt: now,
    version: account.version + 1,
    ...syncMeta(workspaceId, now),
  }
  const promoted = fallbackPrimary
    ? {
        ...fallbackPrimary,
        isPrimary: true,
        updatedAt: now,
        version: fallbackPrimary.version + 1,
        ...syncMeta(workspaceId, now),
      }
    : undefined

  await db.transaction('rw', db.payment_accounts, async () => {
    await db.payment_accounts.put(deleted)
    if (promoted) await db.payment_accounts.put(promoted)
  })
  await persist('payment_accounts', deleted, 'update')
  if (promoted) await persist('payment_accounts', promoted, 'update')
  return { deleted, fallbackPrimary: promoted ?? null }
}

export function getPaymentAccountBalanceSummary(
  balances: PaymentAccountBalance[],
  accountId: string,
) {
  return balances
    .filter((balance) => balance.accountId === accountId && !balance.isDeleted)
    .sort((a, b) => a.currency.localeCompare(b.currency))
}

export interface CreateCashierShiftInput {
  account: PaymentAccount
  cashierUserId: string
  cashierName: string
}

/**
 * V1 cashier shifts are drawer-to-member assignments. Cash counts and
 * reconciliation are intentionally outside this workflow.
 */
export async function createCashierShift(workspaceId: string, input: CreateCashierShiftInput) {
  if (input.account.workspaceId !== workspaceId || input.account.accountType !== 'cash_drawer' || !input.account.isActive || input.account.isDeleted) {
    throw new Error('Select an active cash drawer from this workspace.')
  }
  if (!input.cashierUserId || !input.cashierName.trim()) {
    throw new Error('Select a workspace member for this cashier shift.')
  }

  const [cashierUser, cashierProfile] = await Promise.all([
    db.users.get(input.cashierUserId),
    db.profiles.get(input.cashierUserId),
  ])
  const isWorkspaceMember = (!cashierUser?.isDeleted && cashierUser?.workspaceId === workspaceId)
    || cashierProfile?.workspaceId === workspaceId
  if (!isWorkspaceMember) {
    throw new Error('Select a workspace member for this cashier shift.')
  }

  const existingAssignment = await db.cashier_shifts
    .where('[accountId+cashierUserId]')
    .equals([input.account.id, input.cashierUserId])
    .filter((shift) => shift.workspaceId === workspaceId && !shift.isDeleted && shift.status === 'open')
    .first()
  if (existingAssignment) {
    throw new Error('This workspace member already has an active shift for the selected cash drawer.')
  }

  const now = new Date().toISOString()
  const shift: CashierShift = {
    id: generateId(),
    workspaceId,
    accountId: input.account.id,
    accountNameSnapshot: input.account.name,
    cashierUserId: input.cashierUserId,
    cashierNameSnapshot: input.cashierName.trim(),
    status: 'open',
    openedAt: now,
    closedAt: null,
    closedBy: null,
    openingNote: null,
    closingNote: null,
    createdAt: now,
    updatedAt: now,
    version: 1,
    isDeleted: false,
    ...syncMeta(workspaceId, now),
  }

  return persist('cashier_shifts', shift)
}

function timeToMinutes(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return (hours * 60) + minutes
}

function dateAtLocalTime(date: Date, time: string) {
  const [hours, minutes] = time.split(':').map(Number)
  const next = new Date(date)
  next.setHours(hours, minutes, 0, 0)
  return next
}

export function getCashierShiftOccurrenceBounds(assignment: Pick<CashierShiftAssignment, 'startTime' | 'endTime'>, date: Date) {
  const start = dateAtLocalTime(date, assignment.startTime)
  const end = dateAtLocalTime(date, assignment.endTime)
  const startMinutes = timeToMinutes(assignment.startTime)
  const endMinutes = timeToMinutes(assignment.endTime)
  if (startMinutes === null || endMinutes === null || startMinutes === endMinutes) return null
  if (endMinutes <= startMinutes) end.setDate(end.getDate() + 1)
  return { start, end, overnight: endMinutes <= startMinutes }
}

export function isCashierShiftWorkingDay(assignment: Pick<CashierShiftAssignment, 'workingDays'>, date: Date) {
  return assignment.workingDays.includes(date.getDay())
}

export interface CreateCashierShiftTemplateInput {
  name: string
  startTime: string
  endTime: string
}

export async function createCashierShiftTemplate(workspaceId: string, input: CreateCashierShiftTemplateInput) {
  const name = input.name.trim()
  const startMinutes = timeToMinutes(input.startTime)
  const endMinutes = timeToMinutes(input.endTime)
  if (!name) throw new Error('Enter a shift name.')
  if (startMinutes === null || endMinutes === null || startMinutes === endMinutes) {
    throw new Error('Enter different valid start and end times.')
  }

  const now = new Date().toISOString()
  const template: CashierShiftTemplate = {
    id: generateId(),
    workspaceId,
    name,
    startTime: input.startTime,
    endTime: input.endTime,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    version: 1,
    isDeleted: false,
    ...syncMeta(workspaceId, now),
  }
  return persist('cashier_shift_templates', template)
}

export interface CreateCashierShiftAssignmentInput {
  account: PaymentAccount
  cashierUserId: string
  cashierName: string
  template?: CashierShiftTemplate | null
  startTime: string
  endTime: string
  workingDays: number[]
}

export async function createCashierShiftAssignment(workspaceId: string, input: CreateCashierShiftAssignmentInput) {
  const startMinutes = timeToMinutes(input.startTime)
  const endMinutes = timeToMinutes(input.endTime)
  if (input.account.workspaceId !== workspaceId || input.account.accountType !== 'cash_drawer' || !input.account.isActive || input.account.isDeleted) {
    throw new Error('Select an active cash drawer from this workspace.')
  }
  if (!input.cashierUserId || !input.cashierName.trim()) {
    throw new Error('Select a workspace member for this cashier shift.')
  }
  if (startMinutes === null || endMinutes === null || startMinutes === endMinutes) {
    throw new Error('Enter different valid start and end times.')
  }
  const workingDays = [...new Set(input.workingDays)].sort((left, right) => left - right)
  if (workingDays.length === 0 || workingDays.some((day) => day < 0 || day > 6 || !Number.isInteger(day))) {
    throw new Error('Select at least one working day.')
  }
  if (input.template && (input.template.workspaceId !== workspaceId || input.template.isDeleted || !input.template.isActive)) {
    throw new Error('Select an active shift template from this workspace.')
  }

  const [cashierUser, cashierProfile] = await Promise.all([
    db.users.get(input.cashierUserId),
    db.profiles.get(input.cashierUserId),
  ])
  const isWorkspaceMember = (!cashierUser?.isDeleted && cashierUser?.workspaceId === workspaceId)
    || cashierProfile?.workspaceId === workspaceId
  if (!isWorkspaceMember) throw new Error('Select a workspace member for this cashier shift.')

  const now = new Date().toISOString()
  const assignment: CashierShiftAssignment = {
    id: generateId(),
    workspaceId,
    templateId: input.template?.id ?? null,
    templateNameSnapshot: input.template?.name ?? null,
    accountId: input.account.id,
    accountNameSnapshot: input.account.name,
    cashierUserId: input.cashierUserId,
    cashierNameSnapshot: input.cashierName.trim(),
    startTime: input.startTime,
    endTime: input.endTime,
    workingDays,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    version: 1,
    isDeleted: false,
    ...syncMeta(workspaceId, now),
  }
  return persist('cashier_shift_assignments', assignment)
}

export interface StartCashierShiftOccurrenceInput {
  assignmentId: string
  cashierUserId: string
  scheduledStartAt: string
}

export async function startCashierShiftOccurrence(workspaceId: string, input: StartCashierShiftOccurrenceInput) {
  const assignment = await db.cashier_shift_assignments.get(input.assignmentId)
  if (!assignment || assignment.workspaceId !== workspaceId || assignment.isDeleted || !assignment.isActive) {
    throw new Error('This shift assignment is no longer available.')
  }
  if (assignment.cashierUserId !== input.cashierUserId) {
    throw new Error('Only the assigned cashier can start this shift.')
  }

  const scheduledDate = new Date(input.scheduledStartAt)
  const bounds = getCashierShiftOccurrenceBounds(assignment, scheduledDate)
  if (!bounds || !isCashierShiftWorkingDay(assignment, bounds.start)) {
    throw new Error('This shift is not scheduled for that day.')
  }
  if (bounds.start.toISOString() !== input.scheduledStartAt) {
    throw new Error('The shift occurrence no longer matches its assigned schedule.')
  }

  const now = new Date()
  if (now < bounds.start || now > bounds.end) {
    throw new Error('This shift can only be started during its scheduled time.')
  }
  const existing = await db.cashier_shift_occurrences
    .where('[assignmentId+scheduledStartAt]')
    .equals([assignment.id, input.scheduledStartAt])
    .first()
  if (existing && !existing.isDeleted) throw new Error('This shift occurrence has already been started.')

  const createdAt = now.toISOString()
  const occurrence: CashierShiftOccurrence = {
    id: generateId(),
    workspaceId,
    assignmentId: assignment.id,
    templateId: assignment.templateId ?? null,
    templateNameSnapshot: assignment.templateNameSnapshot ?? null,
    accountId: assignment.accountId,
    accountNameSnapshot: assignment.accountNameSnapshot,
    cashierUserId: assignment.cashierUserId,
    cashierNameSnapshot: assignment.cashierNameSnapshot,
    scheduledStartAt: bounds.start.toISOString(),
    scheduledEndAt: bounds.end.toISOString(),
    startedAt: createdAt,
    status: 'active',
    createdAt,
    updatedAt: createdAt,
    version: 1,
    isDeleted: false,
    ...syncMeta(workspaceId, createdAt),
  }
  return persist('cashier_shift_occurrences', occurrence)
}

/** Local-only mirrors use the same signed accounting rule as the cloud trigger. */
export async function mirrorPaymentAccountTransactionLocally(transaction: PaymentTransaction) {
  if (!transaction.accountId || !isLocalWorkspaceMode(transaction.workspaceId)) return
  const now = transaction.updatedAt || new Date().toISOString()
  const delta = transaction.isDeleted ? 0 : transaction.direction === 'incoming' ? transaction.amount : -transaction.amount
  const existingBalance = await db.payment_account_balances
    .where('[accountId+currency]')
    .equals([transaction.accountId, transaction.currency])
    .first()
  const movement: PaymentAccountMovement = {
    id: transaction.id,
    workspaceId: transaction.workspaceId,
    accountId: transaction.accountId,
    paymentTransactionId: transaction.id,
    accountNameSnapshot: transaction.accountNameSnapshot || '',
    direction: transaction.direction,
    amount: transaction.amount,
    deltaAmount: delta,
    currency: transaction.currency,
    occurredAt: transaction.paidAt,
    createdAt: transaction.createdAt,
    updatedAt: now,
    version: 1,
    isDeleted: transaction.isDeleted,
    ...syncMeta(transaction.workspaceId, now),
  }
  const balance: PaymentAccountBalance = {
    id: existingBalance?.id ?? generateId(),
    workspaceId: transaction.workspaceId,
    accountId: transaction.accountId,
    currency: transaction.currency,
    balanceAmount: Number(existingBalance?.balanceAmount || 0) + delta,
    createdAt: existingBalance?.createdAt ?? now,
    updatedAt: now,
    version: (existingBalance?.version ?? 0) + 1,
    isDeleted: false,
    ...syncMeta(transaction.workspaceId, now),
  }
  await db.transaction('rw', db.payment_account_movements, db.payment_account_balances, async () => {
    await db.payment_account_movements.put(movement)
    await db.payment_account_balances.put(balance)
  })
}
