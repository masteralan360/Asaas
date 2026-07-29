import { describe, expect, it } from 'vitest'

import type { Agent, AgentExcludedCategory } from '@/local-db/models'
import {
    canSelectProductForExcludedCategories,
    filterSelectableProducts,
    getAgentExcludedCategoryIds
} from './agentProductSelection'

const baseAgent = {
    id: 'agent-1',
    workspaceId: 'workspace-1',
    businessPartnerId: 'partner-1',
    zone: 'North',
    agentType: 'field_agent' as const,
    linkedUserId: 'user-1',
    status: 'blocked' as const,
    createdAt: '2026-07-29T00:00:00.000Z',
    updatedAt: '2026-07-29T00:00:00.000Z',
    syncStatus: 'synced' as const,
    lastSyncedAt: null,
    version: 1,
    isDeleted: false
} satisfies Agent

const baseExclusion = {
    id: 'exclusion-1',
    workspaceId: 'workspace-1',
    agentId: 'agent-1',
    categoryId: 'restricted-category',
    createdAt: '2026-07-29T00:00:00.000Z',
    updatedAt: '2026-07-29T00:00:00.000Z',
    syncStatus: 'synced' as const,
    lastSyncedAt: null,
    version: 1,
    isDeleted: false
} satisfies AgentExcludedCategory

describe('agent product selection', () => {
    it('applies exclusions to a linked user regardless of agent status', () => {
        const excludedCategoryIds = getAgentExcludedCategoryIds([baseAgent], [baseExclusion], 'user-1')

        expect(excludedCategoryIds).toEqual(new Set(['restricted-category']))
        expect(canSelectProductForExcludedCategories({ categoryId: 'restricted-category' }, excludedCategoryIds)).toBe(false)
    })

    it('does not apply an agent exclusion to another user or to uncategorized products', () => {
        const excludedCategoryIds = getAgentExcludedCategoryIds([baseAgent], [baseExclusion], 'another-user')

        expect(excludedCategoryIds.size).toBe(0)
        expect(canSelectProductForExcludedCategories({ categoryId: null }, new Set(['restricted-category']))).toBe(true)
    })

    it('filters only products in explicitly excluded categories', () => {
        const products = [
            { id: 'restricted', categoryId: 'restricted-category' },
            { id: 'allowed', categoryId: 'allowed-category' },
            { id: 'uncategorized', categoryId: null }
        ]

        expect(filterSelectableProducts(products, new Set(['restricted-category']))).toEqual([
            { id: 'allowed', categoryId: 'allowed-category' },
            { id: 'uncategorized', categoryId: null }
        ])
    })
})
