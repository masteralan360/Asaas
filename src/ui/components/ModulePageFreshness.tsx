import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAuth } from '@/auth'
import { useWorkspace } from '@/workspace'
import {
    getWorkspaceDataFetchSource,
    readWorkspaceDataFetch,
    WORKSPACE_DATA_FETCH_EVENT,
    type WorkspaceDataFetchSnapshot
} from '@/workspace/workspaceDataFreshness'
import { cn } from '@/lib/utils'

function formatRelativeTime(timestamp: string, locale: string) {
    const date = new Date(timestamp)
    if (Number.isNaN(date.getTime())) return null

    const elapsedMs = Math.max(0, Date.now() - date.getTime())
    const formatter = new Intl.RelativeTimeFormat(locale || 'en', {
        numeric: 'auto',
        style: 'short'
    })

    if (elapsedMs < 60_000) return formatter.format(0, 'second')
    if (elapsedMs < 3_600_000) return formatter.format(-Math.floor(elapsedMs / 60_000), 'minute')
    if (elapsedMs < 86_400_000) return formatter.format(-Math.floor(elapsedMs / 3_600_000), 'hour')
    if (elapsedMs < 604_800_000) return formatter.format(-Math.floor(elapsedMs / 86_400_000), 'day')

    return new Intl.DateTimeFormat(locale || 'en', {
        month: 'short',
        day: 'numeric',
        year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric'
    }).format(date)
}

export function ModulePageFreshness({ className }: { className?: string }) {
    const { t, i18n } = useTranslation()
    const { user } = useAuth()
    const { features } = useWorkspace()
    const source = getWorkspaceDataFetchSource(features.data_mode)
    const workspaceId = user?.workspaceId
    const [lastFetchedAt, setLastFetchedAt] = useState<string | null>(() => (
        readWorkspaceDataFetch(workspaceId, source)?.fetchedAt ?? null
    ))
    const [clock, setClock] = useState(0)

    useEffect(() => {
        setLastFetchedAt(readWorkspaceDataFetch(workspaceId, source)?.fetchedAt ?? null)

        const handleFetch = (event: Event) => {
            const snapshot = (event as CustomEvent<WorkspaceDataFetchSnapshot>).detail
            if (snapshot?.workspaceId === workspaceId && snapshot.source === source) {
                setLastFetchedAt(snapshot.fetchedAt)
            }
        }

        window.addEventListener(WORKSPACE_DATA_FETCH_EVENT, handleFetch)
        return () => window.removeEventListener(WORKSPACE_DATA_FETCH_EVENT, handleFetch)
    }, [source, workspaceId])

    useEffect(() => {
        const interval = window.setInterval(() => setClock((value) => value + 1), 60_000)
        return () => window.clearInterval(interval)
    }, [])

    const relativeTime = useMemo(
        () => lastFetchedAt ? formatRelativeTime(lastFetchedAt, i18n.resolvedLanguage || i18n.language) : null,
        [clock, i18n.language, i18n.resolvedLanguage, lastFetchedAt]
    )
    const label = relativeTime
        ? t('launcher.freshness.updated', { time: relativeTime, defaultValue: `Updated ${relativeTime}` })
        : t('launcher.freshness.unavailable', { defaultValue: 'Update unavailable' })

    return (
        <span
            className={cn('inline text-current !ms-0', className)}
            title={lastFetchedAt
                ? new Intl.DateTimeFormat(i18n.resolvedLanguage || i18n.language || 'en', {
                    dateStyle: 'medium',
                    timeStyle: 'short'
                }).format(new Date(lastFetchedAt))
                : undefined}
        >
            <span aria-hidden="true" className="mx-1 text-muted-foreground/60">•</span>
            {label}
        </span>
    )
}
