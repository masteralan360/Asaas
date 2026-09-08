import 'fake-indexeddb/auto'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const supabaseMocks = vi.hoisted(() => {
    const eq = vi.fn()
    const remove = vi.fn(() => ({ eq }))
    const from = vi.fn(() => ({ delete: remove }))
    return { eq, remove, from }
})

vi.mock('@/auth/supabase', () => ({
    supabase: { from: supabaseMocks.from }
}))

vi.mock('@/lib/network', () => ({
    isOnline: () => true
}))

vi.mock('./offlineMutations', () => ({
    addToOfflineMutations: vi.fn()
}))

import { db } from './database'
import type { RestaurantTableSettings } from './models'
import { saveRestaurantTableSettings } from './restaurantTables'

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000801'

function tableSettings(id: string): RestaurantTableSettings {
    const timestamp = '2026-09-08T00:00:00.000Z'
    return {
        id,
        workspaceId: WORKSPACE_ID,
        enabled: true,
        liveSyncEnabled: false,
        tableCount: 20,
        vipTableNumbers: [],
        createdAt: timestamp,
        updatedAt: timestamp,
        version: 1,
        isDeleted: false,
        syncStatus: 'synced',
        lastSyncedAt: timestamp,
    }
}

describe('Restaurant Table View settings persistence', () => {
    beforeEach(async () => {
        await db.delete()
        await db.open()
        supabaseMocks.from.mockClear()
        supabaseMocks.remove.mockClear()
        supabaseMocks.eq.mockReset()
        supabaseMocks.eq.mockResolvedValue({ data: null, error: null })
    })

    it('disables a remotely configured workspace even when its local cache is empty', async () => {
        await saveRestaurantTableSettings({
            enabled: false,
            liveSyncEnabled: false,
            tableCount: 20,
            vipTableNumbers: [],
        }, WORKSPACE_ID)

        expect(supabaseMocks.from).toHaveBeenCalledWith('restaurant_table_settings')
        expect(supabaseMocks.remove).toHaveBeenCalledOnce()
        expect(supabaseMocks.eq).toHaveBeenCalledWith('workspace_id', WORKSPACE_ID)
    })

    it('uses the workspace key, not a stale cached id, when disabling', async () => {
        await db.restaurant_table_settings.put(tableSettings('00000000-0000-4000-8000-000000000802'))

        await saveRestaurantTableSettings({
            enabled: false,
            liveSyncEnabled: false,
            tableCount: 20,
            vipTableNumbers: [],
        }, WORKSPACE_ID)

        expect(supabaseMocks.eq).toHaveBeenCalledWith('workspace_id', WORKSPACE_ID)
        expect(await db.restaurant_table_settings.where('workspaceId').equals(WORKSPACE_ID).first()).toBeUndefined()
    })
})

afterAll(async () => {
    await db.delete()
})
