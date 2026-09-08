import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'

import {
    DEFAULT_RESTAURANT_TABLE_ACTION_VISIBILITY,
    readRestaurantTableActionVisibility,
    saveRestaurantTableActionVisibility,
    shouldHideRestaurantTableAction,
} from './restaurantTableActionVisibility'

const WORKSPACE_ID = 'restaurant-visibility-test'

function installLocalStorage() {
    const values = new Map<string, string>()
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: {
            getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => values.set(key, value),
            removeItem: (key: string) => values.delete(key),
        }
    })
}

describe('Restaurant Table View action visibility', () => {
    beforeEach(() => {
        installLocalStorage()
    })

    it('defaults every restriction to off when no local setting exists', () => {
        expect(readRestaurantTableActionVisibility(WORKSPACE_ID)).toEqual(DEFAULT_RESTAURANT_TABLE_ACTION_VISIBILITY)
    })

    it('persists the per-workspace setting locally', async () => {
        await saveRestaurantTableActionVisibility(WORKSPACE_ID, {
            hideItemDelete: true,
            hideCloseTicket: false,
            hideClearAll: true,
        })

        expect(readRestaurantTableActionVisibility(WORKSPACE_ID)).toEqual({
            hideItemDelete: true,
            hideCloseTicket: false,
            hideClearAll: true,
        })
    })

    it('only hides a configured action from non-admin Restaurant Table View users', () => {
        const settings = {
            hideItemDelete: true,
            hideCloseTicket: true,
            hideClearAll: true,
        }

        expect(shouldHideRestaurantTableAction({ restaurantMode: true, isAdmin: false, settings, action: 'hideItemDelete' })).toBe(true)
        expect(shouldHideRestaurantTableAction({ restaurantMode: true, isAdmin: true, settings, action: 'hideCloseTicket' })).toBe(false)
        expect(shouldHideRestaurantTableAction({ restaurantMode: false, isAdmin: false, settings, action: 'hideClearAll' })).toBe(false)
    })
})
