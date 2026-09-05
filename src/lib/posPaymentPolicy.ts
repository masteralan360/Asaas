export type PosPaymentType = 'cash' | 'digital' | 'loan' | 'order'

interface PosPaymentPolicyInput {
    isActivitiesStorage: boolean
    isServicesStorage: boolean
    quickOrderEnabled: boolean
}

/**
 * Activities are recorded through their dedicated transaction flow, while
 * services use the normal POS sale flow and can therefore be financed just
 * like inventory products. Services also use the existing Sales Order flow
 * for Quick Orders; their order lines are intentionally non-inventory.
 */
export function isPosPaymentTypeAllowed(
    paymentType: PosPaymentType,
    { isActivitiesStorage, quickOrderEnabled }: PosPaymentPolicyInput
): boolean {
    if (paymentType === 'cash' || paymentType === 'digital') return true
    if (paymentType === 'loan') return !isActivitiesStorage
    if (paymentType === 'order') {
        return quickOrderEnabled && !isActivitiesStorage
    }

    return false
}
