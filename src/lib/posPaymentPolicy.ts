export type PosPaymentType = 'cash' | 'digital' | 'loan' | 'order'

interface PosPaymentPolicyInput {
    isActivitiesStorage: boolean
    isServicesStorage: boolean
    quickOrderEnabled: boolean
}

/**
 * Activities are recorded through their dedicated transaction flow, while
 * services use the normal POS sale flow and can therefore be financed just
 * like inventory products. Quick orders remain inventory-order only.
 */
export function isPosPaymentTypeAllowed(
    paymentType: PosPaymentType,
    { isActivitiesStorage, isServicesStorage, quickOrderEnabled }: PosPaymentPolicyInput
): boolean {
    if (paymentType === 'cash' || paymentType === 'digital') return true
    if (paymentType === 'loan') return !isActivitiesStorage
    if (paymentType === 'order') {
        return quickOrderEnabled && !isActivitiesStorage && !isServicesStorage
    }

    return false
}
