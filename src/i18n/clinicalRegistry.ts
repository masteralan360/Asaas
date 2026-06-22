import type { ClinicalRegistryType, UserRole } from '@/local-db/models'

export type { ClinicalRegistryType }

export function supportsClinicalPatientsAndServicePresets(
    registryType: ClinicalRegistryType,
): boolean {
    return registryType !== 'beauty2'
}

export function canManageClinicalRegistryType(
    role: UserRole | undefined,
    hasClinicalAppointmentsFeature: boolean,
    registryType: ClinicalRegistryType = 'medical',
): boolean {
    return role === 'admin'
        && hasClinicalAppointmentsFeature
        && registryType !== 'beauty2'
}
