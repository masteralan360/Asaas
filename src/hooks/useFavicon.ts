import { useEffect, useMemo } from 'react'

type ThemeStyle = 'modern' | 'legacy' | 'primary'

/**
 * Returns the appropriate favicon path based on language and theme style.
 * - English: en-default.ico
 * - Arabic: ar.ico
 * - Kurdish + Legacy: ku-blue.ico
 * - Kurdish + Modern: ku-purple.ico
 */
function getFaviconPath(language: string, themeStyle: ThemeStyle): string {
    const color = themeStyle === 'modern' ? 'purple' : 'blue'
    if (language === 'ar') {
        return `/logoICO/ar-${color}.ico`
    }
    if (language === 'ku') {
        return `/logoICO/ku-${color}.ico`
    }
    if (language === 'en' && themeStyle === 'primary') {
        return `/logo.ico`
    }
    return `/logoICO/en-${color}.ico`
}

/**
 * Returns the appropriate logo path (PNG) based on language and theme style.
 * Uses the same mapping as favicon but with .png extension for UI display.
 */
function getLogoPath(language: string, themeStyle: ThemeStyle): string {
    const color = themeStyle === 'modern' ? 'purple' : 'blue'
    if (language === 'ar') {
        return `/logoPNG/ar-${color}.png`
    }
    if (language === 'ku') {
        return `/logoPNG/ku-${color}.png`
    }
    if (language === 'en' && themeStyle === 'primary') {
        return `/logo.png`
    }
    return `/logoPNG/en-${color}.png`
}

/**
 * Custom hook to dynamically update the favicon based on language and theme.
 * Updates the <link rel="icon"> element in the document head.
 */
export function useFavicon(language: string, themeStyle: ThemeStyle = 'modern') {
    useEffect(() => {
        const faviconPath = getFaviconPath(language, themeStyle)

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

        console.log(`[Favicon] Updated to: ${faviconPath}`)
    }, [language, themeStyle])
}

/**
 * Custom hook that returns the dynamic logo path based on language and theme.
 * Use this for sidebar and titlebar logo display.
 */
export function useLogo(language: string, themeStyle: ThemeStyle = 'modern'): string {
    return useMemo(() => getLogoPath(language, themeStyle), [language, themeStyle])
}

export { getFaviconPath, getLogoPath }
