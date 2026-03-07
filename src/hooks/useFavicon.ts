import { useEffect } from 'react'


/**
 * Returns the static favicon path.
 */
function getFaviconPath(): string {
    return '/logo.ico'
}

/**
 * Returns the static logo path.
 */
function getLogoPath(): string {
    return '/logo.png'
}

/**
 * Custom hook to update the favicon.
 * Now hardcoded to /logo.ico as per user request.
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
        link.type = 'image/x-icon'
        link.href = faviconPath
    }, [])
}

/**
 * Custom hook that returns the static logo path.
 */
export function useLogo(): string {
    return '/logo.png'
}

export { getFaviconPath, getLogoPath }
