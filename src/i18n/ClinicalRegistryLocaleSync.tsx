import { useLayoutEffect } from 'react'
import { useAuth } from '@/auth'
import { useClinicalRegistryType } from '@/i18n/clinicalRegistry'
import { applyClinicalRegistryLocale } from '@/i18n/clinicalRegistryLocales'

export function ClinicalRegistryLocaleSync() {
    const { user } = useAuth()
    const registryType = useClinicalRegistryType(user?.workspaceId)

    useLayoutEffect(() => {
        applyClinicalRegistryLocale(registryType)
    }, [registryType])

    return null
}
