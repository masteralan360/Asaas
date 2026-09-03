type LinkedProductCommissionAgent = {
    linkedUserId?: string | null
    agentType: string
    status: string
    isDeleted: boolean
}

/** Resolves the active field agent eligible for creator product attribution. */
export function findLinkedProductCommissionAgent<T extends LinkedProductCommissionAgent>(
    agents: readonly T[],
    userId?: string | null
) {
    if (!userId) return null
    return agents.find((agent) => (
        !agent.isDeleted
        && agent.status === 'active'
        && agent.agentType === 'field_agent'
        && agent.linkedUserId === userId
    )) ?? null
}

/** Resolves an automatic product beneficiary only for an order they created. */
export function findOwnedOrderCreatorProductCommissionAgent<T extends LinkedProductCommissionAgent>(
    agents: readonly T[],
    userId?: string | null,
    orderCreatedBy?: string | null
) {
    if (!userId || orderCreatedBy !== userId) return null
    return findLinkedProductCommissionAgent(agents, userId)
}
