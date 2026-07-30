import { useEffect } from 'react'


/**
 * Returns the static favicon path.
 */
function getFaviconPath(): string {
    return '/AtlasClear.png'
}

/**
 * Returns the static logo path.
 */
function getLogoPath(): string {
    return '/AtlasClear.png'
}

/**
 * Custom hook to update the favicon.
 * Uses the shipped PNG favicon asset.
 */
export function useFavicon() {
    useEffect(() => {
        const faviconPath = getFaviconPath()

        // Find or create the favicon link element
        let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']")
        if (!link) {
            link = document.createElement('link')
            link.rel = 'icon'
            document.head.appendChild(link)
        }

        // Update the href
        link.type = 'image/png'
        link.href = faviconPath
    }, [])
}

/**
 * Custom hook that returns the static logo path.
 */
export function useLogo(): string {
    return '/AtlasClear.png'
}

export { getFaviconPath, getLogoPath }
