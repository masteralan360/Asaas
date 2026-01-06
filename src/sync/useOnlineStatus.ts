import { useState, useEffect, useCallback } from 'react'

export type OnlineStatus = 'online' | 'offline'

export function useOnlineStatus() {
    const [status, setStatus] = useState<OnlineStatus>(
        navigator.onLine ? 'online' : 'offline'
    )

    useEffect(() => {
        const handleOnline = () => setStatus('online')
        const handleOffline = () => setStatus('offline')

        window.addEventListener('online', handleOnline)
        window.addEventListener('offline', handleOffline)

        return () => {
            window.removeEventListener('online', handleOnline)
            window.removeEventListener('offline', handleOffline)
        }
    }, [])

    const checkConnection = useCallback(async (): Promise<boolean> => {
        try {
            // Try to fetch a small resource to verify actual connectivity
            const response = await fetch('https://www.google.com/favicon.ico', {
                mode: 'no-cors',
                cache: 'no-store'
            })
            return response.type === 'opaque' || response.ok
        } catch {
            return false
        }
    }, [])

    return {
        status,
        isOnline: status === 'online',
        isOffline: status === 'offline',
        checkConnection
    }
}
