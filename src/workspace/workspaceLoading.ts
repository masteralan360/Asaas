interface WorkspaceResolutionState {
    isLoading: boolean
    isAuthenticated: boolean
    workspaceId: string | null | undefined
    resolvingWorkspaceId: string | null
}

export function isWorkspaceResolutionPending({
    isLoading,
    isAuthenticated,
    workspaceId,
    resolvingWorkspaceId
}: WorkspaceResolutionState) {
    return isLoading || Boolean(
        isAuthenticated
        && workspaceId
        && resolvingWorkspaceId !== workspaceId
    )
}
