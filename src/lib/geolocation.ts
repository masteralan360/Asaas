const HIGH_ACCURACY_OPTIONS: PositionOptions = {
    enableHighAccuracy: true,
    timeout: 15_000,
    maximumAge: 0
}

// iOS can take much longer to acquire a fresh high-accuracy fix, even when the
// user has already granted location permission. A recent coarse position is a
// better fallback than rejecting an otherwise usable location.
const FALLBACK_OPTIONS: PositionOptions = {
    enableHighAccuracy: false,
    timeout: 20_000,
    maximumAge: 60_000
}

type GeolocationApi = Pick<Geolocation, 'getCurrentPosition'>

export function isGeolocationSupported(): boolean {
    return typeof navigator !== 'undefined'
        && typeof navigator.geolocation?.getCurrentPosition === 'function'
}

export function isGeolocationPositionError(error: unknown): error is GeolocationPositionError {
    return typeof error === 'object'
        && error !== null
        && 'code' in error
        && typeof error.code === 'number'
}

export function isRecoverableGeolocationError(error: unknown): boolean {
    if (!isGeolocationPositionError(error)) return false

    return error.code === 2 || error.code === 3
}

function getCurrentPosition(
    geolocation: GeolocationApi,
    options: PositionOptions
): Promise<GeolocationPosition> {
    return new Promise((resolve, reject) => {
        geolocation.getCurrentPosition(resolve, reject, options)
    })
}

/**
 * Requests a precise location first, then falls back to a usable coarse or
 * cached fix when a device cannot quickly acquire a fresh GPS position.
 */
export async function requestCurrentLocation(
    geolocation: GeolocationApi | undefined = typeof navigator === 'undefined'
        ? undefined
        : navigator.geolocation
): Promise<GeolocationPosition> {
    if (!geolocation || typeof geolocation.getCurrentPosition !== 'function') {
        throw new Error('Geolocation is not supported on this device.')
    }

    try {
        return await getCurrentPosition(geolocation, HIGH_ACCURACY_OPTIONS)
    } catch (error) {
        if (!isRecoverableGeolocationError(error)) {
            throw error
        }

        return getCurrentPosition(geolocation, FALLBACK_OPTIONS)
    }
}

export function formatCoordinates(latitude: number, longitude: number): string {
    const lat = Number.isFinite(latitude) ? latitude.toFixed(14) : String(latitude)
    const lon = Number.isFinite(longitude) ? longitude.toFixed(14) : String(longitude)
    return `${lat}, ${lon}`
}
