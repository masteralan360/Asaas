import { useLayoutEffect, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, LockKeyhole, UnlockKeyhole } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { ModuleLockerLock } from '@/local-db/models'
import { Button } from '../button'

interface ModuleLockerOverlayProps {
  containerRef: RefObject<HTMLElement | null>
  isLoading: boolean
  lock: ModuleLockerLock | null
  onUnlock: (lock: ModuleLockerLock) => void
}

interface ModuleLockerOverlayBounds {
  top: number
  left: number
  width: number
  height: number
}

export function ModuleLockerOverlay({ containerRef, isLoading, lock, onUnlock }: ModuleLockerOverlayProps) {
  const { t } = useTranslation()
  const [bounds, setBounds] = useState<ModuleLockerOverlayBounds | null>(null)
  const isActive = isLoading || Boolean(lock)

  useLayoutEffect(() => {
    if (!isActive) {
      setBounds(null)
      return
    }

    const container = containerRef.current
    if (!container) return

    const updateBounds = () => {
      const rect = container.getBoundingClientRect()
      setBounds({ top: rect.top, left: rect.left, width: rect.width, height: rect.height })
    }
    updateBounds()

    const observer = new ResizeObserver(updateBounds)
    observer.observe(container)
    window.addEventListener('resize', updateBounds)
    window.visualViewport?.addEventListener('resize', updateBounds)
    window.visualViewport?.addEventListener('scroll', updateBounds)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateBounds)
      window.visualViewport?.removeEventListener('resize', updateBounds)
      window.visualViewport?.removeEventListener('scroll', updateBounds)
    }
  }, [containerRef, isActive])

  if (!isActive || typeof document === 'undefined') return null

  const overlayStyle = bounds
    ? { top: bounds.top, left: bounds.left, width: bounds.width, height: bounds.height }
    : undefined

  if (isLoading) {
    return createPortal(
      <div
        className={bounds ? 'fixed z-40 flex items-center justify-center bg-background' : 'fixed inset-0 z-40 flex items-center justify-center bg-background'}
        style={overlayStyle}
        aria-busy="true"
        aria-label={t('settings.moduleLocker.loading')}
      >
        <Loader2 className="h-7 w-7 animate-spin text-primary" />
      </div>,
      document.body
    )
  }

  if (!lock) return null

  return createPortal(
    <section
      className={bounds ? 'fixed z-40 flex items-center justify-center overflow-y-auto bg-background p-4' : 'fixed inset-0 z-40 flex items-center justify-center overflow-y-auto bg-background p-4'}
      style={overlayStyle}
      aria-labelledby="module-locker-title"
    >
      <div className="w-full max-w-md rounded-2xl border border-primary/20 bg-card p-6 text-center shadow-2xl sm:p-8">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <LockKeyhole className="h-8 w-8" aria-hidden="true" />
        </div>
        <h2 id="module-locker-title" className="mt-5 text-xl font-bold tracking-tight">
          {t('settings.moduleLocker.moduleLockedTitle', { module: lock.moduleName })}
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {t('settings.moduleLocker.moduleLockedDescription')}
        </p>
        <Button className="mt-6 w-full" onClick={() => onUnlock(lock)}>
          <UnlockKeyhole className="mr-2 h-4 w-4" />
          {t('settings.moduleLocker.unlockModule')}
        </Button>
      </div>
    </section>,
    document.body
  )
}
