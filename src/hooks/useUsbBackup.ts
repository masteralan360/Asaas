import { useState, useCallback, useEffect } from 'react'
import { isDesktop } from '@/lib/platform'
import {
  getUsbBackupDestination,
  isUsbBackupEnabled,
  clearUsbBackupSettings,
} from '@/local-db/usbBackupSettings'
import {
  pickUsbBackupDestination,
  checkUsbDestinationValid,
  copyDbToUsb,
  getLastBackupTime,
} from '@/local-db/usbBackup'

export function useUsbBackup() {
  const [usbDestination, setUsbDestinationState] = useState<string | null>(() => getUsbBackupDestination())
  const [isEnabled, setIsEnabled] = useState<boolean>(() => isUsbBackupEnabled())
  const [lastBackupTime, setLastBackupTime] = useState<number | null>(() => getLastBackupTime())

  useEffect(() => {
    const handleStorage = () => {
      setUsbDestinationState(getUsbBackupDestination())
      setIsEnabled(isUsbBackupEnabled())
      setLastBackupTime(getLastBackupTime())
    }

    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])

  const pickDestination = useCallback(async (): Promise<string | null> => {
    const path = await pickUsbBackupDestination()
    if (path) {
      setUsbDestinationState(path)
      setIsEnabled(true)
      await copyDbToUsb(path)
    }
    return path
  }, [])

  const changeDestination = useCallback(async (): Promise<string | null> => {
    return pickDestination()
  }, [pickDestination])

  const disableUsbBackup = useCallback(() => {
    clearUsbBackupSettings()
    setUsbDestinationState(null)
    setIsEnabled(false)
  }, [])

  const retryConnection = useCallback(async (): Promise<boolean> => {
    const dest = getUsbBackupDestination()
    if (!dest) return false
    const valid = await checkUsbDestinationValid(dest)
    if (valid) {
      setLastBackupTime(getLastBackupTime())
    }
    return valid
  }, [])

  const refreshStatus = useCallback(() => {
    setUsbDestinationState(getUsbBackupDestination())
    setIsEnabled(isUsbBackupEnabled())
    setLastBackupTime(getLastBackupTime())
  }, [])

  return {
    usbDestination,
    isEnabled,
    lastBackupTime,
    pickDestination,
    changeDestination,
    disableUsbBackup,
    retryConnection,
    refreshStatus,
    isDesktopApp: isDesktop(),
    isConfigured: !!usbDestination && isEnabled,
  }
}
