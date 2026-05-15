import { useRef, useState, useEffect } from 'react'
import { toast } from '@/ui/components/use-toast'
import { setNetworkStatus } from '@/lib/network'
import { connectionManager } from '@/lib/connectionManager'

export function useNetworkStatus() {
    const [isOnline, setIsOnline] = useState(() => connectionManager.getState().isOnline)
    const [wasOffline, setWasOffline] = useState(false)
    const prevIsOnline = useRef(isOnline)

    useEffect(() => {
        const updateOnlineState = (online: boolean) => {
            setIsOnline(prev => {
                if (prev === online) return prev
                setNetworkStatus(online)
                return online
            })
        }

        const unsubscribe = connectionManager.subscribe((event) => {
            switch (event) {
                case 'online':
                    updateOnlineState(true)
                    break
                case 'offline':
                    updateOnlineState(false)
                    setWasOffline(true)
                    break
                case 'heartbeat':
                    // heartbeat confirms we're still online
                    updateOnlineState(true)
                    break
                case 'wake':
                    // wake event triggers connectivity re-check via heartbeat
                    break
            }
        })

        return unsubscribe
    }, [])

    // "Back online" toast
    useEffect(() => {
        if (isOnline && wasOffline) {
            toast({
                title: "Back online",
                description: "You are connected to the internet. You can now sync your changes.",
                variant: "default",
            })
            setWasOffline(false)
        }
    }, [isOnline, wasOffline])

    // "Offline" toast – only on actual transition, not on initial mount
    useEffect(() => {
        if (prevIsOnline.current === true && isOnline === false) {
            setWasOffline(true)
            toast({
                title: "You are offline",
                description: "Changes will be saved locally and can be synced when you're back online.",
                variant: "destructive",
            })
        }
        prevIsOnline.current = isOnline
    }, [isOnline])

    return isOnline
}
