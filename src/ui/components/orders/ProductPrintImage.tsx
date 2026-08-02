import { useState } from 'react'

import { cn } from '@/lib/utils'
import { platformService } from '@/services/platformService'

/**
 * Product image paths are deliberately passed into print templates separately
 * from the immutable order lines. This keeps historic line data intact while
 * allowing a print layout to opt in to the product's current image.
 */
export type ProductPrintImageUrls = Record<string, string | null | undefined>

function resolveProductPrintImageSrc(imageUrl?: string | null) {
    if (!imageUrl) return null
    if (imageUrl.startsWith('http') || imageUrl.startsWith('data:') || imageUrl.startsWith('blob:')) {
        return imageUrl
    }
    return platformService.convertFileSrc(imageUrl)
}

interface ProductPrintImageProps {
    imageUrl?: string | null
    productName: string
    sizeMm?: number
    className?: string
    imageClassName?: string
}

/**
 * A compact, fixed-size product photo for tabular print layouts. It leaves a
 * blank cell when an image is unavailable so rows stay aligned on paper.
 */
export function ProductPrintImage({
    imageUrl,
    productName,
    sizeMm = 7,
    className,
    imageClassName
}: ProductPrintImageProps) {
    const [failedToLoad, setFailedToLoad] = useState(false)
    const src = resolveProductPrintImageSrc(imageUrl)

    if (!src || failedToLoad) return <span aria-hidden="true">{'\u00a0'}</span>

    return (
        <span
            className={cn('inline-flex items-center justify-center overflow-hidden', className)}
            style={{ width: `${sizeMm}mm`, height: `${sizeMm}mm` }}
        >
            <img
                src={src}
                alt={productName}
                className={cn('h-full w-full object-contain', imageClassName)}
                decoding="sync"
                onError={() => setFailedToLoad(true)}
            />
        </span>
    )
}
