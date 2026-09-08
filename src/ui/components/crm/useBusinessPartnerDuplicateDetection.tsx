import { useCallback, useEffect, useMemo, useState } from 'react'

import { convertArabicIndicToLatin } from '@/lib/utils'
import { useBusinessPartners, type BusinessPartner } from '@/local-db'

const DUPLICATE_CHECK_DELAY_MS = 250

export type BusinessPartnerDuplicateStatus = 'unchecked' | 'available' | 'duplicate'
export type BusinessPartnerDuplicateField = 'name' | 'phone'

type DuplicateCandidate = Pick<BusinessPartner, 'id' | 'partnerName' | 'phone'>

export interface BusinessPartnerDuplicateStatuses {
    name: BusinessPartnerDuplicateStatus
    phone: BusinessPartnerDuplicateStatus
}

export function shouldInterruptDuplicateSave(
    firstDuplicateField: BusinessPartnerDuplicateField | null,
    acknowledgedDuplicateStateKey: string | null,
    duplicateStateKey: string
): firstDuplicateField is BusinessPartnerDuplicateField {
    return Boolean(firstDuplicateField && acknowledgedDuplicateStateKey !== duplicateStateKey)
}

export function normalizeBusinessPartnerName(value: string): string {
    return value.trim().toLocaleLowerCase()
}

export function normalizeBusinessPartnerPhone(value: string): string {
    return convertArabicIndicToLatin(value).replace(/\D/g, '')
}

export function getBusinessPartnerDuplicateStatuses(
    partners: readonly DuplicateCandidate[],
    {
        name,
        phone,
        excludeBusinessPartnerId
    }: {
        name: string
        phone: string
        excludeBusinessPartnerId?: string
    }
): BusinessPartnerDuplicateStatuses {
    const normalizedName = normalizeBusinessPartnerName(name)
    const normalizedPhone = normalizeBusinessPartnerPhone(phone)
    const candidates = partners.filter((partner) => partner.id !== excludeBusinessPartnerId)

    return {
        name: normalizedName
            ? candidates.some((partner) => normalizeBusinessPartnerName(partner.partnerName) === normalizedName)
                ? 'duplicate'
                : 'available'
            : 'unchecked',
        phone: normalizedPhone
            ? candidates.some((partner) => normalizeBusinessPartnerPhone(partner.phone || '') === normalizedPhone)
                ? 'duplicate'
                : 'available'
            : 'unchecked'
    }
}

function getFirstDuplicateField(statuses: BusinessPartnerDuplicateStatuses): BusinessPartnerDuplicateField | null {
    return statuses.name === 'duplicate'
        ? 'name'
        : statuses.phone === 'duplicate'
            ? 'phone'
            : null
}

function getDuplicateStateKey(
    statuses: BusinessPartnerDuplicateStatuses,
    normalizedName: string,
    normalizedPhone: string
): string {
    return [
        statuses.name === 'duplicate' ? `name:${normalizedName}` : '',
        statuses.phone === 'duplicate' ? `phone:${normalizedPhone}` : ''
    ].filter(Boolean).join('|')
}

export function useBusinessPartnerDuplicateDetection({
    isOpen,
    workspaceId,
    name,
    phone,
    excludeBusinessPartnerId
}: {
    isOpen: boolean
    workspaceId?: string
    name: string
    phone: string
    excludeBusinessPartnerId?: string
}) {
    const normalizedName = normalizeBusinessPartnerName(name)
    const normalizedPhone = normalizeBusinessPartnerPhone(phone)
    const partners = useBusinessPartners(
        isOpen ? workspaceId : undefined,
        { includeAgentRoles: true, includeRealEstateRoles: true }
    )
    const [checkedValues, setCheckedValues] = useState({ name: '', phone: '' })

    useEffect(() => {
        if (!isOpen || !workspaceId) {
            setCheckedValues({ name: '', phone: '' })
            return
        }

        // Partner data is already live in the local cache. Debouncing the
        // comparison keeps status changes out of the user's typing path.
        const timeoutId = window.setTimeout(() => {
            setCheckedValues({ name: normalizedName, phone: normalizedPhone })
        }, DUPLICATE_CHECK_DELAY_MS)

        return () => window.clearTimeout(timeoutId)
    }, [isOpen, normalizedName, normalizedPhone, workspaceId])

    const detectedStatuses = useMemo(
        () => getBusinessPartnerDuplicateStatuses(partners, {
            name: normalizedName,
            phone: normalizedPhone,
            excludeBusinessPartnerId
        }),
        [excludeBusinessPartnerId, normalizedName, normalizedPhone, partners]
    )
    const statuses: BusinessPartnerDuplicateStatuses = {
        name: checkedValues.name === normalizedName ? detectedStatuses.name : 'unchecked',
        phone: checkedValues.phone === normalizedPhone ? detectedStatuses.phone : 'unchecked'
    }
    const checkNow = useCallback(() => {
        setCheckedValues({ name: normalizedName, phone: normalizedPhone })
    }, [normalizedName, normalizedPhone])

    return {
        statuses,
        firstDuplicateField: getFirstDuplicateField(detectedStatuses),
        duplicateStateKey: getDuplicateStateKey(detectedStatuses, normalizedName, normalizedPhone),
        checkNow
    }
}
