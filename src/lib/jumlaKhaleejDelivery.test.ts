import { describe, expect, it } from 'vitest'

import {
    createJumlaKhaleejDeliveryMetadata,
    getJumlaKhaleejDeliveryCity,
    jumlaKhaleejDeliveryCities
} from '../../supabase/functions/_shared/jumlaKhaleejDelivery'

describe('Jumla Khaleej delivery pricing', () => {
    it('uses the mandated city order and fixed IQD fees', () => {
        expect(jumlaKhaleejDeliveryCities.map((city) => [city.key, city.fee])).toEqual([
            ['kirkuk', 3000],
            ['baghdad', 5000],
            ['erbil', 5000],
            ['duhok', 5000],
            ['sulaymaniyah', 5000],
            ['halabja', 5000],
            ['al-anbar', 6000],
            ['babil', 6000],
            ['basra', 6000],
            ['dhi-qar', 6000],
            ['diyala', 6000],
            ['karbala', 6000],
            ['maysan', 6000],
            ['muthanna', 6000],
            ['najaf', 6000],
            ['nineveh', 6000],
            ['al-qadisiyyah', 6000],
            ['salah-al-din', 6000],
            ['wasit', 6000]
        ])
    })

    it('returns localized city names and delivery-only metadata', () => {
        const erbil = getJumlaKhaleejDeliveryCity('erbil')
        expect(erbil?.names).toEqual({ en: 'Erbil', ar: 'أربيل', ku: 'هەولێر' })
        expect(getJumlaKhaleejDeliveryCity('najaf')?.names).toEqual({ en: 'Najaf', ar: 'نجف', ku: 'نەجەف' })
        expect(createJumlaKhaleejDeliveryMetadata(erbil!)).toEqual({
            metadata_type: 'jumla_khaleej_delivery_fee',
            delivery_fee: 5000,
            delivery_currency: 'iqd',
            delivery_city_key: 'erbil'
        })
        expect(getJumlaKhaleejDeliveryCity('not-an-iraqi-city')).toBeNull()
    })
})
