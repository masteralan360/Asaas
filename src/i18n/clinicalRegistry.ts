import type { ClinicalRegistryType, UserRole } from '@/local-db/models'

export type { ClinicalRegistryType }

export function canManageClinicalRegistryType(
    role: UserRole | undefined,
    hasClinicalAppointmentsFeature: boolean,
): boolean {
    return role === 'admin' && hasClinicalAppointmentsFeature
}
