import { useState, useEffect } from 'react'
import { toast } from '@/ui/components/use-toast'
import { setNetworkStatus } from '@/lib/network'

export function useNetworkStatus() {
    const [isOnline, setIsOnline] = useState(navigator.onLine)
    const [wasOffline, setWasOffline] = useState(false)

    useEffect(() => {
        let heartbeatInterval: any

        async function checkConnection() {
            if (!navigator.onLine) {
                if (isOnline) {
                    setIsOnline(false)
                    setNetworkStatus(false)
                }
                return
            }

            try {
                // Try to fetch a tiny resource or check a known endpoint
                // We use a cache-busting query parameter to ensure we're actually hitting the network
                const controller = new AbortController()
                const timeoutId = setTimeout(() => controller.abort(), 5000)

                await fetch('https://www.google.com/favicon.ico?v=' + Date.now(), {
                    mode: 'no-cors',
                    signal: controller.signal
                })
                clearTimeout(timeoutId)

                if (!isOnline) {
                    setIsOnline(true)
                    setNetworkStatus(true)
                }
            } catch (err) {
                // If fetch fails despite navigator.onLine being true, we are effectively offline
                if (isOnline) {
                    setIsOnline(false)
                    setNetworkStatus(false)
                }
            }
        }

        function handleOnline() {
            checkConnection()
        }

        function handleOffline() {
            setIsOnline(false)
            setNetworkStatus(false)
            setWasOffline(true)
        }

        window.addEventListener('online', handleOnline)
        window.addEventListener('offline', handleOffline)

        // Periodic heartbeat every 30 seconds
        heartbeatInterval = setInterval(checkConnection, 30000)

        // Initial check
        checkConnection()

        return () => {
            window.removeEventListener('online', handleOnline)
            window.removeEventListener('offline', handleOffline)
            clearInterval(heartbeatInterval)
        }
    }, [isOnline])

    useEffect(() => {
        if (isOnline && wasOffline) {
            toast({
                title: "Back online",
                description: "You are connected to the internet. You can now sync your changes.",
                variant: "default",
            })
            setWasOffline(false)
        } else if (!isOnline && !wasOffline) {
            // This handles the case where it starts offline
            setWasOffline(true)
        }
    }, [isOnline, wasOffline])

    // Specific effect for the "You are offline" toast to avoid duplicates
    useEffect(() => {
        if (!isOnline) {
            toast({
                title: "You are offline",
                description: "Changes will be saved locally and can be synced when you're back online.",
                variant: "destructive",
            })
        }
    }, [isOnline])

    return isOnline
}
