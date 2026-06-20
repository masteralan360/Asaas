import { useCallback, useSyncExternalStore } from 'react'
import type { UserRole } from '@/local-db/models'

export const DEFAULT_CLINICAL_REGISTRY_TYPE = 'medical' as const

export type ClinicalRegistryType = typeof DEFAULT_CLINICAL_REGISTRY_TYPE | 'beauty'

const STORAGE_KEY_PREFIX = 'atlas_clinical_registry_type'
const REGISTRY_TYPE_CHANGE_EVENT = 'atlas:clinical-registry-type-change'

interface RegistryTypeChangeDetail {
    workspaceId: string
}

export function getClinicalRegistryStorageKey(workspaceId: string): string {
    return `${STORAGE_KEY_PREFIX}:${workspaceId}`
}

export function getClinicalRegistryType(workspaceId?: string): ClinicalRegistryType {
    if (!workspaceId || typeof window === 'undefined') {
        return DEFAULT_CLINICAL_REGISTRY_TYPE
    }

    try {
        return window.localStorage.getItem(getClinicalRegistryStorageKey(workspaceId)) === 'beauty'
            ? 'beauty'
            : DEFAULT_CLINICAL_REGISTRY_TYPE
    } catch {
        return DEFAULT_CLINICAL_REGISTRY_TYPE
    }
}

export function setClinicalRegistryType(
    workspaceId: string,
    registryType: ClinicalRegistryType,
): void {
    try {
        window.localStorage.setItem(getClinicalRegistryStorageKey(workspaceId), registryType)
    } catch {
        return
    }

    window.dispatchEvent(new CustomEvent<RegistryTypeChangeDetail>(REGISTRY_TYPE_CHANGE_EVENT, {
        detail: { workspaceId },
    }))
}

function subscribeToClinicalRegistryType(workspaceId: string | undefined, onStoreChange: () => void) {
    if (!workspaceId || typeof window === 'undefined') {
        return () => undefined
    }

    const storageKey = getClinicalRegistryStorageKey(workspaceId)
    const handleRegistryTypeChange = (event: Event) => {
        const customEvent = event as CustomEvent<RegistryTypeChangeDetail>
        if (customEvent.detail?.workspaceId === workspaceId) {
            onStoreChange()
        }
    }
    const handleStorageChange = (event: StorageEvent) => {
        if (event.key === storageKey) {
            onStoreChange()
        }
    }

    window.addEventListener(REGISTRY_TYPE_CHANGE_EVENT, handleRegistryTypeChange)
    window.addEventListener('storage', handleStorageChange)

    return () => {
        window.removeEventListener(REGISTRY_TYPE_CHANGE_EVENT, handleRegistryTypeChange)
        window.removeEventListener('storage', handleStorageChange)
    }
}

export function useClinicalRegistryType(workspaceId?: string): ClinicalRegistryType {
    const subscribe = useCallback(
        (onStoreChange: () => void) => subscribeToClinicalRegistryType(workspaceId, onStoreChange),
        [workspaceId],
    )
    const getSnapshot = useCallback(() => getClinicalRegistryType(workspaceId), [workspaceId])

    return useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT_CLINICAL_REGISTRY_TYPE)
}

export function canManageClinicalRegistryType(
    role: UserRole | undefined,
    hasClinicalAppointmentsFeature: boolean,
): boolean {
    return role === 'admin' && hasClinicalAppointmentsFeature
}
