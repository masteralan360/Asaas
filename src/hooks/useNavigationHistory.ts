import { useCallback, useEffect, useRef, useState } from 'react'
import { parseLangFromHash } from '@/lib/i18nRouting'

const getPath = () => {
    const hash = window.location.hash.replace(/^#/, '') || '/'
    const { path } = parseLangFromHash(hash)
    return path
}

type HistoryEntry = { stack: string[]; index: number }

/**
 * Mirrors the hash-history so the titlebar can render back/forward buttons with
 * correct grayed-out (disabled) states while still delegating actual navigation
 * to the browser history (so the native back/forward keeps working).
 *
 * - `navigate()` pushes a hash -> new entry appended (forward stack truncated)
 * - `history.back()` / `history.forward()` (buttons, keyboard, webview) -> index moved,
 *   located against the mirrored stack.
 */
export function useNavigationHistory() {
    const [entry, setEntry] = useState<HistoryEntry>(() => ({
        stack: [getPath()],
        index: 0,
    }))
    const sawPopRef = useRef(false)
    const scheduledRef = useRef(false)

    const back = useCallback(() => {
        window.history.back()
    }, [])

    const forward = useCallback(() => {
        window.history.forward()
    }, [])

    useEffect(() => {
        let disposed = false

        const reconcile = () => {
            if (disposed) return
            scheduledRef.current = false
            const isPop = sawPopRef.current
            sawPopRef.current = false

            const newLoc = getPath()
            setEntry((prev) => {
                const { stack, index } = prev
                if (stack[index] === newLoc) return prev

                if (isPop) {
                    // Prefer the adjacent entry, then fall back to the closest match.
                    if (index > 0 && stack[index - 1] === newLoc) return { stack, index: index - 1 }
                    if (index + 1 < stack.length && stack[index + 1] === newLoc) return { stack, index: index + 1 }
                    for (let i = index - 1; i >= 0; i--) if (stack[i] === newLoc) return { stack, index: i }
                    for (let i = index + 1; i < stack.length; i++) if (stack[i] === newLoc) return { stack, index: i }
                    return prev
                }

                // Fresh navigation: truncate forward entries, append the new one.
                return { stack: [...stack.slice(0, index + 1), newLoc], index: index + 1 }
            })
        }

        const schedule = () => {
            if (scheduledRef.current) return
            scheduledRef.current = true
            queueMicrotask(reconcile)
        }

        const onPopState = () => {
            sawPopRef.current = true
            schedule()
        }
        const onHashChange = () => schedule()

        window.addEventListener('popstate', onPopState)
        window.addEventListener('hashchange', onHashChange)

        return () => {
            disposed = true
            window.removeEventListener('popstate', onPopState)
            window.removeEventListener('hashchange', onHashChange)
        }
    }, [])

    return {
        canGoBack: entry.index > 0,
        canGoForward: entry.index < entry.stack.length - 1,
        back,
        forward,
    }
}