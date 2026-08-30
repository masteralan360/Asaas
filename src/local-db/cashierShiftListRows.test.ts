import { beforeAll, describe, expect, it } from 'vitest'

import type { CashierShiftAssignment, CashierShiftOccurrence } from './models'

const WORKSPACE_ID = 'workspace-1'
const CASHIER_ID = 'cashier-1'
const CREATED_AT = '2026-08-01T00:00:00.000Z'

let getCashierShiftListRows: typeof import('./paymentAccounts').getCashierShiftListRows
let getCashierShiftTeamRows: typeof import('./paymentAccounts').getCashierShiftTeamRows
let getCashierShiftOccurrenceBounds: typeof import('./paymentAccounts').getCashierShiftOccurrenceBounds

function installBrowserStorage() {
  Object.defineProperty(globalThis.URL, 'createObjectURL', {
    configurable: true,
    value: () => 'blob:vitest'
  })
  Object.defineProperty(globalThis, 'DOMMatrix', {
    configurable: true,
    value: class DOMMatrix {}
  })
  const rows = new Map<string, string>()
  const storage = {
    get length() {
      return rows.size
    },
    getItem: (key: string) => rows.get(key) ?? null,
    setItem: (key: string, value: string) => rows.set(key, value),
    removeItem: (key: string) => rows.delete(key),
    clear: () => rows.clear(),
    key: (index: number) => Array.from(rows.keys())[index] ?? null
  }
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage
  })
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: storage
  })
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: storage,
      sessionStorage: storage,
      URL: globalThis.URL,
      location: { hash: '', origin: 'http://localhost', pathname: '/' },
      addEventListener: () => undefined
    }
  })
  const documentHead = { appendChild: () => undefined }
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      visibilityState: 'visible',
      dir: 'ltr',
      documentElement: { lang: 'en', dir: 'ltr' },
      head: documentHead,
      getElementsByTagName: () => [documentHead],
      createElement: () => ({
        setAttribute: () => undefined,
        appendChild: () => undefined
      }),
      createTextNode: () => ({}),
      addEventListener: () => undefined,
      removeEventListener: () => undefined
    }
  })
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { onLine: false }
  })
}

function assignment(overrides: Partial<CashierShiftAssignment> = {}): CashierShiftAssignment {
  return {
    id: 'assignment-1',
    workspaceId: WORKSPACE_ID,
    templateId: null,
    templateNameSnapshot: 'Day shift',
    accountId: 'drawer-1',
    accountNameSnapshot: 'Main drawer',
    cashierUserId: CASHIER_ID,
    cashierNameSnapshot: 'Cashier',
    startTime: '08:00',
    endTime: '16:00',
    workingDays: [0, 1, 2, 3, 4, 5, 6],
    earlyFinishPolicy: 'scheduled_end',
    earlyFinishOffsetMinutes: null,
    isActive: true,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    syncStatus: 'synced',
    lastSyncedAt: CREATED_AT,
    version: 1,
    isDeleted: false,
    ...overrides
  }
}

function occurrence(
  scheduledStartAt: string,
  scheduledEndAt: string,
  overrides: Partial<CashierShiftOccurrence> = {}
): CashierShiftOccurrence {
  return {
    id: 'occurrence-1',
    workspaceId: WORKSPACE_ID,
    assignmentId: 'assignment-1',
    templateId: null,
    templateNameSnapshot: 'Day shift',
    accountId: 'drawer-1',
    accountNameSnapshot: 'Main drawer',
    cashierUserId: CASHIER_ID,
    cashierNameSnapshot: 'Cashier',
    scheduledStartAt,
    scheduledEndAt,
    startedAt: scheduledStartAt,
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
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    syncStatus: 'synced',
    lastSyncedAt: CREATED_AT,
    version: 1,
    isDeleted: false,
    ...overrides
  }
}

describe('getCashierShiftListRows', () => {
  beforeAll(async () => {
    installBrowserStorage()
    ;({ getCashierShiftListRows, getCashierShiftTeamRows, getCashierShiftOccurrenceBounds } =
      await import('./paymentAccounts'))
  })

  it('shows one persisted active shift without creating speculative recurring rows', () => {
    const now = new Date(2026, 7, 30, 12, 0)
    const shift = assignment()
    const bounds = getCashierShiftOccurrenceBounds(shift, now)!
    const rows = getCashierShiftListRows({
      assignments: [shift],
      occurrences: [occurrence(bounds.start.toISOString(), bounds.end.toISOString())],
      cashierUserId: CASHIER_ID,
      now
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      status: 'active',
      scheduledStartAt: bounds.start.toISOString()
    })
  })

  it('matches equivalent persisted offset timestamps with the current schedule', () => {
    const now = new Date(2026, 7, 30, 12, 0)
    const shift = assignment()
    const bounds = getCashierShiftOccurrenceBounds(shift, now)!
    const offsetTimestamp = bounds.start.toISOString().replace('Z', '+00:00')
    const rows = getCashierShiftListRows({
      assignments: [shift],
      occurrences: [occurrence(offsetTimestamp, bounds.end.toISOString())],
      cashierUserId: CASHIER_ID,
      now
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      status: 'active',
      scheduledStartAt: offsetTimestamp
    })
  })

  it('shows the current unstarted shift as ready, but not past or future schedule placeholders', () => {
    const now = new Date(2026, 7, 30, 12, 0)
    const shift = assignment()
    const bounds = getCashierShiftOccurrenceBounds(shift, now)!
    const rows = getCashierShiftListRows({
      assignments: [shift],
      occurrences: [],
      cashierUserId: CASHIER_ID,
      now
    })

    expect(rows).toEqual([
      expect.objectContaining({
        status: 'available',
        scheduledStartAt: bounds.start.toISOString()
      })
    ])
  })

  it('retains completed history without adding an unavailable shift after the scheduled end', () => {
    const now = new Date(2026, 7, 30, 17, 0)
    const shift = assignment()
    const completedDate = new Date(now)
    completedDate.setDate(now.getDate() - 2)
    const bounds = getCashierShiftOccurrenceBounds(shift, completedDate)!
    const rows = getCashierShiftListRows({
      assignments: [shift],
      occurrences: [
        occurrence(bounds.start.toISOString(), bounds.end.toISOString(), {
          status: 'completed',
          completedAt: bounds.end.toISOString()
        })
      ],
      cashierUserId: CASHIER_ID,
      now
    })

    expect(rows).toEqual([
      expect.objectContaining({
        status: 'completed',
        scheduledStartAt: bounds.start.toISOString()
      })
    ])
  })

  it('makes an overnight shift ready after midnight based on the prior working day', () => {
    const now = new Date(2026, 7, 30, 1, 0)
    const previousDay = new Date(now)
    previousDay.setDate(now.getDate() - 1)
    const shift = assignment({
      startTime: '23:00',
      endTime: '02:00',
      workingDays: [previousDay.getDay()]
    })
    const bounds = getCashierShiftOccurrenceBounds(shift, previousDay)!
    const rows = getCashierShiftListRows({
      assignments: [shift],
      occurrences: [],
      cashierUserId: CASHIER_ID,
      now
    })

    expect(rows).toEqual([
      expect.objectContaining({
        status: 'available',
        scheduledStartAt: bounds.start.toISOString()
      })
    ])
  })

  it('shows a manual shift only on its working day and uses its actual timestamps after it starts', () => {
    const now = new Date(2026, 7, 30, 12, 0)
    const manual = assignment({
      assignmentMode: 'manual',
      templateId: null,
      templateNameSnapshot: null,
      startTime: null,
      endTime: null,
      workingDays: [now.getDay()],
      earlyFinishPolicy: null,
      earlyFinishOffsetMinutes: null
    })
    const rows = getCashierShiftListRows({
      assignments: [manual],
      occurrences: [],
      cashierUserId: CASHIER_ID,
      now
    })
    expect(rows).toEqual([
      expect.objectContaining({
        status: 'available',
        assignmentMode: 'manual'
      })
    ])

    const startedAt = now.toISOString()
    const activeRows = getCashierShiftListRows({
      assignments: [manual],
      occurrences: [
        occurrence('', '', {
          assignmentMode: 'manual',
          scheduledStartAt: null,
          scheduledEndAt: null,
          earlyFinishPolicy: null,
          earlyFinishOffsetMinutes: null,
          earlyFinishRequestStatus: null,
          startedAt
        })
      ],
      cashierUserId: CASHIER_ID,
      now
    })
    expect(activeRows).toEqual([
      expect.objectContaining({
        status: 'active',
        scheduledStartAt: startedAt,
        scheduledEndAt: startedAt
      })
    ])
  })

  it('does not offer a shift-tab start row for login/logout assignments', () => {
    const now = new Date(2026, 7, 30, 12, 0)
    const loginLogout = assignment({
      assignmentMode: 'login_logout',
      templateId: null,
      templateNameSnapshot: null,
      startTime: null,
      endTime: null,
      workingDays: [],
      earlyFinishPolicy: null,
      earlyFinishOffsetMinutes: null
    })

    expect(
      getCashierShiftListRows({
        assignments: [loginLogout],
        occurrences: [],
        cashierUserId: CASHIER_ID,
        now
      })
    ).toEqual([])
  })

  it('lists only real team occurrences, including paused and terminated snapshots without their current assignment', () => {
    const now = new Date(2026, 7, 30, 12, 0)
    const shift = assignment()
    const bounds = getCashierShiftOccurrenceBounds(shift, now)!
    const rows = getCashierShiftTeamRows({
      assignments: [],
      occurrences: [
        occurrence(bounds.start.toISOString(), bounds.end.toISOString(), {
          id: 'paused',
          status: 'paused'
        }),
        occurrence(
          new Date(bounds.start.getTime() - 86_400_000).toISOString(),
          new Date(bounds.end.getTime() - 86_400_000).toISOString(),
          {
            id: 'terminated',
            status: 'terminated',
            terminatedAt: now.toISOString(),
            terminatedBy: 'admin-1',
            terminationReason: 'Audit close'
          }
        )
      ]
    })

    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.status)).toEqual(['paused', 'terminated'])
    expect(rows.every((row) => row.occurrence && !row.assignment)).toBe(true)
  })
})
