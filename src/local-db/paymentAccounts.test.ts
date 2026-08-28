import 'fake-indexeddb/auto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { clearWorkspaceModeSnapshot, writeWorkspaceModeSnapshot } from '@/workspace/workspaceMode'

import { db } from './database'
import type { PaymentTransaction } from './models'

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000501'

let appendPaymentTransaction: typeof import('./payments').appendPaymentTransaction
let reversePaymentTransaction: typeof import('./payments').reversePaymentTransaction
let recordObligationSettlement: typeof import('./payments').recordObligationSettlement
let i18n: typeof import('@/i18n/config').default
let createManualLoan: typeof import('./hooks').createManualLoan
let recordLoanPayment: typeof import('./hooks').recordLoanPayment
let savePaymentAccount: typeof import('./paymentAccounts').savePaymentAccount
let assertPaymentAccountTransactionCanBeAppliedLocally: typeof import('./paymentAccounts').assertPaymentAccountTransactionCanBeAppliedLocally
let mirrorPaymentAccountTransactionLocally: typeof import('./paymentAccounts').mirrorPaymentAccountTransactionLocally

function installBrowserStorage() {
  const rows = new Map<string, string>()
  const storage = {
    get length() { return rows.size },
    getItem: (key: string) => rows.get(key) ?? null,
    setItem: (key: string, value: string) => rows.set(key, value),
    removeItem: (key: string) => rows.delete(key),
    clear: () => rows.clear(),
    key: (index: number) => Array.from(rows.keys())[index] ?? null,
  }
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: storage })
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: storage, sessionStorage: storage, location: { hash: '', origin: 'http://localhost', pathname: '/' }, addEventListener: () => undefined },
  })
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { visibilityState: 'visible', dir: 'ltr', documentElement: { lang: 'en', dir: 'ltr' }, addEventListener: () => undefined, removeEventListener: () => undefined },
  })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: false } })
}

async function createFundedAccount(openingAmount = 50_000) {
  return savePaymentAccount(WORKSPACE_ID, {
    name: 'Cash Drawer',
    accountType: 'cash_drawer',
    openingBalances: [{ currency: 'iqd', amount: openingAmount }],
  })
}

function outgoing(accountId: string, amount: number): Omit<PaymentTransaction, 'id' | 'createdAt' | 'updatedAt' | 'version' | 'syncStatus' | 'lastSyncedAt'> {
  return {
    workspaceId: WORKSPACE_ID,
    sourceModule: 'loans',
    sourceType: 'simple_loan',
    sourceRecordId: '00000000-0000-4000-8000-000000000599',
    sourceSubrecordId: null,
    direction: 'outgoing',
    amount,
    currency: 'iqd',
    paymentMethod: 'cash',
    paidAt: '2026-08-28T12:00:00.000Z',
    counterpartyName: 'Test partner',
    referenceLabel: 'SL-TEST',
    note: null,
    createdBy: null,
    accountId,
    accountNameSnapshot: 'Cash Drawer',
    reversalOfTransactionId: null,
    metadata: null,
    isDeleted: false,
  }
}

describe('payment-account availability', () => {
  beforeAll(async () => {
    installBrowserStorage()
    i18n = (await import('@/i18n/config')).default
    ;({ appendPaymentTransaction, reversePaymentTransaction, recordObligationSettlement } = await import('./payments'))
    ;({ createManualLoan, recordLoanPayment } = await import('./hooks'))
    ;({
      savePaymentAccount,
      assertPaymentAccountTransactionCanBeAppliedLocally,
      mirrorPaymentAccountTransactionLocally,
    } = await import('./paymentAccounts'))
  })

  beforeEach(async () => {
    installBrowserStorage()
    await db.delete()
    await db.open()
    writeWorkspaceModeSnapshot({ workspaceId: WORKSPACE_ID, dataMode: 'local' })
  })

  afterEach(() => clearWorkspaceModeSnapshot(WORKSPACE_ID))
  afterAll(async () => { await db.delete() })

  it('rejects an outgoing payment that exceeds the selected account balance while preserving ledger-only payments', async () => {
    const account = await createFundedAccount()

    await expect(appendPaymentTransaction(WORKSPACE_ID, outgoing(account.id, 60_000))).rejects.toThrow('Current balance: 50,000 د.ع')
    expect(await db.payment_transactions.count()).toBe(1)

    await expect(appendPaymentTransaction(WORKSPACE_ID, {
      ...outgoing(account.id, 60_000),
      sourceRecordId: '00000000-0000-4000-8000-000000000598',
      accountId: null,
      accountNameSnapshot: null,
    })).resolves.toMatchObject({ accountId: null, amount: 60_000 })
  })

  it('uses the old-versus-new delta when a local movement is updated', async () => {
    const account = await createFundedAccount()
    const opening = (await db.payment_transactions.where('workspaceId').equals(WORKSPACE_ID).toArray())[0]
    expect(opening).toBeDefined()

    await mirrorPaymentAccountTransactionLocally({ ...opening!, isDeleted: true, updatedAt: '2026-08-28T13:00:00.000Z' })
    const balance = await db.payment_account_balances.where('[accountId+currency]').equals([account.id, 'iqd']).first()
    expect(balance?.balanceAmount).toBe(0)
  })

  it('rejects removing an incoming movement after the account has already spent it', async () => {
    const account = await createFundedAccount()
    await appendPaymentTransaction(WORKSPACE_ID, outgoing(account.id, 50_000))
    const opening = (await db.payment_transactions.where('workspaceId').equals(WORKSPACE_ID).toArray())
      .find((transaction) => transaction.sourceType === 'payment_account_opening_balance')

    await expect(assertPaymentAccountTransactionCanBeAppliedLocally({
      ...opening!,
      isDeleted: true,
      updatedAt: '2026-08-28T13:00:00.000Z',
    })).rejects.toThrow('Current balance: 0 د.ع')
  })

  it('keeps the original payment and nets a signed reversal to zero', async () => {
    const account = await createFundedAccount()
    const original = await appendPaymentTransaction(WORKSPACE_ID, {
      ...outgoing(account.id, 50_000),
      sourceModule: 'payments',
      sourceType: 'direct_transaction',
    })

    const reversal = await reversePaymentTransaction(WORKSPACE_ID, original.id)

    const balance = await db.payment_account_balances.where('[accountId+currency]').equals([account.id, 'iqd']).first()
    expect(balance?.balanceAmount).toBe(50_000)
    expect((await db.payment_transactions.get(original.id))?.isDeleted).toBe(false)
    expect(reversal).toMatchObject({ accountId: account.id, reversalOfTransactionId: original.id, amount: -50_000 })
  })

  it('rejects an unfundable manual simple loan without creating the loan, installment, or origination payment', async () => {
    const account = await createFundedAccount(110_000)

    await expect(createManualLoan(WORKSPACE_ID, {
      loanCategory: 'simple',
      direction: 'lent',
      borrowerName: 'Test Borrower',
      borrowerPhone: '',
      borrowerAddress: '',
      borrowerNationalId: '',
      principalAmount: 150_000,
      settlementCurrency: 'iqd',
      installmentCount: 1,
      installmentFrequency: 'monthly',
      firstDueDate: '2026-09-01',
      accountId: account.id,
      accountNameSnapshot: account.name,
    })).rejects.toThrow('Current balance: 110,000 د.ع')

    expect(await db.loans.count()).toBe(0)
    expect(await db.loan_installments.count()).toBe(0)
    expect((await db.payment_transactions.where('workspaceId').equals(WORKSPACE_ID).toArray())
      .filter((transaction) => transaction.sourceType === 'loan_origination')).toHaveLength(0)

    const balance = await db.payment_account_balances
      .where('[accountId+currency]')
      .equals([account.id, 'iqd'])
      .first()
    expect(balance?.balanceAmount).toBe(110_000)
  })

  it('rejects an unfundable borrowed-loan repayment without changing the loan payment state', async () => {
    const account = await createFundedAccount(110_000)
    const { loan } = await createManualLoan(WORKSPACE_ID, {
      loanCategory: 'simple',
      direction: 'borrowed',
      borrowerName: 'Test Lender',
      borrowerPhone: '',
      borrowerAddress: '',
      borrowerNationalId: '',
      principalAmount: 150_000,
      settlementCurrency: 'iqd',
      installmentCount: 1,
      installmentFrequency: 'monthly',
      firstDueDate: '2026-09-01',
    })

    await expect(recordLoanPayment(WORKSPACE_ID, {
      loanId: loan.id,
      amount: 150_000,
      paymentMethod: 'cash',
      accountId: account.id,
      accountNameSnapshot: account.name,
    })).rejects.toThrow('Current balance: 110,000 د.ع')

    expect(await db.loan_payments.count()).toBe(0)
    expect(await db.loans.get(loan.id)).toMatchObject({
      totalPaidAmount: 0,
      balanceAmount: 150_000,
    })
    expect((await db.payment_transactions.where('workspaceId').equals(WORKSPACE_ID).toArray())
      .filter((transaction) => transaction.sourceType === 'simple_loan')).toHaveLength(0)
  })

  it('keeps an expense unpaid when its selected account cannot fund the settlement', async () => {
    const account = await createFundedAccount(110_000)
    const now = '2026-08-28T12:00:00.000Z'
    const seriesId = '00000000-0000-4000-8000-000000000551'
    const expenseId = '00000000-0000-4000-8000-000000000552'
    await db.expense_series.put({
      id: seriesId,
      workspaceId: WORKSPACE_ID,
      name: 'Rent',
      amount: 150_000,
      currency: 'iqd',
      dueDay: 1,
      recurrence: 'monthly',
      startMonth: '2026-08',
      endMonth: null,
      category: null,
      subcategory: null,
      createdAt: now,
      updatedAt: now,
      syncStatus: 'pending',
      lastSyncedAt: null,
      version: 1,
      isDeleted: false,
    })
    await db.expense_items.put({
      id: expenseId,
      workspaceId: WORKSPACE_ID,
      seriesId,
      month: '2026-08',
      dueDate: '2026-08-01',
      amount: 150_000,
      currency: 'iqd',
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      syncStatus: 'pending',
      lastSyncedAt: null,
      version: 1,
      isDeleted: false,
    })

    await expect(recordObligationSettlement(WORKSPACE_ID, {
      id: `expense:${expenseId}`,
      workspaceId: WORKSPACE_ID,
      sourceModule: 'budget',
      sourceType: 'expense_item',
      sourceRecordId: expenseId,
      sourceSubrecordId: seriesId,
      direction: 'outgoing',
      amount: 150_000,
      currency: 'iqd',
      paymentMethod: 'unknown',
      counterpartyName: null,
      referenceLabel: 'Rent',
      dueDate: '2026-08-01',
      status: 'open',
      metadata: null,
    } as any, {
      paymentMethod: 'cash',
      accountId: account.id,
      accountNameSnapshot: account.name,
    })).rejects.toThrow('Current balance: 110,000 د.ع')

    expect(await db.expense_items.get(expenseId)).toMatchObject({ status: 'pending' })
    expect((await db.payment_transactions.where('workspaceId').equals(WORKSPACE_ID).toArray())
      .filter((transaction) => transaction.sourceType === 'expense_item')).toHaveLength(0)
  })

  it('keeps payroll unpaid when its selected account cannot fund the settlement', async () => {
    const account = await createFundedAccount(110_000)
    const now = '2026-08-28T12:00:00.000Z'
    const employeeId = '00000000-0000-4000-8000-000000000553'
    await db.employees.put({
      id: employeeId,
      workspaceId: WORKSPACE_ID,
      name: 'Test Employee',
      role: 'Staff',
      joiningDate: '2026-01-01',
      salary: 150_000,
      salaryCurrency: 'iqd',
      createdAt: now,
      updatedAt: now,
      syncStatus: 'pending',
      lastSyncedAt: null,
      version: 1,
      isDeleted: false,
    })

    await expect(recordObligationSettlement(WORKSPACE_ID, {
      id: `payroll:${employeeId}:2026-08`,
      workspaceId: WORKSPACE_ID,
      sourceModule: 'budget',
      sourceType: 'payroll_status',
      sourceRecordId: `${employeeId}:2026-08`,
      sourceSubrecordId: employeeId,
      direction: 'outgoing',
      amount: 150_000,
      currency: 'iqd',
      paymentMethod: 'unknown',
      counterpartyName: 'Test Employee',
      referenceLabel: 'Payroll 2026-08',
      dueDate: '2026-08-01',
      status: 'open',
      metadata: { employeeId, month: '2026-08' },
    } as any, {
      paymentMethod: 'cash',
      accountId: account.id,
      accountNameSnapshot: account.name,
    })).rejects.toThrow('Current balance: 110,000 د.ع')

    expect(await db.payroll_statuses.count()).toBe(0)
    expect((await db.payment_transactions.where('workspaceId').equals(WORKSPACE_ID).toArray())
      .filter((transaction) => transaction.sourceType === 'payroll_status')).toHaveLength(0)
  })

  it('localizes an insufficient-funds error using the active application language', async () => {
    const account = await createFundedAccount(50_000)
    await i18n.changeLanguage('ar')

    try {
      await expect(appendPaymentTransaction(WORKSPACE_ID, outgoing(account.id, 60_000)))
        .rejects.toThrow('لا يوجد رصيد كافٍ')
    } finally {
      await i18n.changeLanguage('en')
    }
  })
})
