/**
 * Returns the first image file made available by a clipboard paste event.
 * Text-only clipboard data is intentionally ignored so normal input pasting
 * continues to work.
 */
export function getClipboardImageFile(clipboardData: DataTransfer | null | undefined): File | null {
    const imageItem = Array.from(clipboardData?.items || []).find((item) => (
        item.kind === 'file' && item.type.startsWith('image/')
    ))
    const itemFile = imageItem?.getAsFile()
    if (itemFile) {
        return itemFile
    }

    return Array.from(clipboardData?.files || []).find((file) => (
        file.type.startsWith('image/')
    )) || null
}
