import { useCallback, useDeferredValue, useEffect, useRef, useState, type RefObject } from 'react'
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

const MATCH_HIGHLIGHT_NAME = 'atlas-page-find-match'
const ACTIVE_MATCH_HIGHLIGHT_NAME = 'atlas-page-find-active-match'
const EXCLUDED_TEXT_PARENTS = new Set([
    'BUTTON',
    'INPUT',
    'NOSCRIPT',
    'OPTION',
    'SCRIPT',
    'SELECT',
    'STYLE',
    'TEXTAREA',
])

interface PageFindProps {
    contentRef: RefObject<HTMLElement>
}

function supportsCssHighlights() {
    return typeof CSS !== 'undefined'
        && typeof Highlight !== 'undefined'
        && 'highlights' in CSS
}

function clearHighlights() {
    if (!supportsCssHighlights()) return

    CSS.highlights.delete(MATCH_HIGHLIGHT_NAME)
    CSS.highlights.delete(ACTIVE_MATCH_HIGHLIGHT_NAME)
}

function getTextMatches(root: HTMLElement, query: string): Range[] {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    if (!normalizedQuery) return []

    const matches: Range[] = []
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
            const parent = node.parentElement
            if (
                !parent
                || EXCLUDED_TEXT_PARENTS.has(parent.tagName)
                || parent.closest('[aria-hidden="true"], .sr-only, [data-page-find-ignore]')
                || !node.textContent?.trim()
            ) {
                return NodeFilter.FILTER_REJECT
            }

            const styles = window.getComputedStyle(parent)
            return styles.display === 'none' || styles.visibility === 'hidden'
                ? NodeFilter.FILTER_REJECT
                : NodeFilter.FILTER_ACCEPT
        },
    })

    let node = walker.nextNode()
    while (node) {
        const text = node.textContent ?? ''
        const normalizedText = text.toLocaleLowerCase()
        let matchIndex = normalizedText.indexOf(normalizedQuery)

        while (matchIndex !== -1) {
            const range = document.createRange()
            range.setStart(node, matchIndex)
            range.setEnd(node, matchIndex + normalizedQuery.length)
            matches.push(range)
            matchIndex = normalizedText.indexOf(normalizedQuery, matchIndex + normalizedQuery.length)
        }

        node = walker.nextNode()
    }

    return matches
}

function getRangeElement(range: Range) {
    return range.startContainer.nodeType === Node.ELEMENT_NODE
        ? range.startContainer as HTMLElement
        : range.startContainer.parentElement
}

export function PageFind({ contentRef }: PageFindProps) {
    const { t } = useTranslation()
    const [isOpen, setIsOpen] = useState(false)
    const [query, setQuery] = useState('')
    const [matches, setMatches] = useState<Range[]>([])
    const [activeMatchIndex, setActiveMatchIndex] = useState(0)
    const [contentVersion, setContentVersion] = useState(0)
    const inputRef = useRef<HTMLInputElement>(null)
    const deferredQuery = useDeferredValue(query)

    const close = useCallback(() => {
        clearHighlights()
        setIsOpen(false)
        setQuery('')
        setMatches([])
        setActiveMatchIndex(0)
    }, [])

    const focusSearch = useCallback(() => {
        setIsOpen(true)
        requestAnimationFrame(() => {
            inputRef.current?.focus()
            inputRef.current?.select()
        })
    }, [])

    const moveToMatch = useCallback((direction: 1 | -1) => {
        if (matches.length === 0) return

        setActiveMatchIndex((currentIndex) => (
            (currentIndex + direction + matches.length) % matches.length
        ))
    }, [matches.length])

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'f') {
                event.preventDefault()
                focusSearch()
                return
            }

            if (event.key === 'Escape' && isOpen) {
                event.preventDefault()
                close()
            }
        }

        // Capture the shortcut before the browser can open its native find UI.
        window.addEventListener('keydown', handleKeyDown, { capture: true })
        return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
    }, [close, focusSearch, isOpen])

    useEffect(() => {
        clearHighlights()

        if (!isOpen || !deferredQuery.trim() || !contentRef.current) {
            setMatches([])
            return
        }

        const nextMatches = getTextMatches(contentRef.current, deferredQuery)
        if (supportsCssHighlights()) {
            CSS.highlights.set(MATCH_HIGHLIGHT_NAME, new Highlight(...nextMatches))
        }

        setMatches(nextMatches)
        setActiveMatchIndex((currentIndex) => Math.min(currentIndex, Math.max(nextMatches.length - 1, 0)))

        return clearHighlights
    }, [contentRef, contentVersion, deferredQuery, isOpen])

    useEffect(() => {
        if (!isOpen || !deferredQuery.trim() || !contentRef.current) return

        let frameId: number | undefined
        const observer = new MutationObserver(() => {
            if (frameId !== undefined) cancelAnimationFrame(frameId)
            frameId = requestAnimationFrame(() => setContentVersion((version) => version + 1))
        })

        observer.observe(contentRef.current, {
            childList: true,
            characterData: true,
            subtree: true,
        })

        return () => {
            observer.disconnect()
            if (frameId !== undefined) cancelAnimationFrame(frameId)
        }
    }, [contentRef, deferredQuery, isOpen])

    useEffect(() => {
        const activeMatch = matches[activeMatchIndex]
        if (!activeMatch) return

        if (supportsCssHighlights()) {
            CSS.highlights.delete(ACTIVE_MATCH_HIGHLIGHT_NAME)
            CSS.highlights.set(ACTIVE_MATCH_HIGHLIGHT_NAME, new Highlight(activeMatch))
        }
        getRangeElement(activeMatch)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, [activeMatchIndex, matches])

    useEffect(() => clearHighlights, [])

    if (!isOpen) return null

    const hasQuery = query.trim().length > 0
    const hasMatches = matches.length > 0
    const isSearching = query !== deferredQuery

    return (
        <form
            role="search"
            aria-label={t('pageFind.label', { defaultValue: 'Find in this page' })}
            onSubmit={(event) => {
                event.preventDefault()
                moveToMatch(1)
            }}
            className={cn(
                'fixed right-3 top-[calc(var(--titlebar-height)+0.75rem)] z-[300] flex w-[min(28rem,calc(100vw-1.5rem))] items-center gap-1.5 rounded-2xl border border-border/70 bg-background/95 p-1.5 shadow-2xl backdrop-blur-xl',
                'animate-in fade-in slide-in-from-top-2 duration-150 rtl:right-auto rtl:left-3',
            )}
        >
            <Search aria-hidden="true" className="ml-2 h-4 w-4 shrink-0 text-muted-foreground rtl:ml-0 rtl:mr-2" />
            <input
                ref={inputRef}
                type="search"
                value={query}
                onChange={(event) => {
                    setQuery(event.target.value)
                    setActiveMatchIndex(0)
                }}
                onKeyDown={(event) => {
                    if (event.key === 'ArrowDown') {
                        event.preventDefault()
                        moveToMatch(1)
                    } else if (event.key === 'ArrowUp') {
                        event.preventDefault()
                        moveToMatch(-1)
                    } else if (event.key === 'Enter' && event.shiftKey) {
                        event.preventDefault()
                        moveToMatch(-1)
                    }
                }}
                placeholder={t('pageFind.placeholder', { defaultValue: 'Search this page...' })}
                aria-label={t('pageFind.placeholder', { defaultValue: 'Search this page...' })}
                className="h-9 min-w-0 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground"
                spellCheck={false}
                autoComplete="off"
            />
            {hasQuery && (
                <span
                    role="status"
                    aria-live="polite"
                    className="min-w-12 whitespace-nowrap text-center text-xs tabular-nums text-muted-foreground"
                >
                    {isSearching
                        ? '…'
                        : hasMatches
                        ? `${activeMatchIndex + 1}/${matches.length}`
                        : t('pageFind.noResults', { defaultValue: 'No results' })}
                </span>
            )}
            <button
                type="button"
                onClick={() => moveToMatch(-1)}
                disabled={!hasMatches || isSearching}
                aria-label={t('pageFind.previous', { defaultValue: 'Previous match' })}
                className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:pointer-events-none disabled:opacity-35"
            >
                <ChevronUp className="h-4 w-4" />
            </button>
            <button
                type="submit"
                disabled={!hasMatches || isSearching}
                aria-label={t('pageFind.next', { defaultValue: 'Next match' })}
                className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:pointer-events-none disabled:opacity-35"
            >
                <ChevronDown className="h-4 w-4" />
            </button>
            <button
                type="button"
                onClick={close}
                aria-label={t('common.close', { defaultValue: 'Close' })}
                className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
                <X className="h-4 w-4" />
            </button>
        </form>
    )
}
