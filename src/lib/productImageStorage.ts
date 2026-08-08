import { assetManager } from '@/lib/assetManager'
import { isTauri } from '@/lib/platform'
import { platformService } from '@/services/platformService'
import { isLocalWorkspaceMode } from '@/workspace/workspaceMode'

/**
 * Stores one product image using the exact location and fallback strategy used
 * by products.image_url. The caller owns when the upload starts and whether the
 * returned path is persisted as a primary or additional image.
 */
export async function storeProductImageFile(file: File, workspaceId: string): Promise<string | null> {
    if (isTauri()) {
        const targetPath = await platformService.saveImageFile(file, workspaceId)
        if (targetPath) {
            // Keep the desktop upload behavior aligned with the primary image:
            // the local image is usable immediately while it syncs to storage.
            assetManager.uploadFromPath(targetPath).catch(console.error)
        }
        return targetPath
    }

    const ext = file.name.split('.').pop() || 'jpg'
    const fileName = `${Date.now()}.${ext}`
    const targetPath = `product-images/${workspaceId}/${fileName}`
    const r2Path = `${workspaceId}/product-images/${fileName}`

    const { r2Service } = await import('@/services/r2Service')
    if (!isLocalWorkspaceMode(workspaceId) && r2Service.isConfigured()) {
        const success = await r2Service.upload(r2Path, file)
        if (success) {
            return targetPath
        }
    }

    return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onloadend = () => resolve(reader.result as string)
        reader.onerror = () => reject(new Error('Unable to read the selected image.'))
        reader.readAsDataURL(file)
    })
}

export function getProductImageDisplayUrl(url?: string | null): string {
    if (!url) return ''
    if (/^(https?:|data:|blob:)/i.test(url)) return url
    return platformService.convertFileSrc(url)
}
