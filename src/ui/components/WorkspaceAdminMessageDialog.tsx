import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, Loader2, MessageSquare } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/auth'
import {
    listNotificationInbox,
    markNotificationInboxRead,
    normalizeNotificationInboxRow,
    subscribeToNotificationInbox,
    type NotificationInboxRecord,
} from '@/services/notificationInbox'
import { Button } from './button'
import {
    AppDialog,
    AppDialogBody,
    AppDialogContent,
    AppDialogFooter,
    AppDialogHeader,
    AppDialogTitle,
} from './dialog'

const ADMIN_WORKSPACE_MESSAGE_TYPE = 'admin_workspace_message'

export function WorkspaceAdminMessageDialog() {
    const { user, isAuthenticated, isLoading } = useAuth()
    const { t } = useTranslation()
    const [notification, setNotification] = useState<NotificationInboxRecord | null>(null)
    const [isAcknowledging, setIsAcknowledging] = useState(false)
    const [acknowledgementError, setAcknowledgementError] = useState<string | null>(null)
    const refreshRef = useRef<(() => Promise<void>) | null>(null)
    const loadRequestRef = useRef(0)
    const isLocalMode = user?.workspaceMode === 'local' || user?.workspaceMode === 'demo'

    const loadNextMessage = useCallback(async () => {
        const requestId = ++loadRequestRef.current
        const { data, error } = await listNotificationInbox(200)
        if (requestId !== loadRequestRef.current) return
        if (error) {
            console.warn('[WorkspaceAdminMessage] Failed to load notifications:', error)
            return
        }

        setNotification(data.find((item) => (
            item.notification_type === ADMIN_WORKSPACE_MESSAGE_TYPE
            && !item.read_at
            && !item.archived_at
        )) ?? null)
    }, [])

    useEffect(() => {
        const canReceive = isAuthenticated
            && !isLoading
            && user?.id
            && !isLocalMode

        if (!canReceive || !user?.id) {
            setNotification(null)
            refreshRef.current = null
            return
        }

        refreshRef.current = loadNextMessage
        void loadNextMessage()

        const unsubscribe = subscribeToNotificationInbox(user.id, (payload) => {
            if (payload.eventType === 'INSERT' && payload.new) {
                const nextMessage = normalizeNotificationInboxRow(payload.new as NotificationInboxRecord)
                if (
                    nextMessage.notification_type === ADMIN_WORKSPACE_MESSAGE_TYPE
                    && !nextMessage.read_at
                    && !nextMessage.archived_at
                ) {
                    setNotification((current) => current ?? nextMessage)
                    return
                }
            }
            void loadNextMessage()
        })

        return () => {
            unsubscribe()
            if (refreshRef.current === loadNextMessage) {
                refreshRef.current = null
            }
        }
    }, [isAuthenticated, isLoading, isLocalMode, loadNextMessage, user?.id, user?.workspaceId])

    const acknowledge = useCallback(async () => {
        if (!notification || isAcknowledging) return

        setIsAcknowledging(true)
        setAcknowledgementError(null)
        const { error } = await markNotificationInboxRead(notification.id, true)
        if (error) {
            console.warn('[WorkspaceAdminMessage] Failed to mark notification seen:', error)
            setAcknowledgementError(t('workspaceAdminMessage.acknowledgeFailed'))
            setIsAcknowledging(false)
            return
        }

        setNotification(null)
        setIsAcknowledging(false)
        await refreshRef.current?.()
    }, [isAcknowledging, notification, t])

    return (
        <AppDialog open={Boolean(notification)} onOpenChange={(nextOpen) => {
            if (nextOpen) return
        }}>
            <AppDialogContent
                className="max-w-lg"
                showCloseButton={false}
                onEscapeKeyDown={(event) => event.preventDefault()}
                onPointerDownOutside={(event) => event.preventDefault()}
            >
                <AppDialogHeader>
                    <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                            <MessageSquare className="h-5 w-5" />
                        </div>
                        <AppDialogTitle>{t('workspaceAdminMessage.title')}</AppDialogTitle>
                    </div>
                </AppDialogHeader>
                <AppDialogBody className="space-y-4">
                    <p className="whitespace-pre-wrap break-words text-sm leading-6 text-foreground">
                        {notification?.body || t('workspaceAdminMessage.emptyBody')}
                    </p>
                    {acknowledgementError && (
                        <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                            <span>{acknowledgementError}</span>
                        </div>
                    )}
                </AppDialogBody>
                <AppDialogFooter className="justify-end">
                    <Button type="button" disabled={isAcknowledging} onClick={() => void acknowledge()}>
                        {isAcknowledging && <Loader2 className="h-4 w-4 animate-spin" />}
                        {t('workspaceAdminMessage.acknowledge')}
                    </Button>
                </AppDialogFooter>
            </AppDialogContent>
        </AppDialog>
    )
}
