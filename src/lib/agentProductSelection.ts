import type { Agent, AgentExcludedCategory, Product } from '@/local-db/models'

type CategorizedProduct = Pick<Product, 'categoryId'>

/**
 * Returns the effective exclusions for a user linked to an agent. Agent status
 * intentionally does not affect access: the link itself is the restriction.
 */
export function getAgentExcludedCategoryIds(
    agents: readonly Agent[],
    exclusions: readonly AgentExcludedCategory[],
    userId: string | null | undefined
): Set<string> {
    if (!userId) {
        return new Set()
    }

    const agentIds = new Set(
        agents
            .filter((agent) => !agent.isDeleted && agent.linkedUserId === userId)
            .map((agent) => agent.id)
    )

    if (agentIds.size === 0) {
        return new Set()
    }

    return new Set(
        exclusions
            .filter((exclusion) => !exclusion.isDeleted && agentIds.has(exclusion.agentId))
            .map((exclusion) => exclusion.categoryId)
    )
}

export function canSelectProductForExcludedCategories(
    product: CategorizedProduct,
    excludedCategoryIds: ReadonlySet<string>
): boolean {
    return !product.categoryId || !excludedCategoryIds.has(product.categoryId)
}

export function filterSelectableProducts<T extends CategorizedProduct>(
    products: readonly T[],
    excludedCategoryIds: ReadonlySet<string>
): T[] {
    return products.filter((product) => canSelectProductForExcludedCategories(product, excludedCategoryIds))
}
