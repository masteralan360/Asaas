import { useEffect, useMemo, useState } from 'react'
import { getSubscriptionExpiryWarning } from '@/lib/subscriptionExpiryWarning'

export function useSubscriptionExpiryWarning(expiresAtIso?: string | null) {
    const [now, setNow] = useState(() => new Date())

    useEffect(() => {
        const updateNow = () => setNow(new Date())
        updateNow()

        if (!expiresAtIso) return

        const intervalId = window.setInterval(updateNow, 60_000)
        window.addEventListener('focus', updateNow)
        document.addEventListener('visibilitychange', updateNow)

        return () => {
            window.clearInterval(intervalId)
            window.removeEventListener('focus', updateNow)
            document.removeEventListener('visibilitychange', updateNow)
        }
    }, [expiresAtIso])

    return useMemo(
        () => getSubscriptionExpiryWarning(expiresAtIso, now),
        [expiresAtIso, now]
    )
}
