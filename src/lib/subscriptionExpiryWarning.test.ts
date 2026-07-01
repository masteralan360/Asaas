import { describe, expect, it } from 'vitest'
import {
    getSubscriptionExpiryWarning,
    getSubscriptionExpiryWarningSeenKey,
    SUBSCRIPTION_EXPIRY_WARNING_DAYS
} from './subscriptionExpiryWarning'

describe('subscription expiry warning', () => {
    const now = new Date('2026-07-01T12:00:00.000Z')

    it('returns a warning inside the five day window', () => {
        const warning = getSubscriptionExpiryWarning('2026-07-06T12:00:00.000Z', now)

        expect(warning).toMatchObject({
            expiresAtIso: '2026-07-06T12:00:00.000Z',
            daysRemaining: SUBSCRIPTION_EXPIRY_WARNING_DAYS
        })
    })

    it('ignores future expiries outside the warning window', () => {
        expect(getSubscriptionExpiryWarning('2026-07-06T12:00:01.000Z', now)).toBeNull()
    })

    it('ignores expired subscriptions', () => {
        expect(getSubscriptionExpiryWarning('2026-07-01T11:59:59.000Z', now)).toBeNull()
    })

    it('scopes local seen state by workspace and expiry timestamp', () => {
        expect(getSubscriptionExpiryWarningSeenKey('workspace-1', '2026-07-06T12:00:00.000Z'))
            .toBe('atlas_subscription_expiry_warning_seen:workspace-1:2026-07-06T12:00:00.000Z')
    })
})
