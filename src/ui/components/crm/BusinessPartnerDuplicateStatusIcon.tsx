import { useEffect, useState } from 'react'
import { CheckCircle2, ShieldAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type {
    BusinessPartnerDuplicateField,
    BusinessPartnerDuplicateStatus
} from './useBusinessPartnerDuplicateDetection'

const DUPLICATE_DESCRIPTION_DELAY_MS = 1_500

export function BusinessPartnerDuplicateStatusIcon({
    field,
    status
}: {
    field: BusinessPartnerDuplicateField
    status: BusinessPartnerDuplicateStatus
}) {
    const { t } = useTranslation()

    if (status === 'unchecked') {
        return null
    }

    const isDuplicate = status === 'duplicate'
    const label = isDuplicate
        ? t(field === 'name'
            ? 'businessPartners.duplicateDetection.nameDuplicate'
            : 'businessPartners.duplicateDetection.phoneDuplicate')
        : t(field === 'name'
            ? 'businessPartners.duplicateDetection.nameAvailable'
            : 'businessPartners.duplicateDetection.phoneAvailable')
    const Icon = isDuplicate ? ShieldAlert : CheckCircle2

    return (
        <span
            className={`pointer-events-none absolute inset-y-0 end-3 flex items-center ${isDuplicate ? 'text-amber-500' : 'text-emerald-500'}`}
            role="status"
            title={label}
        >
            <Icon aria-hidden="true" className="h-5 w-5" />
            <span className="sr-only">{label}</span>
        </span>
    )
}

export function BusinessPartnerDuplicateStatusDescription({
    field,
    status
}: {
    field: BusinessPartnerDuplicateField
    status: BusinessPartnerDuplicateStatus
}) {
    const { t } = useTranslation()
    const [isVisible, setIsVisible] = useState(false)

    useEffect(() => {
        if (status !== 'duplicate') {
            setIsVisible(false)
            return
        }

        const timeoutId = window.setTimeout(() => setIsVisible(true), DUPLICATE_DESCRIPTION_DELAY_MS)
        return () => window.clearTimeout(timeoutId)
    }, [status])

    if (!isVisible || status !== 'duplicate') {
        return null
    }

    return (
        <p className="text-xs text-amber-600 dark:text-amber-400" role="status">
            {t(field === 'name'
                ? 'businessPartners.duplicateDetection.nameDuplicateDescription'
                : 'businessPartners.duplicateDetection.phoneDuplicateDescription')}
        </p>
    )
}
