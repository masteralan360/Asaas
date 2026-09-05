import { describe, expect, it } from 'vitest'

import { getClipboardImageFile } from './clipboardImage'

function clipboardData(items: DataTransferItem[] = [], files: File[] = []): DataTransfer {
    return {
        items: items as unknown as DataTransferItemList,
        files: files as unknown as FileList
    } as DataTransfer
}

function clipboardItem(type: string, file: File | null): DataTransferItem {
    return {
        kind: 'file',
        type,
        getAsFile: () => file
    } as DataTransferItem
}

describe('getClipboardImageFile', () => {
    it('returns an image supplied through clipboard items', () => {
        const image = { name: 'pasted.png', type: 'image/png' } as File

        expect(getClipboardImageFile(clipboardData([
            clipboardItem('text/plain', null),
            clipboardItem('image/png', image)
        ]))).toBe(image)
    })

    it('falls back to clipboard files when no image item is exposed', () => {
        const image = { name: 'pasted.webp', type: 'image/webp' } as File

        expect(getClipboardImageFile(clipboardData([], [image]))).toBe(image)
    })

    it('ignores non-image clipboard content', () => {
        const document = { name: 'notes.txt', type: 'text/plain' } as File

        expect(getClipboardImageFile(clipboardData([
            clipboardItem('text/plain', document)
        ], [document]))).toBeNull()
    })
})
