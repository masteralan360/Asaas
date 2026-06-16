import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/ui/components/dialog'
import { Button } from '@/ui/components/button'
import { AlertTriangle, Usb, RefreshCw } from 'lucide-react'

interface Props {
  open: boolean
  destination: string
  onRetry: () => void
  onChangeDestination: () => void
  onDisable: () => void
  isRetrying?: boolean
}

export function UsbBackupWarningModal({
  open,
  destination,
  onRetry,
  onChangeDestination,
  onDisable,
  isRetrying,
}: Props) {
  return (
    <Dialog open={open}>
      <DialogContent className="max-w-md" onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
              <AlertTriangle className="h-6 w-6 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <DialogTitle className="text-lg">USB Backup Unavailable</DialogTitle>
              <DialogDescription className="mt-1 text-sm leading-relaxed">
                The previously selected USB backup destination is no longer available. The drive may have been
                disconnected, renamed, or is inaccessible.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="rounded-lg bg-muted/30 p-3 text-sm">
          <div className="flex items-start gap-2">
            <Usb className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Previously configured destination:</p>
              <p className="mt-0.5 truncate font-mono text-xs font-medium text-foreground">{destination}</p>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-xs text-yellow-800 dark:border-yellow-800/30 dark:bg-yellow-900/20 dark:text-yellow-200">
          Your local data is still safe. No data has been lost. Choose an action below to continue.
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button onClick={onRetry} disabled={isRetrying} className="w-full gap-2">
            <RefreshCw className={`h-4 w-4 ${isRetrying ? 'animate-spin' : ''}`} />
            {isRetrying ? 'Checking...' : 'Reconnect USB and Retry'}
          </Button>
          <Button onClick={onChangeDestination} variant="outline" className="w-full">
            Choose a New Backup Destination
          </Button>
          <Button onClick={onDisable} variant="ghost" className="w-full text-muted-foreground">
            Disable USB Backup
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
