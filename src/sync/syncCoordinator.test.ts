import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    fullSync: vi.fn()
}))

vi.mock('./syncEngine', () => ({
    fullSync: mocks.fullSync
}))

import { runManagedFullSync } from './syncCoordinator'

const successfulResult = {
    success: true,
    pushed: 0,
    pulled: 0,
    errors: []
}

function deferred<T>() {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((done) => {
        resolve = done
    })
    return { promise, resolve }
}

describe('runManagedFullSync', () => {
    beforeEach(() => {
        mocks.fullSync.mockReset()
        mocks.fullSync.mockResolvedValue(successfulResult)
    })

    it('shares an in-flight full pull for the same workspace', async () => {
        const active = deferred<typeof successfulResult>()
        mocks.fullSync.mockReturnValueOnce(active.promise)

        const first = runManagedFullSync('user-1', 'workspace-1', null)
        const second = runManagedFullSync('user-1', 'workspace-1', null)

        expect(first).toBe(second)
        expect(mocks.fullSync).toHaveBeenCalledTimes(1)
        active.resolve(successfulResult)
        await first
    })

    it('queues a required full pull behind an incremental sync', async () => {
        const incremental = deferred<typeof successfulResult>()
        mocks.fullSync
            .mockReturnValueOnce(incremental.promise)
            .mockResolvedValueOnce({ ...successfulResult, pulled: 12 })

        const first = runManagedFullSync('user-1', 'workspace-1', '2026-09-01T00:00:00.000Z')
        const full = runManagedFullSync('user-1', 'workspace-1', null)

        expect(mocks.fullSync).toHaveBeenCalledTimes(1)
        incremental.resolve(successfulResult)
        await first
        await expect(full).resolves.toMatchObject({ pulled: 12 })
        expect(mocks.fullSync).toHaveBeenNthCalledWith(2, 'user-1', 'workspace-1', null)
    })

    it('deduplicates queued full pulls', async () => {
        const incremental = deferred<typeof successfulResult>()
        mocks.fullSync
            .mockReturnValueOnce(incremental.promise)
            .mockResolvedValueOnce(successfulResult)

        runManagedFullSync('user-1', 'workspace-1', '2026-09-01T00:00:00.000Z')
        const firstFull = runManagedFullSync('user-1', 'workspace-1', null)
        const secondFull = runManagedFullSync('user-1', 'workspace-1', null)

        expect(firstFull).toBe(secondFull)
        incremental.resolve(successfulResult)
        await firstFull
        expect(mocks.fullSync).toHaveBeenCalledTimes(2)
    })
})
