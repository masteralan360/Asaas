// Utility for robust network status check
// Supplementing navigator.onLine with actual connectivity checks
import { isLocalWorkspaceMode } from '@/workspace/workspaceMode'

let isActuallyOnline = navigator.onLine;
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

function getWorkspaceIdForBusinessData(workspaceId?: string | null) {
    return workspaceId ?? activeBusinessWorkspaceId;
}

export function isBusinessDataOnline(workspaceId?: string | null): boolean {
    const resolvedWorkspaceId = getWorkspaceIdForBusinessData(workspaceId);
    if (resolvedWorkspaceId && isLocalWorkspaceMode(resolvedWorkspaceId)) {
        return false;
    }

    return isActuallyOnline && navigator.onLine;
}

// Get the current robust status
export function isOnline(workspaceId?: string | null): boolean {
    return isBusinessDataOnline(workspaceId);
}
