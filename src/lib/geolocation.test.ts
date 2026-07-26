import { describe, expect, it, vi } from 'vitest'

import { requestCurrentLocation } from './geolocation'

const position = {
    coords: {
        latitude: 33.3152,
        longitude: 44.3661,
        accuracy: 25,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null
    },
    timestamp: Date.now()
} as GeolocationPosition

describe('requestCurrentLocation', () => {
    it('retries with a coarse location after a precise iOS-style timeout', async () => {
        const geolocation = {
            getCurrentPosition: vi
                .fn()
                .mockImplementationOnce((_success, failure) => failure({ code: 3 }))
                .mockImplementationOnce((success) => success(position))
        }

        await expect(requestCurrentLocation(geolocation)).resolves.toBe(position)
        expect(geolocation.getCurrentPosition).toHaveBeenCalledTimes(2)
        expect(geolocation.getCurrentPosition).toHaveBeenNthCalledWith(
            1,
            expect.any(Function),
            expect.any(Function),
            { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 }
        )
        expect(geolocation.getCurrentPosition).toHaveBeenNthCalledWith(
            2,
            expect.any(Function),
            expect.any(Function),
            { enableHighAccuracy: false, timeout: 20_000, maximumAge: 60_000 }
        )
    })

    it('does not retry when the user denied permission', async () => {
        const denied = { code: 1, message: 'Permission denied' }
        const geolocation = {
            getCurrentPosition: vi.fn((_success, failure) => failure(denied))
        }

        await expect(requestCurrentLocation(geolocation)).rejects.toBe(denied)
        expect(geolocation.getCurrentPosition).toHaveBeenCalledTimes(1)
    })
})
