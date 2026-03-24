import type {
    TravelAgencyPaymentMethod,
    TravelAgencyReceiver,
    TravelAgencySale,
    TravelAgencyTravelMethod
} from '@/local-db/models'

export const travelMethodOptions: Array<{ value: TravelAgencyTravelMethod; label: string }> = [
    { value: 'bus', label: 'Bus' },
    { value: 'plane', label: 'Plane' },
    { value: 'train', label: 'Train' },
    { value: 'car', label: 'Car' },
    { value: 'ship', label: 'Ship' },
    { value: 'other', label: 'Other' }
]

export const travelPaymentMethodOptions: Array<{ value: TravelAgencyPaymentMethod; label: string }> = [
    { value: 'cash', label: 'Cash' },
    { value: 'fib', label: 'FIB' },
    { value: 'qicard', label: 'QiCard' },
    { value: 'hawala', label: 'Money Transfer (Hawala)' },
    { value: 'fastpay', label: 'FastPay' }
]

export const travelReceiverOptions: Array<{ value: TravelAgencyReceiver; label: string }> = [
    { value: 'office', label: 'Received in Office' },
    { value: 'erbil', label: 'Received By Erbil' }
]

export function getTravelMethodLabel(method?: TravelAgencyTravelMethod | null) {
    return travelMethodOptions.find((option) => option.value === method)?.label || 'Not set'
}

export function getTravelPaymentMethodLabel(method: TravelAgencyPaymentMethod) {
    return travelPaymentMethodOptions.find((option) => option.value === method)?.label || method
}

export function getTravelReceiverLabel(receiver: TravelAgencyReceiver) {
    return travelReceiverOptions.find((option) => option.value === receiver)?.label || receiver
}

export function getTravelSaleRevenue(sale: TravelAgencySale) {
    return sale.groupRevenue + sale.tourists.reduce((sum, tourist) => sum + tourist.revenue, 0)
}

export function getTravelSaleNet(sale: TravelAgencySale) {
    return getTravelSaleRevenue(sale) - sale.supplierCost
}
