import { useSyncStatus, type UseSyncStatusResult } from '@/sync'
import { cn } from '@/lib/utils'
import { Cloud, CloudOff, RefreshCw, Check } from 'lucide-react'

export function SyncStatusIndicator() {
    const { pendingCount, isOnline, sync, isSyncing, lastSyncTime }: UseSyncStatusResult = useSyncStatus()

    const getStatusInfo = () => {
        if (!isOnline) {
            return {
                icon: CloudOff,
                label: 'Offline',
                color: 'text-red-500',
                bgColor: 'bg-red-500/10',
                dotColor: 'bg-red-500'
            }
        }
        if (isSyncing) {
            return {
                icon: RefreshCw,
                label: 'Syncing...',
                color: 'text-amber-500',
                bgColor: 'bg-amber-500/10',
                dotColor: 'bg-amber-500'
            }
        }
        if (pendingCount > 0) {
            return {
                icon: Cloud,
                label: `${pendingCount} pending`,
                color: 'text-amber-500',
                bgColor: 'bg-amber-500/10',
                dotColor: 'bg-amber-500'
            }
        }
        return {
            icon: Check,
            label: 'Synced',
            color: 'text-emerald-500',
            bgColor: 'bg-emerald-500/10',
            dotColor: 'bg-emerald-500'
        }
    }

    const { icon: Icon, label, color, bgColor, dotColor } = getStatusInfo()

    return (
        <button
            onClick={sync}
            disabled={isSyncing || !isOnline}
            className={cn(
                'flex items-center gap-2 px-3 py-1.5 rounded-full transition-all',
                bgColor,
                'hover:opacity-80 disabled:cursor-not-allowed'
            )}
            title={lastSyncTime ? `Last synced: ${new Date(lastSyncTime).toLocaleString()}` : 'Never synced'}
        >
            <div className={cn('w-2 h-2 rounded-full', dotColor, isSyncing && 'animate-pulse')} />
            <Icon className={cn('w-4 h-4', color, isSyncing && 'animate-spin')} />
            <span className={cn('text-xs font-medium', color)}>{label}</span>
        </button>
    )
}
