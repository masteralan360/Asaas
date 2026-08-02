import { describe, expect, it, vi } from 'vitest'

vi.mock('./generic/GenericStorefrontTemplate', () => ({
    genericStorefrontTemplate: {
        id: 'generic',
        label: 'Generic storefront',
        ShopPage: () => null,
        ContactPage: () => null
    }
}))

vi.mock('./barbados/BarbadosStorefrontTemplate', () => ({
    barbadosStorefrontTemplate: {
        id: 'barbados',
        label: 'Barbados menu',
        ShopPage: () => null,
        ContactPage: () => null
    }
}))

import {
    DEFAULT_STOREFRONT_TEMPLATE_ID,
    getStorefrontTemplateForSlug,
    storefrontTemplates
} from './registry'

describe('getStorefrontTemplateForSlug', () => {
    it('uses the generic template for an unassigned slug', () => {
        const resolved = getStorefrontTemplateForSlug('new-store')

        expect(resolved.template).toBe(storefrontTemplates[DEFAULT_STOREFRONT_TEMPLATE_ID])
        expect(resolved.options).toEqual({})
        expect(resolved.rules).toEqual({})
    })

    it('normalizes an unassigned slug before falling back', () => {
        const resolved = getStorefrontTemplateForSlug('  NEW-STORE  ')

        expect(resolved.template.id).toBe(DEFAULT_STOREFRONT_TEMPLATE_ID)
    })

    it('selects the Barbados menu template for its hard-coded storefront slug', () => {
        const resolved = getStorefrontTemplateForSlug('  BARBADOS ')

        expect(resolved.template.id).toBe('barbados')
        expect(resolved.options).toEqual({})
        expect(resolved.rules).toEqual({})
    })

    it('resolves hard-coded storefront rules for a slug', () => {
        const resolved = getStorefrontTemplateForSlug('K1-PAINT')

        expect(resolved.template.id).toBe('generic')
        expect(resolved.rules).toEqual({ hidePrice: true, hideAddToCart: true })
    })
})
