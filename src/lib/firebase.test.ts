import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    getMessaging: vi.fn(() => ({ app: 'messaging' })),
    getToken: vi.fn(async () => 'firebase-token'),
    initializeApp: vi.fn(() => ({ app: 'firebase' })),
    isSupported: vi.fn(async () => true),
    onMessage: vi.fn(),
    register: vi.fn(async () => ({ scope: 'firebase-registration' }))
}))

vi.mock('firebase/app', () => ({
    initializeApp: mocks.initializeApp
}))

vi.mock('firebase/messaging', () => ({
    getMessaging: mocks.getMessaging,
    getToken: mocks.getToken,
    isSupported: mocks.isSupported,
    onMessage: mocks.onMessage
}))

describe('Firebase service-worker registration', () => {
    beforeEach(() => {
        vi.resetModules()
        vi.clearAllMocks()
        vi.stubEnv('VITE_FIREBASE_API_KEY', 'public-api-key')
        vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'project-id')
        vi.stubEnv('VITE_FIREBASE_MESSAGING_SENDER_ID', 'sender-id')
        vi.stubEnv('VITE_FIREBASE_APP_ID', 'app-id')
        vi.stubEnv('VITE_FIREBASE_VAPID_KEY', 'A'.repeat(87))

        Object.defineProperty(globalThis, 'Notification', {
            configurable: true,
            value: { requestPermission: vi.fn(async () => 'granted') }
        })
        Object.defineProperty(globalThis, 'navigator', {
            configurable: true,
            value: { serviceWorker: { register: mocks.register } }
        })
    })

    it('keeps Firebase messaging outside the Atlas navigation scope', async () => {
        const { requestFirebaseTokenSync } = await import('./firebase')

        await expect(requestFirebaseTokenSync()).resolves.toBe('firebase-token')
        expect(mocks.register).toHaveBeenCalledWith(
            expect.stringContaining('/firebase-messaging-sw.js?'),
            { scope: '/firebase-cloud-messaging-push-scope/' }
        )
        expect(mocks.getToken).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                serviceWorkerRegistration: expect.objectContaining({
                    scope: 'firebase-registration'
                })
            })
        )
    })
})
