import { describe, expect, it } from 'vitest'
import {
    affectsStock,
    canBePurchased,
    isInventoryItem,
    isService,
    requiresPhysicalStorage,
    SERVICES_VIRTUAL_STORAGE_ID
} from './catalogItem'

describe('catalog item domain', () => {
    it('treats physical products as inventory-backed catalog items', () => {
        const product = { isService: false }
        expect(isService(product)).toBe(false)
        expect(isInventoryItem(product)).toBe(true)
        expect(requiresPhysicalStorage(product)).toBe(true)
        expect(affectsStock(product)).toBe(true)
        expect(canBePurchased(product)).toBe(true)
    })

    it('keeps service lines out of inventory and procurement', () => {
        const service = { isService: true }
        expect(isService(service)).toBe(true)
        expect(isInventoryItem(service)).toBe(false)
        expect(requiresPhysicalStorage(service)).toBe(false)
        expect(affectsStock(service)).toBe(false)
        expect(canBePurchased(service)).toBe(false)
        expect(SERVICES_VIRTUAL_STORAGE_ID).toBe('__atlas_services__')
    })
})
