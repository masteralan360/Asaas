import { initializeApp } from 'firebase/app'
import { getMessaging, getToken, onMessage, isSupported, Messaging } from 'firebase/messaging'

const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

let messaging: Messaging | null = null

export const initMessaging = async (): Promise<Messaging | null> => {
    if (messaging) return messaging

    // Only initialize if we have the minimal config required
    if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
        return null
    }

    try {
        const supported = await isSupported()
        if (!supported) {
            console.log('[Firebase] Push messaging is not supported in this browser.')
            return null
        }

        const app = initializeApp(firebaseConfig)
        messaging = getMessaging(app)

        return messaging
    } catch (e) {
        console.warn('[Firebase] Initialization error', e)
        return null
    }
}

export const requestFirebaseTokenSync = async (): Promise<string | null> => {
    const msg = await initMessaging()
    if (!msg) return null

    try {
        const permission = await Notification.requestPermission()
        if (permission === 'granted') {
            const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY?.trim()
            
            if (!vapidKey) {
                console.warn('[Firebase] No VAPID key provided (VITE_FIREBASE_VAPID_KEY)')
                return null
            }

            console.log(`[Firebase] Requesting token with VAPID Key: ${vapidKey.substring(0, 10)}... (Length: ${vapidKey.length})`)
            
            if (vapidKey.length < 80) {
                console.warn('[Firebase] VAPID key seems too short. A typical VAPID key is about 87 characters. Please check your Firebase Console.')
            }

            // Register the firebase service worker explicitly so we can pass config
            if ('serviceWorker' in navigator) {
                try {
                    const swUrl = `/firebase-messaging-sw.js?apiKey=${firebaseConfig.apiKey}&projectId=${firebaseConfig.projectId}&messagingSenderId=${firebaseConfig.messagingSenderId}&appId=${firebaseConfig.appId}`
                    const registration = await navigator.serviceWorker.register(swUrl)
                    
                    const currentToken = await getToken(msg, { 
                        vapidKey,
                        serviceWorkerRegistration: registration
                    })
                    return currentToken || null
                } catch (swErr) {
                    console.error('[Firebase] SW registration failed', swErr)
                }
            }

        } else {
            console.log('[Firebase] Notification permission not granted:', permission)
        }
    } catch (err) {
        console.error('[Firebase] Failed to get token', err)
    }
    return null
}

export const onForegroundMessage = (callback: (payload: any) => void) => {
    if (!messaging) return
    return onMessage(messaging, callback)
}
