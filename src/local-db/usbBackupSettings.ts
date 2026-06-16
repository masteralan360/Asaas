const USB_DEST_KEY = 'atlas_usb_backup_dest'
const USB_ENABLED_KEY = 'atlas_usb_backup_enabled'

export function getUsbBackupDestination(): string | null {
  try {
    return localStorage.getItem(USB_DEST_KEY)
  } catch {
    return null
  }
}

export function setUsbBackupDestination(path: string | null): void {
  try {
    if (path) {
      localStorage.setItem(USB_DEST_KEY, path)
      localStorage.setItem(USB_ENABLED_KEY, 'true')
    } else {
      localStorage.removeItem(USB_DEST_KEY)
      localStorage.removeItem(USB_ENABLED_KEY)
    }
  } catch {
    // noop
  }
}

export function isUsbBackupEnabled(): boolean {
  try {
    const dest = localStorage.getItem(USB_DEST_KEY)
    const enabled = localStorage.getItem(USB_ENABLED_KEY)
    return !!dest && enabled !== 'false'
  } catch {
    return false
  }
}

export function clearUsbBackupSettings(): void {
  try {
    localStorage.removeItem(USB_DEST_KEY)
    localStorage.removeItem(USB_ENABLED_KEY)
  } catch {
    // noop
  }
}

export function hasUsbBackupConfig(): boolean {
  try {
    return !!localStorage.getItem(USB_DEST_KEY)
  } catch {
    return false
  }
}
