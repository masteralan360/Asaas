import { isDesktop } from '@/lib/platform'
import { getUsbBackupDestination, isUsbBackupEnabled, setUsbBackupDestination } from './usbBackupSettings'

const DB_FILENAME = 'atlas-local-mode.db'
const LAST_BACKUP_KEY = 'atlas_usb_last_backup_time'

const COPY_DEBOUNCE_MS = 5000
let lastCopyTime = 0
let pendingCopyTimer: ReturnType<typeof setTimeout> | null = null

function getLastBackupTime(): number | null {
  try {
    const val = localStorage.getItem(LAST_BACKUP_KEY)
    return val ? Number(val) : null
  } catch {
    return null
  }
}

function setLastBackupTime(): void {
  try {
    localStorage.setItem(LAST_BACKUP_KEY, String(Date.now()))
  } catch {
    // noop
  }
}

export async function pickUsbBackupDestination(): Promise<string | null> {
  if (!isDesktop()) return null

  const { open } = await import('@tauri-apps/plugin-dialog')

  const selected = await open({
    multiple: false,
    directory: true,
    title: 'Select USB Backup Destination',
  })

  if (selected && typeof selected === 'string') {
    setUsbBackupDestination(selected)
    return selected
  }

  return null
}

export async function checkUsbDestinationValid(path: string): Promise<boolean> {
  if (!isDesktop()) return false

  const { invoke } = await import('@tauri-apps/api/core')
  try {
    return await invoke<boolean>('check_path_exists', { path })
  } catch {
    return false
  }
}

export async function copyDbToUsb(destDir: string): Promise<boolean> {
  if (!isDesktop()) return false

  const { invoke } = await import('@tauri-apps/api/core')
  try {
    const separator = destDir.includes('/') ? '/' : '\\'
    const normDir = destDir.endsWith(separator) ? destDir.slice(0, -1) : destDir
    const fullDest = `${normDir}${separator}${DB_FILENAME}`

    const copied = await invoke<number>('backup_db_to_usb', {
      dbFilename: DB_FILENAME,
      destPath: fullDest,
    })

    if (copied > 0) {
      setLastBackupTime()
      return true
    }
    return false
  } catch (err) {
    console.warn('[UsbBackup] Failed to copy database to USB:', err)
    return false
  }
}

export async function runUsbBackupIfNeeded(): Promise<void> {
  if (!isDesktop()) return

  const dest = getUsbBackupDestination()
  if (!dest || !isUsbBackupEnabled()) return

  const now = Date.now()
  if (now - lastCopyTime < COPY_DEBOUNCE_MS) {
    if (pendingCopyTimer) return

    pendingCopyTimer = setTimeout(() => {
      pendingCopyTimer = null
      lastCopyTime = 0
      void runUsbBackupIfNeeded()
    }, COPY_DEBOUNCE_MS)

    return
  }

  lastCopyTime = now
  await copyDbToUsb(dest)
}

export async function validateUsbBackupOnStartup(): Promise<{
  valid: boolean
  destination: string | null
  reason?: string
}> {
  if (!isDesktop()) {
    return { valid: true, destination: null }
  }

  const dest = getUsbBackupDestination()
  if (!dest) {
    return { valid: true, destination: null }
  }

  if (!isUsbBackupEnabled()) {
    return { valid: true, destination: null }
  }

  const exists = await checkUsbDestinationValid(dest)
  if (!exists) {
    return {
      valid: false,
      destination: dest,
      reason: 'The USB backup destination is no longer available. The drive may have been disconnected, renamed, or is inaccessible.',
    }
  }

  return { valid: true, destination: dest }
}

export { getLastBackupTime, DB_FILENAME }
