import { useEffect } from 'react'
import { useAuth } from '@/auth'
import { registerDeviceTokenIfNeeded } from '@/services/notificationDevice'

export function DeviceTokenBootstrap() {
    const { user, isAuthenticated } = useAuth()

    useEffect(() => {
        if (!isAuthenticated || !user) return
        void registerDeviceTokenIfNeeded(user.id)
    }, [isAuthenticated, user?.id])

    return null
}
