import 'fake-indexeddb/auto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { clearWorkspaceModeSnapshot, writeWorkspaceModeSnapshot } from '@/workspace/workspaceMode'

import { db } from './database'
import type { CashierShiftAssignment, CashierShiftOccurrence, PaymentTransaction } from './models'

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000701'
const CASHIER_ID = '00000000-0000-4000-8000-000000000702'
const OTHER_CASHIER_ID = '00000000-0000-4000-8000-000000000703'
const NOW = new Date('2026-08-30T12:00:00.000Z')

let appendPaymentTransaction: typeof import('./payments').appendPaymentTransaction
let savePaymentAccount: typeof import('./paymentAccounts').savePaymentAccount
let createCashierShiftAssignment: typeof import('./paymentAccounts').createCashierShiftAssignment
let completeCashierShiftOccurrence: typeof import('./paymentAccounts').completeCashierShiftOccurrence
let requestCashierShiftEarlyFinish: typeof import('./paymentAccounts').requestCashierShiftEarlyFinish
let reviewCashierShiftEarlyFinishRequest: typeof import('./paymentAccounts').reviewCashierShiftEarlyFinishRequest
let requestCashierShiftPause: typeof import('./paymentAccounts').requestCashierShiftPause
let reviewCashierShiftPauseRequest: typeof import('./paymentAccounts').reviewCashierShiftPauseRequest
let pauseCashierShiftOccurrence: typeof import('./paymentAccounts').pauseCashierShiftOccurrence
let resumeCashierShiftOccurrence: typeof import('./paymentAccounts').resumeCashierShiftOccurrence
let terminateCashierShiftOccurrence: typeof import('./paymentAccounts').terminateCashierShiftOccurrence
let summarizeCashierShiftTransactions: typeof import('./paymentAccounts').summarizeCashierShiftTransactions
let startCashierShiftOccurrence: typeof import('./paymentAccounts').startCashierShiftOccurrence
let updateCashierShiftAssignment: typeof import('./paymentAccounts').updateCashierShiftAssignment

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

async function createActiveOccurrence(accountId: string, overrides: Partial<CashierShiftOccurrence> = {}) {
  const occurrence: CashierShiftOccurrence = {
    id: 'shift-occurrence-1',
    workspaceId: WORKSPACE_ID,
    assignmentId: 'shift-assignment-1',
    templateId: null,
    templateNameSnapshot: 'Morning',
    accountId,
    accountNameSnapshot: 'Main Drawer',
    cashierUserId: CASHIER_ID,
    cashierNameSnapshot: 'Cashier One',
    scheduledStartAt: new Date(NOW.getTime() - 60 * 60 * 1000).toISOString(),
    scheduledEndAt: new Date(NOW.getTime() + 60 * 60 * 1000).toISOString(),
    startedAt: new Date(NOW.getTime() - 30 * 60 * 1000).toISOString(),
    earlyFinishPolicy: 'scheduled_end',
    earlyFinishOffsetMinutes: null,
    earlyFinishRequestStatus: 'not_requested',
    earlyFinishRequestReason: null,
    earlyFinishRequestedAt: null,
    earlyFinishRequestedBy: null,
    earlyFinishReviewedAt: null,
    earlyFinishReviewedBy: null,
    earlyFinishReviewNote: null,
    status: 'active',
    completedAt: null,
    completedBy: null,
    completionReason: null,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    syncStatus: 'synced',
    lastSyncedAt: NOW.toISOString(),
    version: 1,
    isDeleted: false,
    ...overrides,
  }
  await db.cashier_shift_occurrences.put(occurrence)
  return occurrence
}

async function createTodayAssignment(id: string, accountId: string) {
  const scheduledDate = new Date(NOW)
  const assignment: CashierShiftAssignment = {
    id,
    workspaceId: WORKSPACE_ID,
    templateId: null,
    templateNameSnapshot: 'All day',
    accountId,
    accountNameSnapshot: 'Main Drawer',
    cashierUserId: CASHIER_ID,
    cashierNameSnapshot: 'Cashier One',
    startTime: '00:00',
    endTime: '23:59',
    workingDays: [scheduledDate.getDay()],
    earlyFinishPolicy: 'scheduled_end',
    earlyFinishOffsetMinutes: null,
    isActive: true,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    syncStatus: 'synced',
    lastSyncedAt: NOW.toISOString(),
    version: 1,
    isDeleted: false,
  }
  await db.cashier_shift_assignments.put(assignment)
  scheduledDate.setHours(0, 0, 0, 0)
  return { assignment, scheduledStartAt: scheduledDate.toISOString() }
}

async function addCashierUser() {
  await db.users.put({
    id: CASHIER_ID,
    workspaceId: WORKSPACE_ID,
    email: 'cashier@example.test',
    name: 'Cashier One',
    role: 'staff',
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    syncStatus: 'synced',
    lastSyncedAt: NOW.toISOString(),
    version: 1,
    isDeleted: false,
  })
}

function transaction(overrides: Partial<PaymentTransaction>): PaymentTransaction {
  return {
    id: 'payment-1',
    workspaceId: WORKSPACE_ID,
    sourceModule: 'payments',
    sourceType: 'direct_transaction',
    sourceRecordId: '00000000-0000-4000-8000-000000000704',
    sourceSubrecordId: null,
    direction: 'incoming',
    amount: 0,
    currency: 'usd',
    paymentMethod: 'cash',
    paidAt: NOW.toISOString(),
    counterpartyName: null,
    referenceLabel: null,
    note: null,
    createdBy: CASHIER_ID,
    accountId: 'account-1',
    accountNameSnapshot: 'Main Drawer',
    cashierShiftOccurrenceId: 'shift-occurrence-1',
    reversalOfTransactionId: null,
    metadata: null,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    syncStatus: 'synced',
    lastSyncedAt: NOW.toISOString(),
    version: 1,
    isDeleted: false,
    ...overrides,
  }
}

describe('cashier shift payment attribution', () => {
  beforeAll(async () => {
    installBrowserStorage()
    ;({ appendPaymentTransaction } = await import('./payments'))
    ;({
      savePaymentAccount,
      createCashierShiftAssignment,
      completeCashierShiftOccurrence,
      requestCashierShiftEarlyFinish,
      reviewCashierShiftEarlyFinishRequest,
      requestCashierShiftPause,
      reviewCashierShiftPauseRequest,
      pauseCashierShiftOccurrence,
      resumeCashierShiftOccurrence,
      terminateCashierShiftOccurrence,
      summarizeCashierShiftTransactions,
      startCashierShiftOccurrence,
      updateCashierShiftAssignment,
    } = await import('./paymentAccounts'))
  })

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    installBrowserStorage()
    await db.delete()
    await db.open()
    writeWorkspaceModeSnapshot({ workspaceId: WORKSPACE_ID, dataMode: 'local' })
  })

  afterEach(() => {
    vi.useRealTimers()
    clearWorkspaceModeSnapshot(WORKSPACE_ID)
  })
  afterAll(async () => { await db.delete() })

  it('links a posted account payment to the active cashier occurrence and keeps its account movement derived from the payment', async () => {
    const account = await savePaymentAccount(WORKSPACE_ID, { name: 'Main Drawer', accountType: 'cash_drawer' })
    const occurrence = await createActiveOccurrence(account.id)

    const posted = await appendPaymentTransaction(WORKSPACE_ID, {
      sourceModule: 'payments',
      sourceType: 'direct_transaction',
      sourceRecordId: '00000000-0000-4000-8000-000000000705',
      direction: 'incoming',
      amount: 125.5,
      currency: 'usd',
      paymentMethod: 'cash',
      paidAt: '2026-08-01T08:00:00.000Z',
      createdBy: CASHIER_ID,
      accountId: account.id,
      accountNameSnapshot: account.name,
    })

    expect(posted.cashierShiftOccurrenceId).toBe(occurrence.id)
    expect(await db.payment_account_movements.get(posted.id)).toMatchObject({ paymentTransactionId: posted.id, deltaAmount: 125.5 })
    expect(await db.payment_account_balances.where('[accountId+currency]').equals([account.id, 'usd']).first()).toMatchObject({ balanceAmount: 125.5 })
  })

  it('does not infer an expired occurrence for a later payment', async () => {
    const account = await savePaymentAccount(WORKSPACE_ID, { name: 'Main Drawer', accountType: 'cash_drawer' })
    await createActiveOccurrence(account.id, {
      scheduledEndAt: new Date(NOW.getTime() - 1).toISOString(),
    })

    const posted = await appendPaymentTransaction(WORKSPACE_ID, {
      sourceModule: 'payments',
      sourceType: 'direct_transaction',
      sourceRecordId: '00000000-0000-4000-8000-000000000706',
      direction: 'incoming',
      amount: 10,
      currency: 'usd',
      paymentMethod: 'cash',
      paidAt: NOW.toISOString(),
      createdBy: CASHIER_ID,
      accountId: account.id,
      accountNameSnapshot: account.name,
    })

    expect(posted.cashierShiftOccurrenceId).toBeNull()
  })

  it('summarizes signed incoming, outgoing, and reversal transactions per currency with stable rounding', () => {
    const summary = summarizeCashierShiftTransactions([
      transaction({ id: 'incoming', amount: 0.1, direction: 'incoming', currency: 'usd' }),
      transaction({ id: 'outgoing', amount: 0.2, direction: 'outgoing', currency: 'usd' }),
      transaction({ id: 'reversal', amount: -0.1, direction: 'outgoing', currency: 'usd', reversalOfTransactionId: 'outgoing' }),
      transaction({ id: 'unrelated', amount: 999, cashierShiftOccurrenceId: null }),
    ], 'shift-occurrence-1')

    expect(summary).toEqual([{
      currency: 'usd',
      incomingAmount: 0.2,
      outgoingAmount: 0.2,
      netAmount: 0,
      transactionCount: 3,
    }])
  })

  it('stores a valid timed early-finish rule and rejects an offset as long as the shift', async () => {
    const account = await savePaymentAccount(WORKSPACE_ID, { name: 'Main Drawer', accountType: 'cash_drawer' })
    await addCashierUser()

    const assignment = await createCashierShiftAssignment(WORKSPACE_ID, {
      account,
      cashierUserId: CASHIER_ID,
      cashierName: 'Cashier One',
      startTime: '08:00',
      endTime: '16:00',
      workingDays: [1],
      earlyFinishPolicy: 'time_before_end',
      earlyFinishOffsetMinutes: 15,
    })
    expect(assignment).toMatchObject({
      earlyFinishPolicy: 'time_before_end',
      earlyFinishOffsetMinutes: 15,
    })

    await expect(createCashierShiftAssignment(WORKSPACE_ID, {
      account,
      cashierUserId: CASHIER_ID,
      cashierName: 'Cashier One',
      startTime: '08:00',
      endTime: '16:00',
      workingDays: [1],
      earlyFinishPolicy: 'time_before_end',
      earlyFinishOffsetMinutes: 480,
    })).rejects.toThrow('shorter than the shift duration')
  })

  it('updates a recurring assignment without changing an already-started occurrence', async () => {
    const initialAccount = await savePaymentAccount(WORKSPACE_ID, { name: 'Main Drawer', accountType: 'cash_drawer' })
    const replacementAccount = await savePaymentAccount(WORKSPACE_ID, { name: 'Backup Drawer', accountType: 'cash_drawer' })
    await addCashierUser()
    const assignment = await createCashierShiftAssignment(WORKSPACE_ID, {
      account: initialAccount,
      cashierUserId: CASHIER_ID,
      cashierName: 'Cashier One',
      startTime: '08:00',
      endTime: '16:00',
      workingDays: [1],
      earlyFinishPolicy: 'scheduled_end',
    })
    const activeOccurrence = await createActiveOccurrence(initialAccount.id, { assignmentId: assignment.id })

    const updated = await updateCashierShiftAssignment(WORKSPACE_ID, assignment.id, {
      account: replacementAccount,
      cashierUserId: CASHIER_ID,
      cashierName: 'Cashier One',
      startTime: '09:00',
      endTime: '17:00',
      workingDays: [1, 3],
      earlyFinishPolicy: 'time_before_end',
      earlyFinishOffsetMinutes: 30,
    })

    expect(updated).toMatchObject({
      accountId: replacementAccount.id,
      accountNameSnapshot: replacementAccount.name,
      startTime: '09:00',
      endTime: '17:00',
      workingDays: [1, 3],
      earlyFinishPolicy: 'time_before_end',
      earlyFinishOffsetMinutes: 30,
      version: 2,
    })
    expect(await db.cashier_shift_occurrences.get(activeOccurrence.id)).toMatchObject({
      accountId: initialAccount.id,
      earlyFinishPolicy: 'scheduled_end',
    })
  })

  it('rejects an invalid assignment update without overwriting the current schedule', async () => {
    const account = await savePaymentAccount(WORKSPACE_ID, { name: 'Main Drawer', accountType: 'cash_drawer' })
    await addCashierUser()
    const assignment = await createCashierShiftAssignment(WORKSPACE_ID, {
      account,
      cashierUserId: CASHIER_ID,
      cashierName: 'Cashier One',
      startTime: '08:00',
      endTime: '16:00',
      workingDays: [1],
      earlyFinishPolicy: 'scheduled_end',
    })

    await expect(updateCashierShiftAssignment(WORKSPACE_ID, assignment.id, {
      account,
      cashierUserId: CASHIER_ID,
      cashierName: 'Cashier One',
      startTime: '08:00',
      endTime: '16:00',
      workingDays: [1],
      earlyFinishPolicy: 'time_before_end',
      earlyFinishOffsetMinutes: 480,
    })).rejects.toThrow('shorter than the shift duration')

    expect(await db.cashier_shift_assignments.get(assignment.id)).toMatchObject({
      startTime: '08:00',
      endTime: '16:00',
      earlyFinishPolicy: 'scheduled_end',
      version: 1,
    })
  })

  it('records immutable completion metadata only for the assigned cashier after the scheduled end', async () => {
    const account = await savePaymentAccount(WORKSPACE_ID, { name: 'Main Drawer', accountType: 'cash_drawer' })
    const occurrence = await createActiveOccurrence(account.id, {
      scheduledEndAt: new Date(NOW.getTime() - 60 * 1000).toISOString(),
    })

    await expect(completeCashierShiftOccurrence(WORKSPACE_ID, {
      occurrenceId: occurrence.id,
      cashierUserId: OTHER_CASHIER_ID,
    })).rejects.toThrow('Only the assigned cashier')

    const completed = await completeCashierShiftOccurrence(WORKSPACE_ID, {
      occurrenceId: occurrence.id,
      cashierUserId: CASHIER_ID,
    })
    expect(completed).toMatchObject({ status: 'completed', completedBy: CASHIER_ID, completedAt: NOW.toISOString() })
    await expect(completeCashierShiftOccurrence(WORKSPACE_ID, {
      occurrenceId: occurrence.id,
      cashierUserId: CASHIER_ID,
    })).resolves.toMatchObject({ status: 'completed', version: 2 })
  })

  it('blocks a normal shift from completing before its scheduled end', async () => {
    const account = await savePaymentAccount(WORKSPACE_ID, { name: 'Main Drawer', accountType: 'cash_drawer' })
    const occurrence = await createActiveOccurrence(account.id)

    await expect(completeCashierShiftOccurrence(WORKSPACE_ID, {
      occurrenceId: occurrence.id,
      cashierUserId: CASHIER_ID,
    })).rejects.toThrow('only finish at or after')
  })

  it('allows timed early completion only at its configured threshold', async () => {
    const account = await savePaymentAccount(WORKSPACE_ID, { name: 'Main Drawer', accountType: 'cash_drawer' })
    const occurrence = await createActiveOccurrence(account.id, {
      id: 'timed-shift-occurrence',
      scheduledEndAt: new Date(NOW.getTime() + 30 * 60 * 1000).toISOString(),
      earlyFinishPolicy: 'time_before_end',
      earlyFinishOffsetMinutes: 15,
    })

    await expect(completeCashierShiftOccurrence(WORKSPACE_ID, {
      occurrenceId: occurrence.id,
      cashierUserId: CASHIER_ID,
    })).rejects.toThrow('configured early-finish time')

    vi.setSystemTime(new Date(NOW.getTime() + 15 * 60 * 1000))
    await expect(completeCashierShiftOccurrence(WORKSPACE_ID, {
      occurrenceId: occurrence.id,
      cashierUserId: CASHIER_ID,
    })).resolves.toMatchObject({ status: 'completed', completedBy: CASHIER_ID })
  })

  it('requires a cashier request and administrator approval before approval-rule early completion', async () => {
    const account = await savePaymentAccount(WORKSPACE_ID, { name: 'Main Drawer', accountType: 'cash_drawer' })
    const occurrence = await createActiveOccurrence(account.id, {
      id: 'approval-shift-occurrence',
      earlyFinishPolicy: 'request_approval',
    })
    await db.profiles.put({ id: OTHER_CASHIER_ID, workspaceId: WORKSPACE_ID, name: 'Admin', role: 'admin' })

    await expect(completeCashierShiftOccurrence(WORKSPACE_ID, {
      occurrenceId: occurrence.id,
      cashierUserId: CASHIER_ID,
    })).rejects.toThrow('must approve')

    const requested = await requestCashierShiftEarlyFinish(WORKSPACE_ID, {
      occurrenceId: occurrence.id,
      cashierUserId: CASHIER_ID,
      reason: 'Medical appointment',
    })
    expect(requested).toMatchObject({ earlyFinishRequestStatus: 'requested', earlyFinishRequestedBy: CASHIER_ID })

    const approved = await reviewCashierShiftEarlyFinishRequest(WORKSPACE_ID, {
      occurrenceId: occurrence.id,
      reviewerUserId: OTHER_CASHIER_ID,
      decision: 'approved',
      reviewNote: 'Approved for today',
    })
    expect(approved).toMatchObject({ earlyFinishRequestStatus: 'approved', earlyFinishReviewedBy: OTHER_CASHIER_ID })

    await expect(completeCashierShiftOccurrence(WORKSPACE_ID, {
      occurrenceId: occurrence.id,
      cashierUserId: CASHIER_ID,
    })).resolves.toMatchObject({ status: 'completed', completedBy: CASHIER_ID })
  })

  it('requires and records a reason for free early completion', async () => {
    const account = await savePaymentAccount(WORKSPACE_ID, { name: 'Main Drawer', accountType: 'cash_drawer' })
    const occurrence = await createActiveOccurrence(account.id, {
      id: 'reason-shift-occurrence',
      earlyFinishPolicy: 'free_with_reason',
    })

    await expect(completeCashierShiftOccurrence(WORKSPACE_ID, {
      occurrenceId: occurrence.id,
      cashierUserId: CASHIER_ID,
    })).rejects.toThrow('Enter a reason')

    await expect(completeCashierShiftOccurrence(WORKSPACE_ID, {
      occurrenceId: occurrence.id,
      cashierUserId: CASHIER_ID,
      reason: 'Emergency at home',
    })).resolves.toMatchObject({ status: 'completed', completionReason: 'Emergency at home' })
  })

  it('starts one active occurrence but blocks a second active shift for the same cashier', async () => {
    const account = await savePaymentAccount(WORKSPACE_ID, { name: 'Main Drawer', accountType: 'cash_drawer' })
    const first = await createTodayAssignment('shift-assignment-1', account.id)
    const second = await createTodayAssignment('shift-assignment-2', account.id)

    const started = await startCashierShiftOccurrence(WORKSPACE_ID, {
      assignmentId: first.assignment.id,
      cashierUserId: CASHIER_ID,
      scheduledStartAt: first.scheduledStartAt,
    })
    expect(started).toMatchObject({
      assignmentId: first.assignment.id,
      cashierUserId: CASHIER_ID,
      status: 'active',
    })

    await expect(startCashierShiftOccurrence(WORKSPACE_ID, {
      assignmentId: second.assignment.id,
      cashierUserId: CASHIER_ID,
      scheduledStartAt: second.scheduledStartAt,
    })).rejects.toThrow()

    expect((await db.cashier_shift_occurrences.toArray())
      .filter((occurrence) => occurrence.cashierUserId === CASHIER_ID && occurrence.status === 'active'))
      .toHaveLength(1)
  })

  it('records an assigned cashier pause request and rejects duplicate or unauthorized requests', async () => {
    const account = await savePaymentAccount(WORKSPACE_ID, { name: 'Main Drawer', accountType: 'cash_drawer' })
    const occurrence = await createActiveOccurrence(account.id)

    await expect(requestCashierShiftPause(WORKSPACE_ID, {
      occurrenceId: occurrence.id,
      cashierUserId: OTHER_CASHIER_ID,
      reason: 'Need a break',
      requestedDurationMinutes: 15,
    })).rejects.toThrow('Only the assigned cashier')

    const requested = await requestCashierShiftPause(WORKSPACE_ID, {
      occurrenceId: occurrence.id,
      cashierUserId: CASHIER_ID,
      reason: 'Need a break',
      requestedDurationMinutes: 15,
    })
    expect(requested).toMatchObject({ status: 'pending', occurrenceId: occurrence.id, cashierUserId: CASHIER_ID, requestedDurationMinutes: 15 })
    expect(await db.cashier_shift_pause_requests.get(requested.id)).toMatchObject({ syncStatus: 'synced', reason: 'Need a break' })

    await expect(requestCashierShiftPause(WORKSPACE_ID, {
      occurrenceId: occurrence.id,
      cashierUserId: CASHIER_ID,
      reason: 'Still need a break',
      requestedResumeAt: new Date(NOW.getTime() + 30 * 60 * 1000).toISOString(),
    })).rejects.toThrow('already has a pause request')
  })

  it('approves or rejects pause requests with reviewer metadata and creates an approved pause period', async () => {
    const account = await savePaymentAccount(WORKSPACE_ID, { name: 'Main Drawer', accountType: 'cash_drawer' })
    const occurrence = await createActiveOccurrence(account.id)
    await db.profiles.put({ id: OTHER_CASHIER_ID, workspaceId: WORKSPACE_ID, name: 'Admin', role: 'admin' })
    const request = await requestCashierShiftPause(WORKSPACE_ID, {
      occurrenceId: occurrence.id,
      cashierUserId: CASHIER_ID,
      reason: 'Medical break',
      requestedDurationMinutes: 20,
    })

    await expect(reviewCashierShiftPauseRequest(WORKSPACE_ID, {
      requestId: request.id, reviewerUserId: CASHIER_ID, decision: 'approved',
    })).rejects.toThrow('Only an administrator')

    const approved = await reviewCashierShiftPauseRequest(WORKSPACE_ID, {
      requestId: request.id, reviewerUserId: OTHER_CASHIER_ID, decision: 'approved', reviewNote: 'Approved',
    })
    expect(approved.request).toMatchObject({ status: 'approved', reviewedBy: OTHER_CASHIER_ID, approvedPausePeriodId: approved.period?.id })
    expect(approved.occurrence).toMatchObject({ status: 'paused' })
    expect(approved.period).toMatchObject({ kind: 'cashier_request', pauseRequestId: request.id, resumedAt: null })

    const second = await createActiveOccurrence(account.id, { id: 'shift-occurrence-rejected' })
    const rejectedRequest = await requestCashierShiftPause(WORKSPACE_ID, {
      occurrenceId: second.id, cashierUserId: CASHIER_ID, reason: 'Brief break', requestedDurationMinutes: 5,
    })
    const rejected = await reviewCashierShiftPauseRequest(WORKSPACE_ID, {
      requestId: rejectedRequest.id, reviewerUserId: OTHER_CASHIER_ID, decision: 'rejected', reviewNote: 'Stay on shift',
    })
    expect(rejected.request).toMatchObject({ status: 'rejected', reviewedBy: OTHER_CASHIER_ID, reviewNote: 'Stay on shift' })
    expect(rejected.occurrence).toMatchObject({ status: 'active' })
  })

  it('records direct admin and emergency pause intervals, excludes paused shifts from payment attribution, and resumes them', async () => {
    const account = await savePaymentAccount(WORKSPACE_ID, { name: 'Main Drawer', accountType: 'cash_drawer' })
    const occurrence = await createActiveOccurrence(account.id)
    await db.profiles.put({ id: OTHER_CASHIER_ID, workspaceId: WORKSPACE_ID, name: 'Admin', role: 'admin' })

    const paused = await pauseCashierShiftOccurrence(WORKSPACE_ID, {
      occurrenceId: occurrence.id, initiatorUserId: OTHER_CASHIER_ID, kind: 'admin',
    })
    expect(paused).toMatchObject({ occurrence: { status: 'paused' }, period: { kind: 'admin', resumedAt: null } })

    const postedWhilePaused = await appendPaymentTransaction(WORKSPACE_ID, {
      sourceModule: 'payments', sourceType: 'direct_transaction', sourceRecordId: '00000000-0000-4000-0000-000000000707',
      direction: 'incoming', amount: 20, currency: 'usd', paymentMethod: 'cash', paidAt: NOW.toISOString(),
      createdBy: CASHIER_ID, accountId: account.id, accountNameSnapshot: account.name,
    })
    expect(postedWhilePaused.cashierShiftOccurrenceId).toBeNull()

    const resumed = await resumeCashierShiftOccurrence(WORKSPACE_ID, {
      occurrenceId: occurrence.id, resumedByUserId: OTHER_CASHIER_ID,
    })
    expect(resumed).toMatchObject({ occurrence: { status: 'active' }, period: { resumedBy: OTHER_CASHIER_ID, resumedAt: NOW.toISOString() } })

    const emergencyOccurrence = await createActiveOccurrence(account.id, { id: 'shift-occurrence-emergency' })
    const emergency = await pauseCashierShiftOccurrence(WORKSPACE_ID, {
      occurrenceId: emergencyOccurrence.id, initiatorUserId: OTHER_CASHIER_ID, kind: 'emergency', note: 'Drawer alarm',
    })
    expect(emergency.period).toMatchObject({ kind: 'emergency', note: 'Drawer alarm' })
  })

  it('terminates active and paused shifts as terminal records and closes an open pause period', async () => {
    const account = await savePaymentAccount(WORKSPACE_ID, { name: 'Main Drawer', accountType: 'cash_drawer' })
    await db.profiles.put({ id: OTHER_CASHIER_ID, workspaceId: WORKSPACE_ID, name: 'Admin', role: 'admin' })
    const activeOccurrence = await createActiveOccurrence(account.id)
    const activeTermination = await terminateCashierShiftOccurrence(WORKSPACE_ID, {
      occurrenceId: activeOccurrence.id, terminatedByUserId: OTHER_CASHIER_ID, reason: 'Policy breach',
    })
    expect(activeTermination.occurrence).toMatchObject({ status: 'terminated', terminatedBy: OTHER_CASHIER_ID, terminationReason: 'Policy breach' })
    await expect(resumeCashierShiftOccurrence(WORKSPACE_ID, { occurrenceId: activeOccurrence.id, resumedByUserId: OTHER_CASHIER_ID })).rejects.toThrow()
    await expect(completeCashierShiftOccurrence(WORKSPACE_ID, { occurrenceId: activeOccurrence.id, cashierUserId: CASHIER_ID })).rejects.toThrow()
    await expect(requestCashierShiftPause(WORKSPACE_ID, { occurrenceId: activeOccurrence.id, cashierUserId: CASHIER_ID, reason: 'Too late', requestedDurationMinutes: 5 })).rejects.toThrow()

    const pausedOccurrence = await createActiveOccurrence(account.id, { id: 'shift-occurrence-paused-termination' })
    const pause = await pauseCashierShiftOccurrence(WORKSPACE_ID, {
      occurrenceId: pausedOccurrence.id, initiatorUserId: OTHER_CASHIER_ID, kind: 'admin',
    })
    const pausedTermination = await terminateCashierShiftOccurrence(WORKSPACE_ID, {
      occurrenceId: pausedOccurrence.id, terminatedByUserId: OTHER_CASHIER_ID,
    })
    expect(pausedTermination).toMatchObject({ occurrence: { status: 'terminated', terminatedBy: OTHER_CASHIER_ID }, period: { id: pause.period.id, resumedBy: OTHER_CASHIER_ID, resumedAt: NOW.toISOString() } })
  })
})
