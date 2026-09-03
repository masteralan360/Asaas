import { useEffect, useState } from 'react'
import { KeyRound, Loader2, LockKeyhole, UnlockKeyhole } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  lockModule,
  recordModuleLockerAudit,
  unlockAllModules,
  unlockModule,
  verifyModuleLockerPasskey,
  type ModuleLockerActor
} from '@/local-db/moduleLocker'
import {
  AppDialog,
  AppDialogBody,
  AppDialogContent,
  AppDialogDescription,
  AppDialogFooter,
  AppDialogHeader,
  AppDialogTitle
} from '../dialog'
import { Button } from '../button'
import { Checkbox } from '../checkbox'
import { Input } from '../input'
import { Label } from '../label'
import { useToast } from '../use-toast'

export type ModuleLockerPasskeyAction = 'lock' | 'unlock'

interface ModuleLockerPasskeyDialogProps {
  open: boolean
  action: ModuleLockerPasskeyAction | null
  workspaceId?: string
  moduleHref?: string
  moduleName?: string
  actor?: ModuleLockerActor
  onOpenChange: (open: boolean) => void
}

export function ModuleLockerPasskeyDialog({
  open,
  action,
  workspaceId,
  moduleHref,
  moduleName,
  actor,
  onOpenChange
}: ModuleLockerPasskeyDialogProps) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [passkey, setPasskey] = useState('')
  const [unlockAllModulesSelected, setUnlockAllModulesSelected] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)

  useEffect(() => {
    if (open) return
    setPasskey('')
    setUnlockAllModulesSelected(false)
    setIsProcessing(false)
  }, [open])

  const isUnlocking = action === 'unlock'
  const actionTitle = isUnlocking
    ? t('settings.moduleLocker.unlockDialogTitle')
    : t('settings.moduleLocker.lockDialogTitle')
  const actionDescription = isUnlocking
    ? t('settings.moduleLocker.unlockDialogDescription', { module: moduleName })
    : t('settings.moduleLocker.lockDialogDescription', { module: moduleName })

  const getVerificationMessage = (reason: 'missing' | 'invalid' | 'locked', retryAfterMs?: number) => {
    if (reason === 'locked') {
      return t('settings.moduleLocker.passkeyLockedDescription', {
        seconds: Math.max(1, Math.ceil((retryAfterMs ?? 0) / 1_000))
      })
    }
    if (reason === 'missing') return t('settings.moduleLocker.passkeyUnavailableDescription')
    return t('settings.moduleLocker.passkeyIncorrectDescription')
  }

  const handleSubmit = async () => {
    if (!workspaceId || !moduleHref || !moduleName || !actor || !action || !passkey.trim()) return

    setIsProcessing(true)
    try {
      const verification = await verifyModuleLockerPasskey(workspaceId, passkey)
      if (!verification.ok) {
        if (verification.reason !== 'missing') {
          await recordModuleLockerAudit({
            workspaceId,
            action: 'passkey_failed',
            actor,
            moduleHref,
            moduleName
          })
        }
        setPasskey('')
        toast({
          title: t('settings.moduleLocker.passkeyRejectedTitle'),
          description: getVerificationMessage(verification.reason, verification.retryAfterMs),
          variant: 'destructive'
        })
        return
      }

      if (action === 'lock') {
        await lockModule({ workspaceId, moduleHref, moduleName, actor })
        toast({
          title: t('settings.moduleLocker.lockedToastTitle'),
          description: t('settings.moduleLocker.lockedToastDescription', { module: moduleName })
        })
      } else {
        if (unlockAllModulesSelected) {
          const unlockedCount = await unlockAllModules({ workspaceId, actor })
          toast({
            title: t('settings.moduleLocker.allUnlockedToastTitle'),
            description: t('settings.moduleLocker.allUnlockedToastDescription', { count: unlockedCount })
          })
        } else {
          await unlockModule({ workspaceId, moduleHref, moduleName, actor })
          toast({
            title: t('settings.moduleLocker.unlockedToastTitle'),
            description: t('settings.moduleLocker.unlockedToastDescription', { module: moduleName })
          })
        }
      }
      onOpenChange(false)
    } catch (error) {
      console.error('[ModuleLocker] Failed to update module lock:', error)
      toast({
        title: t('settings.moduleLocker.actionFailedTitle'),
        description: t('settings.moduleLocker.actionFailedDescription'),
        variant: 'destructive'
      })
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <AppDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && isProcessing) return
        onOpenChange(nextOpen)
      }}
    >
      <AppDialogContent className="max-w-md" showCloseButton={!isProcessing}>
        <AppDialogHeader>
          <AppDialogTitle className="flex items-center gap-2">
            {isUnlocking ? <UnlockKeyhole className="h-5 w-5 text-primary" /> : <LockKeyhole className="h-5 w-5 text-primary" />}
            {actionTitle}
          </AppDialogTitle>
          <AppDialogDescription>{actionDescription}</AppDialogDescription>
        </AppDialogHeader>
        <AppDialogBody>
          <div className="space-y-2">
            <Label htmlFor="module-locker-action-passkey">
              {t('settings.moduleLocker.passkeyLabel')} *
            </Label>
            <Input
              id="module-locker-action-passkey"
              type="password"
              autoComplete="off"
              autoFocus
              value={passkey}
              onChange={(event) => setPasskey(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && passkey.trim() && !isProcessing) {
                  event.preventDefault()
                  void handleSubmit()
                }
              }}
              disabled={isProcessing}
            />
          </div>
          {isUnlocking && (
            <div className="flex items-start gap-3 rounded-lg border border-border/70 bg-muted/30 p-3">
              <Checkbox
                id="module-locker-unlock-all"
                checked={unlockAllModulesSelected}
                onCheckedChange={(checked) => setUnlockAllModulesSelected(Boolean(checked))}
                disabled={isProcessing}
                allowViewer
                className="mt-0.5"
              />
              <div className="space-y-1">
                <Label htmlFor="module-locker-unlock-all" className="cursor-pointer">
                  {t('settings.moduleLocker.unlockAllModules')}
                </Label>
                <p className="text-xs leading-5 text-muted-foreground">
                  {t('settings.moduleLocker.unlockAllModulesDescription')}
                </p>
              </div>
            </div>
          )}
        </AppDialogBody>
        <AppDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isProcessing}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={!passkey.trim() || isProcessing}>
            {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}
            {isProcessing
              ? t('settings.moduleLocker.verifying')
              : isUnlocking
                ? unlockAllModulesSelected
                  ? t('settings.moduleLocker.unlockAllModules')
                  : t('settings.moduleLocker.unlockModule')
                : t('settings.moduleLocker.lockModule')}
          </Button>
        </AppDialogFooter>
      </AppDialogContent>
    </AppDialog>
  )
}
