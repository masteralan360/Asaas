// Application connectivity status. The ConnectionManager updates this only after
// a user confirms offline mode, or when the browser reports connectivity restored.
import { isLocalWorkspaceMode } from '@/workspace/workspaceMode'

let isActuallyOnline = true;
let activeBusinessWorkspaceId: string | null = null;
let activeBusinessUserId: string | null = null;

// Update the global state
export function setNetworkStatus(online: boolean) {
    isActuallyOnline = online;
}

export function setActiveBusinessWorkspace(workspaceId: string | null | undefined) {
    activeBusinessWorkspaceId = workspaceId ?? null;
}

export function setActiveBusinessUser(userId: string | null | undefined) {
    activeBusinessUserId = userId ?? null;
}

export function getActiveBusinessUserId() {
    return activeBusinessUserId;
}

export function getActiveBusinessWorkspaceId() {
    return activeBusinessWorkspaceId;
}

function getWorkspaceIdForBusinessData(workspaceId?: string | null) {
    return workspaceId ?? activeBusinessWorkspaceId;
}

export function isBusinessDataOnline(workspaceId?: string | null): boolean {
    const resolvedWorkspaceId = getWorkspaceIdForBusinessData(workspaceId);
    if (resolvedWorkspaceId && isLocalWorkspaceMode(resolvedWorkspaceId)) {
        return false;
    }

    return isActuallyOnline;
}

// Get the current robust status
export function isOnline(workspaceId?: string | null): boolean {
    return isBusinessDataOnline(workspaceId);
}
