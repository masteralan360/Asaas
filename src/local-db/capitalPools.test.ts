import 'fake-indexeddb/auto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { clearWorkspaceModeSnapshot, writeWorkspaceModeSnapshot } from '@/workspace/workspaceMode'

import { db } from './database'
import type {
  CapitalPool,
  CurrencyCode,
  PaymentAccount,
  PaymentAccountBalance,
  PaymentAccountMovement,
  PaymentTransaction,
  PaymentTransactionDirection
} from './models'

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000701'
const NOW = '2026-09-08T12:00:00.000Z'

let buildCapitalPoolBreakdown: typeof import('./capitalPools').buildCapitalPoolBreakdown
let buildCapitalPoolAccountCashFlows: typeof import('./capitalPools').buildCapitalPoolAccountCashFlows
let buildCapitalPoolTotalsByCurrency: typeof import('./capitalPools').buildCapitalPoolTotalsByCurrency
let deleteCapitalPool: typeof import('./capitalPools').deleteCapitalPool
let resolveCapitalPoolCashFlowGranularity: typeof import('./capitalPools').resolveCapitalPoolCashFlowGranularity
let saveCapitalPool: typeof import('./capitalPools').saveCapitalPool
let assertPaymentAccountNotInCapitalPool: typeof import('./capitalPools').assertPaymentAccountNotInCapitalPool

function installBrowserStorage() {
  const rows = new Map<string, string>()
  const storage = {
    get length() { return rows.size },
    getItem: (key: string) => rows.get(key) ?? null,
    setItem: (key: string, value: string) => rows.set(key, value),
    removeItem: (key: string) => rows.delete(key),
    clear: () => rows.clear(),
    key: (index: number) => Array.from(rows.keys())[index] ?? null
  }
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: storage })
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: storage,
      sessionStorage: storage,
      location: { hash: '', origin: 'http://localhost', pathname: '/' },
      addEventListener: () => undefined
    }
  })
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      visibilityState: 'visible',
      dir: 'ltr',
      head: { appendChild: () => undefined },
      documentElement: { lang: 'en', dir: 'ltr' },
      getElementsByTagName: () => [{ appendChild: () => undefined }],
      createElement: () => ({ appendChild: () => undefined, styleSheet: null }),
      createTextNode: () => ({}),
      addEventListener: () => undefined,
      removeEventListener: () => undefined
    }
  })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: false } })
  Object.defineProperty(globalThis, 'DOMMatrix', { configurable: true, value: class DOMMatrix {} })
  Object.defineProperty(globalThis, 'ImageData', { configurable: true, value: class ImageData {} })
  Object.defineProperty(globalThis, 'Path2D', { configurable: true, value: class Path2D {} })
}

function account(id: string, name: string, isActive = true): PaymentAccount {
  return {
    id,
    workspaceId: WORKSPACE_ID,
    name,
    accountType: 'cash_drawer',
    linkedPaymentMethod: null,
    iconKey: 'cash_drawer',
    notes: null,
    isActive,
    isPrimary: name === 'Alpha',
    isDefaultForPaymentSelector: false,
    createdBy: null,
    createdAt: NOW,
    updatedAt: NOW,
    version: 1,
    isDeleted: false,
    syncStatus: 'synced',
    lastSyncedAt: NOW
  }
}

function balance(id: string, accountId: string, amount: number, currency: CurrencyCode = 'iqd'): PaymentAccountBalance {
  return {
    id,
    workspaceId: WORKSPACE_ID,
    accountId,
    currency,
    balanceAmount: amount,
    createdAt: NOW,
    updatedAt: NOW,
    version: 1,
    isDeleted: false,
    syncStatus: 'synced',
    lastSyncedAt: NOW
  }
}

function paymentTransaction(
  id: string,
  accountId: string,
  direction: PaymentTransactionDirection,
  amount: number,
  paidAt: string,
  reversalOfTransactionId: string | null = null
): PaymentTransaction {
  return {
    id,
    workspaceId: WORKSPACE_ID,
    sourceModule: 'payment_accounts',
    sourceType: direction === 'incoming' ? 'payment_account_deposit' : 'payment_account_withdrawal',
    sourceRecordId: accountId,
    direction,
    amount,
    currency: 'iqd',
    paymentMethod: 'cash',
    paidAt,
    accountId,
    accountNameSnapshot: accountId,
    reversalOfTransactionId,
    createdAt: paidAt,
    updatedAt: paidAt,
    version: 1,
    isDeleted: false,
    syncStatus: 'synced',
    lastSyncedAt: paidAt
  }
}

function movement(
  id: string,
  accountId: string,
  transactionId: string,
  deltaAmount: number,
  occurredAt: string,
  currency: CurrencyCode = 'iqd'
): PaymentAccountMovement {
  return {
    id,
    workspaceId: WORKSPACE_ID,
    accountId,
    paymentTransactionId: transactionId,
    accountNameSnapshot: accountId,
    direction: deltaAmount >= 0 ? 'incoming' : 'outgoing',
    amount: Math.abs(deltaAmount),
    deltaAmount,
    currency,
    occurredAt,
    createdAt: occurredAt,
    updatedAt: occurredAt,
    version: 1,
    isDeleted: false,
    syncStatus: 'synced',
    lastSyncedAt: occurredAt
  }
}

function pool(accountIds: string[], currency: CurrencyCode = 'iqd'): CapitalPool {
  return {
    id: '00000000-0000-4000-8000-000000000799',
    workspaceId: WORKSPACE_ID,
    name: 'Owners',
    currency,
    accountIds,
    createdBy: null,
    createdAt: NOW,
    updatedAt: NOW,
    version: 1,
    isDeleted: false,
    syncStatus: 'synced',
    lastSyncedAt: NOW
  }
}

async function seedAccounts(...rows: PaymentAccount[]) {
  await db.payment_accounts.bulkPut(rows)
}

describe('Capital Pools', () => {
  beforeAll(async () => {
    installBrowserStorage()
    ;({
      buildCapitalPoolAccountCashFlows,
      assertPaymentAccountNotInCapitalPool,
      buildCapitalPoolBreakdown,
      buildCapitalPoolTotalsByCurrency,
      deleteCapitalPool,
      resolveCapitalPoolCashFlowGranularity,
      saveCapitalPool
    } = await import('./capitalPools'))
  }, 30_000)

  beforeEach(async () => {
    installBrowserStorage()
    await db.delete()
    await db.open()
    writeWorkspaceModeSnapshot({ workspaceId: WORKSPACE_ID, dataMode: 'local' })
  })

  afterEach(() => clearWorkspaceModeSnapshot(WORKSPACE_ID))
  afterAll(async () => { await db.delete() })

  it('calculates live balances, sorts largest first, and forces displayed shares to exactly 100.00%', () => {
    const accounts = [
      account('00000000-0000-4000-8000-000000000711', 'PaymentAccount1'),
      account('00000000-0000-4000-8000-000000000712', 'PaymentAccount2'),
      account('00000000-0000-4000-8000-000000000713', 'PaymentAccount3')
    ]
    const result = buildCapitalPoolBreakdown(
      pool(accounts.map((item) => item.id)),
      accounts,
      [
        balance('00000000-0000-4000-8000-000000000721', accounts[0].id, 30_000_000),
        balance('00000000-0000-4000-8000-000000000722', accounts[1].id, 120_000_000),
        balance('00000000-0000-4000-8000-000000000723', accounts[2].id, 20_000_000)
      ]
    )

    expect(result.totalCapital).toBe(170_000_000)
    expect(result.members.map((member) => [member.accountName, member.balanceAmount, member.sharePercent])).toEqual([
      ['PaymentAccount2', 120_000_000, 70.59],
      ['PaymentAccount1', 30_000_000, 17.65],
      ['PaymentAccount3', 20_000_000, 11.76]
    ])
    expect(result.members.reduce((sum, member) => sum + member.shareBasisPoints, 0)).toBe(10_000)
  })

  it('allocates an equal-third rounding remainder deterministically', () => {
    const accounts = [
      account('00000000-0000-4000-8000-000000000711', 'Alpha'),
      account('00000000-0000-4000-8000-000000000712', 'Beta'),
      account('00000000-0000-4000-8000-000000000713', 'Gamma')
    ]
    const result = buildCapitalPoolBreakdown(
      pool(accounts.map((item) => item.id)),
      accounts,
      accounts.map((item, index) => balance(`00000000-0000-4000-8000-00000000072${index}`, item.id, 1))
    )

    expect(result.members.map((member) => member.sharePercent)).toEqual([33.34, 33.33, 33.33])
  })

  it('builds reversal-aware incoming, outgoing, and net flow for every pool account', () => {
    const accountA = account('00000000-0000-4000-8000-000000000711', 'Alpha')
    const accountB = account('00000000-0000-4000-8000-000000000712', 'Beta')
    const incomingAt = '2026-09-01T09:00:00.000Z'
    const outgoingAt = '2026-09-01T13:00:00.000Z'
    const incoming = paymentTransaction('tx-in', accountA.id, 'incoming', 100.005, incomingAt)
    const reversal = paymentTransaction('tx-reversal', accountA.id, 'outgoing', 40, '2026-09-02T09:00:00.000Z', incoming.id)
    const outgoing = paymentTransaction('tx-out', accountA.id, 'outgoing', 25, outgoingAt)
    const betaIncoming = paymentTransaction('tx-beta', accountB.id, 'incoming', 50, '2026-09-02T11:00:00.000Z')
    const excludedAtEnd = paymentTransaction('tx-end', accountB.id, 'incoming', 999, '2026-09-03T00:00:00.000Z')

    const result = buildCapitalPoolAccountCashFlows(
      pool([accountA.id, accountB.id]),
      [
        movement('move-in', accountA.id, incoming.id, 100.005, incomingAt),
        movement('move-reversal', accountA.id, reversal.id, -40, reversal.paidAt),
        movement('move-out', accountA.id, outgoing.id, -25, outgoingAt),
        movement('move-beta', accountB.id, betaIncoming.id, 50, betaIncoming.paidAt),
        movement('move-wrong-currency', accountB.id, 'tx-usd', 700, betaIncoming.paidAt, 'usd'),
        movement('move-end', accountB.id, excludedAtEnd.id, 999, excludedAtEnd.paidAt)
      ],
      [incoming, reversal, outgoing, betaIncoming, excludedAtEnd],
      {
        start: new Date('2026-09-01T00:00:00.000Z'),
        end: new Date('2026-09-03T00:00:00.000Z')
      }
    )

    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({
      accountId: accountA.id,
      granularity: 'day',
      outgoing: 25,
      transactionCount: 2
    })
    expect(result[0].incoming).toBeCloseTo(60.005, 6)
    expect(result[0].net).toBeCloseTo(35.005, 6)
    expect(result[0].points).toHaveLength(1)
    expect(result[0].points[0]).toMatchObject({
      bucketKey: '2026-09-01',
      bucketStart: '2026-09-01',
      outgoing: 25,
      transactionCount: 2
    })
    expect(result[0].points[0].incoming).toBeCloseTo(60.005, 6)
    expect(result[0].points[0].net).toBeCloseTo(35.005, 6)
    expect(result[1]).toMatchObject({
      accountId: accountB.id,
      incoming: 50,
      outgoing: 0,
      net: 50,
      transactionCount: 1
    })
  })

  it('switches cash-flow grouping at the daily, weekly, and monthly boundaries', () => {
    const start = new Date('2026-01-01T00:00:00.000Z')
    expect(resolveCapitalPoolCashFlowGranularity({
      start,
      end: new Date(start.getTime() + 45 * 24 * 60 * 60 * 1000)
    })).toBe('day')
    expect(resolveCapitalPoolCashFlowGranularity({
      start,
      end: new Date(start.getTime() + 46 * 24 * 60 * 60 * 1000)
    })).toBe('week')
    expect(resolveCapitalPoolCashFlowGranularity({
      start,
      end: new Date(start.getTime() + 241 * 24 * 60 * 60 * 1000)
    })).toBe('month')
  })

  it('keeps pool-total comparison separated by currency and largest first', () => {
    const accountA = account('00000000-0000-4000-8000-000000000711', 'Alpha')
    const accountB = account('00000000-0000-4000-8000-000000000712', 'Beta')
    const iqdSmall = { ...pool([accountA.id]), id: 'pool-iqd-small', name: 'IQD Small' }
    const iqdLarge = { ...pool([accountB.id]), id: 'pool-iqd-large', name: 'IQD Large' }
    const usdPool = { ...pool([accountA.id], 'usd'), id: 'pool-usd', name: 'USD Pool' }

    const result = buildCapitalPoolTotalsByCurrency(
      [iqdSmall, usdPool, iqdLarge],
      [accountA, accountB],
      [
        balance('balance-a-iqd', accountA.id, 20, 'iqd'),
        balance('balance-b-iqd', accountB.id, 80, 'iqd'),
        balance('balance-a-usd', accountA.id, 10, 'usd')
      ]
    )

    expect(result.map((group) => group.currency)).toEqual(['iqd', 'usd'])
    expect(result[0].pools.map((item) => [item.poolName, item.totalCapital])).toEqual([
      ['IQD Large', 80],
      ['IQD Small', 20]
    ])
    expect(result[1].pools.map((item) => [item.poolName, item.totalCapital])).toEqual([
      ['USD Pool', 10]
    ])
  })

  it('allows zero balances and displays every share as zero when total capital is zero', async () => {
    const alpha = account('00000000-0000-4000-8000-000000000711', 'Alpha')
    const beta = account('00000000-0000-4000-8000-000000000712', 'Beta')
    await seedAccounts(alpha, beta)

    const saved = await saveCapitalPool(WORKSPACE_ID, {
      name: 'Zero Pool',
      currency: 'iqd',
      accountIds: [beta.id, alpha.id],
      enabledCurrencies: ['iqd'],
      canManage: true
    })
    const result = buildCapitalPoolBreakdown(saved, [beta, alpha], [])

    expect(result.totalCapital).toBe(0)
    expect(result.members.map((member) => [member.accountName, member.sharePercent])).toEqual([
      ['Alpha', 0],
      ['Beta', 0]
    ])
  })

  it('requires permission and at least two active accounts', async () => {
    const alpha = account('00000000-0000-4000-8000-000000000711', 'Alpha')
    const inactive = account('00000000-0000-4000-8000-000000000712', 'Inactive', false)
    await seedAccounts(alpha, inactive)

    const baseInput = {
      name: 'Owners',
      currency: 'iqd' as const,
      accountIds: [alpha.id, inactive.id],
      enabledCurrencies: ['iqd'] as const
    }
    await expect(saveCapitalPool(WORKSPACE_ID, { ...baseInput, canManage: false })).rejects.toThrow('not allowed')
    await expect(saveCapitalPool(WORKSPACE_ID, { ...baseInput, canManage: true })).rejects.toThrow('active')
    await expect(saveCapitalPool(WORKSPACE_ID, {
      ...baseInput,
      accountIds: [alpha.id],
      canManage: true
    })).rejects.toThrow('at least two')
  })

  it('enforces case-insensitive names and exclusive membership per currency', async () => {
    const alpha = account('00000000-0000-4000-8000-000000000711', 'Alpha')
    const beta = account('00000000-0000-4000-8000-000000000712', 'Beta')
    const gamma = account('00000000-0000-4000-8000-000000000713', 'Gamma')
    await seedAccounts(alpha, beta, gamma)

    await saveCapitalPool(WORKSPACE_ID, {
      name: 'Owners', currency: 'iqd', accountIds: [alpha.id, beta.id], enabledCurrencies: ['iqd', 'usd'], canManage: true
    })
    await expect(saveCapitalPool(WORKSPACE_ID, {
      name: 'owners', currency: 'usd', accountIds: [beta.id, gamma.id], enabledCurrencies: ['iqd', 'usd'], canManage: true
    })).rejects.toThrow('already exists')
    await expect(saveCapitalPool(WORKSPACE_ID, {
      name: 'Second', currency: 'iqd', accountIds: [alpha.id, gamma.id], enabledCurrencies: ['iqd', 'usd'], canManage: true
    })).rejects.toThrow('already belongs')
    await expect(saveCapitalPool(WORKSPACE_ID, {
      name: 'USD Owners', currency: 'usd', accountIds: [alpha.id, gamma.id], enabledCurrencies: ['iqd', 'usd'], canManage: true
    })).resolves.toMatchObject({ currency: 'usd' })
  })

  it('serializes concurrent local membership decisions so the first save wins', async () => {
    const alpha = account('00000000-0000-4000-8000-000000000711', 'Alpha')
    const beta = account('00000000-0000-4000-8000-000000000712', 'Beta')
    const gamma = account('00000000-0000-4000-8000-000000000713', 'Gamma')
    await seedAccounts(alpha, beta, gamma)

    const results = await Promise.allSettled([
      saveCapitalPool(WORKSPACE_ID, {
        name: 'First', currency: 'iqd', accountIds: [alpha.id, beta.id], enabledCurrencies: ['iqd'], canManage: true
      }),
      saveCapitalPool(WORKSPACE_ID, {
        name: 'Second', currency: 'iqd', accountIds: [alpha.id, gamma.id], enabledCurrencies: ['iqd'], canManage: true
      })
    ])

    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected'])
    expect((await db.capital_pools.where('workspaceId').equals(WORKSPACE_ID).toArray()).filter((item) => !item.isDeleted)).toHaveLength(1)
  })

  it('keeps a disabled currency on an existing pool but blocks changing into a disabled currency', async () => {
    const alpha = account('00000000-0000-4000-8000-000000000711', 'Alpha')
    const beta = account('00000000-0000-4000-8000-000000000712', 'Beta')
    await seedAccounts(alpha, beta)
    const saved = await saveCapitalPool(WORKSPACE_ID, {
      name: 'USD Pool', currency: 'usd', accountIds: [alpha.id, beta.id], enabledCurrencies: ['iqd', 'usd'], canManage: true
    })

    await expect(saveCapitalPool(WORKSPACE_ID, {
      id: saved.id,
      name: 'Renamed USD Pool',
      currency: 'usd',
      accountIds: [alpha.id, beta.id],
      enabledCurrencies: ['iqd'],
      canManage: true
    })).resolves.toMatchObject({ name: 'Renamed USD Pool', currency: 'usd' })
    await expect(saveCapitalPool(WORKSPACE_ID, {
      name: 'Another USD Pool', currency: 'usd', accountIds: [alpha.id, beta.id], enabledCurrencies: ['iqd'], canManage: true
    })).rejects.toThrow('not enabled')
  })

  it('keeps the shared account-removal guard active until the pool is deleted', async () => {
    const alpha = account('00000000-0000-4000-8000-000000000711', 'Alpha')
    const beta = account('00000000-0000-4000-8000-000000000712', 'Beta')
    await seedAccounts(alpha, beta)
    const savedPool = await saveCapitalPool(WORKSPACE_ID, {
      name: 'Owners', currency: 'iqd', accountIds: [alpha.id, beta.id], enabledCurrencies: ['iqd'], canManage: true
    })

    await expect(assertPaymentAccountNotInCapitalPool(WORKSPACE_ID, alpha.id)).rejects.toThrow('before deactivating or deleting')

    await deleteCapitalPool(WORKSPACE_ID, savedPool.id, true)
    await expect(assertPaymentAccountNotInCapitalPool(WORKSPACE_ID, alpha.id)).resolves.toBeUndefined()
  })
})
