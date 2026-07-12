import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
    getOfflineLeaseStatus,
    markInternetReachable,
    markSupabaseReachable,
    offlineLeaseInternals
} from './offlineLease'

const userId = 'user-1'
const workspaceId = 'workspace-1'
const baseTime = new Date('2026-01-01T00:00:00.000Z').getTime()

describe('offline lease', () => {
    beforeEach(() => {
        offlineLeaseInternals.memoryStorage.clear()
        vi.useFakeTimers()
        vi.setSystemTime(baseTime)
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('does not require a lease for local or demo modes', () => {
        expect(getOfflineLeaseStatus(userId, workspaceId, 'local')).toMatchObject({
            required: false,
            blocked: false
        })
        expect(getOfflineLeaseStatus(userId, workspaceId, 'demo')).toMatchObject({
            required: false,
            blocked: false
        })
    })

    it('blocks cloud and hybrid modes when no lease exists', () => {
        expect(getOfflineLeaseStatus(userId, workspaceId, 'cloud')).toMatchObject({
            required: true,
            blocked: true,
            reason: 'missing'
        })
        expect(getOfflineLeaseStatus(userId, workspaceId, 'hybrid')).toMatchObject({
            required: true,
            blocked: true,
            reason: 'missing'
        })
    })

    it('allows cloud mode until 10 days after the last confirmed Supabase contact', () => {
        markSupabaseReachable({
            userId,
            workspaceId,
            dataMode: 'cloud',
            serverNowMs: baseTime,
            source: 'test'
        })

        vi.setSystemTime(baseTime + offlineLeaseInternals.TEN_DAYS_MS - 1)
        expect(getOfflineLeaseStatus(userId, workspaceId, 'cloud')).toMatchObject({
            required: true,
            blocked: false
        })

        vi.setSystemTime(baseTime + offlineLeaseInternals.TEN_DAYS_MS + 1)
        expect(getOfflineLeaseStatus(userId, workspaceId, 'cloud')).toMatchObject({
            required: true,
            blocked: true,
            reason: 'expired'
        })
    })

    it('blocks when the local clock moves backward after an offline check', () => {
        markSupabaseReachable({
            userId,
            workspaceId,
            dataMode: 'hybrid',
            serverNowMs: baseTime,
            source: 'test'
        })

        vi.setSystemTime(baseTime + 60 * 60 * 1000)
        expect(getOfflineLeaseStatus(userId, workspaceId, 'hybrid').blocked).toBe(false)

        vi.setSystemTime(baseTime + 60 * 1000)
        expect(getOfflineLeaseStatus(userId, workspaceId, 'hybrid')).toMatchObject({
            required: true,
            blocked: true,
            reason: 'clock-rollback'
        })
    })

    it('renews a blocked lease from the browser online signal', () => {
        markSupabaseReachable({
            userId,
            workspaceId,
            dataMode: 'hybrid',
            serverNowMs: baseTime,
            source: 'test'
        })

        vi.setSystemTime(baseTime + offlineLeaseInternals.TEN_DAYS_MS + 1)
        expect(getOfflineLeaseStatus(userId, workspaceId, 'hybrid').blocked).toBe(true)

        markInternetReachable({
            userId,
            workspaceId,
            dataMode: 'hybrid',
            source: 'browser-online'
        })

        expect(getOfflineLeaseStatus(userId, workspaceId, 'hybrid')).toMatchObject({
            required: true,
            blocked: false
        })
    })
})
