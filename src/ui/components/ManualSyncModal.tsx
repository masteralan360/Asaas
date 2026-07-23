import { useEffect, useState } from 'react'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter
} from '@/ui/components/dialog'
import { Button } from '@/ui/components/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/components/table'
import { Loader2, CheckCircle2, AlertTriangle, ListTodo } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { useToast } from '@/ui/components/use-toast'
import { usePendingSyncMutations, clearOfflineMutations } from '@/local-db/hooks'
import { retrySchemaMismatchMutations } from '@/local-db/offlineMutations'
import type { OfflineMutation } from '@/local-db/models'
import { isSchemaMismatchError } from '@/sync/syncErrors'
import { inspectRemoteMutationPayload, type RemoteMutationFieldInspection } from '@/sync/syncPayloadContract'
import { useTranslation } from 'react-i18next'
import { runManagedFullSync } from '@/sync/syncCoordinator'
import { LAST_SYNC_KEY } from '@/sync/constants'
import { connectionManager } from '@/lib/connectionManager'

interface ManualSyncModalProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    onSyncComplete?: () => void
}

function getEntityLabel(entityType: OfflineMutation['entityType']) {
    return entityType
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (letter: string) => letter.toUpperCase())
}

function getMutationSummary(payload: OfflineMutation['payload']) {
    const summaryFields = [
        'name',
        'title',
        'invoiceNumber',
        'invoice_number',
        'referenceLabel',
        'reference_label',
        'code',
        'sku'
    ]

    for (const field of summaryFields) {
        const value = payload[field]
        if (typeof value === 'string' && value.trim()) {
            return value.trim()
        }
    }

    return null
}

function formatQueuedAt(createdAt: string, locale: string) {
    const date = new Date(createdAt)
    if (Number.isNaN(date.getTime())) return createdAt

    return new Intl.DateTimeFormat(locale, {
        hour: 'numeric',
        minute: '2-digit',
        month: 'short',
        day: 'numeric'
    }).format(date)
}

function formatPayloadValue(value: unknown) {
    if (value === null) return 'null'
    if (value === undefined) return 'undefined'
    if (typeof value === 'string') return value
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value)
    if (typeof Blob !== 'undefined' && value instanceof Blob) {
        return `[Blob: ${value.type || 'unknown type'}, ${value.size.toLocaleString()} bytes]`
    }

    try {
        return JSON.stringify(value, null, 2)
    } catch {
        return String(value)
    }
}

function getFieldStatusDisplay(status: RemoteMutationFieldInspection['status']) {
    if (status === 'invalid') {
        return { label: 'Invalid', className: 'bg-destructive/10 text-destructive' }
    }
    if (status === 'excluded') {
        return { label: 'Excluded', className: 'bg-muted text-muted-foreground' }
    }
    return { label: 'Valid', className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' }
}

export function ManualSyncModal({ open, onOpenChange, onSyncComplete }: ManualSyncModalProps) {
    const { t, i18n } = useTranslation()
    const { user } = useAuth()
    const { toast } = useToast()
    const pendingMutations = usePendingSyncMutations()
    const pendingCount = pendingMutations.length
    const [isOnline, setIsOnline] = useState(() => connectionManager.getState().isOnline)

    const [isSyncing, setIsSyncing] = useState(false)
    const [status, setStatus] = useState<'idle' | 'syncing' | 'success' | 'error'>('idle')
    const [errorMessage, setErrorMessage] = useState<string | null>(null)
    const [showDiscardConfirm, setShowDiscardConfirm] = useState(false)
    const [selectedMutation, setSelectedMutation] = useState<OfflineMutation | null>(null)

    const selectedMutationFields = selectedMutation
        ? inspectRemoteMutationPayload(selectedMutation.entityType, selectedMutation.payload, selectedMutation.error)
        : []

    function handleOpenChange(nextOpen: boolean) {
        if (!nextOpen) {
            setSelectedMutation(null)
            setShowDiscardConfirm(false)
        }
        onOpenChange(nextOpen)
    }

    useEffect(() => {
        return connectionManager.subscribe((event) => {
            if (event === 'online' || event === 'heartbeat') {
                setIsOnline(true)
            } else if (event === 'offline') {
                setIsOnline(false)
            }
        })
    }, [])

    async function handleSync() {
        if (!user || !user.workspaceId) return

        setIsSyncing(true)
        setStatus('syncing')
        setErrorMessage(null)

        try {
            // This is deliberate user intent. Automatic sync never retries a
            // schema mismatch because doing so would repeatedly fail until a
            // server migration is available.
            await retrySchemaMismatchMutations(user.workspaceId)
            const result = await runManagedFullSync(
                user.id,
                user.workspaceId,
                localStorage.getItem(LAST_SYNC_KEY)
            )

            if (result.success) {
                localStorage.setItem(LAST_SYNC_KEY, new Date().toISOString())
                setStatus('success')
                toast({
                    title: t('sync.toastSyncComplete'),
                    description: t('sync.toastSyncStats', { pushed: result.pushed, pulled: result.pulled }),
                    variant: 'default'
                })
                if (onSyncComplete) onSyncComplete()

                setTimeout(() => {
                    onOpenChange(false)
                    setStatus('idle')
                }, 1500)
            } else {
                setStatus('error')
                setErrorMessage(result.errors.join(', '))
                toast({
                    title: t('sync.toastSyncFailed'),
                    description: t('sync.toastSyncFailedDesc'),
                    variant: 'destructive'
                })
            }
        } catch (error: any) {
            setStatus('error')
            setErrorMessage(error.message || 'Unknown error occurred')
            toast({
                title: t('sync.toastSyncError'),
                description: error.message,
                variant: 'destructive'
            })
        } finally {
            setIsSyncing(false)
        }
    }

    async function handleDiscard() {
        try {
            await clearOfflineMutations()
            toast({
                title: t('sync.toastDiscardTitle'),
                description: t('sync.toastDiscardDesc'),
                variant: 'default'
            })
            setShowDiscardConfirm(false)
            onOpenChange(false)
        } catch (_error: any) {
            toast({
                title: t('common.error', 'Error'),
                description: t('sync.discardError'),
                variant: 'destructive'
            })
        }
    }

    return (
        <>
            <Dialog open={open} onOpenChange={isSyncing ? undefined : handleOpenChange}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>{t('sync.title')}</DialogTitle>
                        <DialogDescription>
                            {status === 'idle' && t('sync.pendingCount', { count: pendingCount })}
                            {status === 'syncing' && t('sync.syncing')}
                            {status === 'success' && t('sync.success')}
                            {status === 'error' && t('sync.failed')}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="flex flex-col items-center justify-center py-4 space-y-4">
                        {status === 'idle' && (
                            <div className="w-full space-y-3">
                                <div className="flex items-center justify-between gap-3">
                                    <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                                        <ListTodo className="h-4 w-4 text-primary" />
                                        <span>{t('sync.queueTitle')}</span>
                                    </div>
                                    <span className="text-xs text-muted-foreground">
                                        {t('sync.queueItems', { count: pendingMutations.length })}
                                    </span>
                                </div>

                                <div
                                    aria-label={t('sync.queueTitle')}
                                    className="max-h-52 divide-y overflow-y-auto rounded-md border bg-muted/20 text-left"
                                >
                                    {pendingMutations.map((mutation) => {
                                        const summary = getMutationSummary(mutation.payload)
                                        const hasSchemaMismatch = isSchemaMismatchError(mutation.error)
                                        const statusLabel = hasSchemaMismatch
                                            ? t('sync.needsAttention', { defaultValue: 'Needs attention' })
                                            : mutation.status === 'failed'
                                                ? t('sync.retrying')
                                            : mutation.status === 'syncing'
                                                ? t('sync.syncing')
                                                : t('sync.queued')

                                        return (
                                            <button
                                                key={mutation.id}
                                                type="button"
                                                onClick={() => setSelectedMutation(mutation)}
                                                className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                                title="Review sync payload"
                                            >
                                                <div className="min-w-0">
                                                    <p className="truncate text-sm font-medium text-foreground">
                                                        {getEntityLabel(mutation.entityType)}
                                                        {summary && <span className="font-normal text-muted-foreground"> · {summary}</span>}
                                                    </p>
                                                    <p className="mt-0.5 text-xs text-muted-foreground">
                                                        {t(`sync.operations.${mutation.operation}`)} · {formatQueuedAt(mutation.createdAt, i18n.language)}
                                                    </p>
                                                </div>
                                                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${hasSchemaMismatch ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary'}`}>
                                                    {statusLabel}
                                                </span>
                                            </button>
                                        )
                                    })}
                                </div>

                                <p className="text-center text-sm text-muted-foreground">
                                    {t('sync.connectionNote')}
                                </p>
                            </div>
                        )}

                        {status === 'syncing' && (
                            <div className="flex flex-col items-center gap-2">
                                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                                <p className="text-sm text-muted-foreground">{t('sync.processing')}</p>
                            </div>
                        )}

                        {status === 'success' && (
                            <div className="flex flex-col items-center gap-2">
                                <CheckCircle2 className="h-8 w-8 text-green-500" />
                                <p className="text-sm font-medium text-green-600">{t('sync.allSynced')}</p>
                            </div>
                        )}

                        {status === 'error' && (
                            <div className="flex flex-col items-center gap-2">
                                <AlertTriangle className="h-8 w-8 text-destructive" />
                                <p className="text-sm font-medium text-destructive">{t('sync.failed')}</p>
                                {errorMessage && (
                                    <p className="text-xs text-muted-foreground text-center max-w-[80%]">
                                        {errorMessage}
                                    </p>
                                )}
                            </div>
                        )}
                    </div>

                    <DialogFooter className="sm:justify-between flex-row gap-2">
                        <div className="flex gap-2">
                            <Button
                                variant="ghost"
                                onClick={() => handleOpenChange(false)}
                                disabled={isSyncing}
                            >
                                {status === 'success' ? t('common.close', 'Close') : t('common.cancel', 'Cancel')}
                            </Button>
                            {status === 'idle' && pendingCount > 0 && (
                                <Button
                                    variant="destructive"
                                    onClick={() => setShowDiscardConfirm(true)}
                                    disabled={isSyncing}
                                >
                                    {t('sync.discardBtn')}
                                </Button>
                            )}
                        </div>
                        {status !== 'success' && (
                            <Button
                                onClick={handleSync}
                                disabled={isSyncing || !isOnline}
                            >
                                {isSyncing ? t('sync.syncingBtn') : t('sync.syncNow')}
                            </Button>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={showDiscardConfirm} onOpenChange={setShowDiscardConfirm}>
                <DialogContent className="sm:max-w-[400px]">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-destructive">
                            <AlertTriangle className="h-5 w-5" />
                            {t('sync.confirmDiscard')}
                        </DialogTitle>
                        <DialogDescription>
                            {t('sync.discardDescription', { count: pendingCount })}
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="sm:justify-end gap-2">
                        <Button variant="ghost" onClick={() => setShowDiscardConfirm(false)}>
                            {t('common.cancel', 'Cancel')}
                        </Button>
                        <Button variant="destructive" onClick={handleDiscard}>
                            {t('sync.yesDiscard')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog
                open={selectedMutation !== null}
                onOpenChange={(nextOpen) => {
                    if (!nextOpen) setSelectedMutation(null)
                }}
            >
                <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-4xl">
                    <DialogHeader>
                        <DialogTitle>{getEntityLabel(selectedMutation?.entityType ?? 'products')} sync payload</DialogTitle>
                        <DialogDescription>
                            Review exactly which fields are valid for sync, intentionally excluded, or rejected by Supabase.
                        </DialogDescription>
                    </DialogHeader>

                    {selectedMutation?.error && (
                        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                            {selectedMutation.error}
                        </div>
                    )}

                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Field</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Reason</TableHead>
                                <TableHead>Value</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {selectedMutationFields.map((field) => {
                                const statusDisplay = getFieldStatusDisplay(field.status)
                                return (
                                    <TableRow key={field.field}>
                                        <TableCell className="font-mono text-xs font-medium">{field.field}</TableCell>
                                        <TableCell>
                                            <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusDisplay.className}`}>
                                                {statusDisplay.label}
                                            </span>
                                        </TableCell>
                                        <TableCell className="min-w-48 text-xs text-muted-foreground">{field.reason}</TableCell>
                                        <TableCell className="min-w-56 max-w-80 whitespace-pre-wrap break-all font-mono text-xs">
                                            {formatPayloadValue(field.value)}
                                        </TableCell>
                                    </TableRow>
                                )
                            })}
                        </TableBody>
                    </Table>

                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setSelectedMutation(null)}>
                            {t('common.close', 'Close')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    )
}
