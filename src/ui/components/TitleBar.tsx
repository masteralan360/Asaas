import { useState, useEffect } from 'react'
import { useLocation } from 'wouter'
import { useWorkspace } from '@/workspace'
import { useTranslation } from 'react-i18next'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { Minus, Square, X, Maximize2, Boxes } from 'lucide-react'
import { cn } from '@/lib/utils'

export function TitleBar() {
    const [location] = useLocation()
    const { workspaceName } = useWorkspace()
    const { t } = useTranslation()
    const [isMaximized, setIsMaximized] = useState(false)
    const [logoError, setLogoError] = useState(false)

    // @ts-ignore
    const isTauri = !!window.__TAURI_INTERNALS__

    // Map routes to module names
    const routeMap: Record<string, string> = {
        '/': t('nav.dashboard'),
        '/pos': t('nav.pos') || 'POS',
        '/sales': t('nav.sales') || 'Sales',
        '/revenue': t('nav.revenue') || 'Net Revenue',
        '/performance': t('nav.performance') || 'Team Performance',
        '/products': t('nav.products'),
        '/customers': t('nav.customers'),
        '/orders': t('nav.orders'),
        '/invoices': t('nav.invoices'),
        '/members': t('members.title'),
        '/settings': t('nav.settings'),
        '/currency-converter': 'Currency Converter',
    }

    const getModuleName = () => {
        for (const [path, name] of Object.entries(routeMap)) {
            if (location === path || (path !== '/' && location.startsWith(path))) {
                return name
            }
        }
        return t('nav.dashboard')
    }

    const title = `IraqCore — ${getModuleName()} | ${workspaceName || 'ERP System'}`

    useEffect(() => {
        if (isTauri) {
            getCurrentWindow().setTitle(title).catch(console.error)

            // Listen for maximize state changes
            const unlisten = getCurrentWindow().onResized(() => {
                getCurrentWindow().isMaximized().then(setIsMaximized).catch(console.error)
            })

            // Check initial state
            getCurrentWindow().isMaximized().then(setIsMaximized).catch(console.error)

            return () => {
                unlisten.then(fn => fn())
            }
        }
    }, [title, isTauri])

    const handleMinimize = () => {
        if (isTauri) getCurrentWindow().minimize()
    }

    const handleMaximize = () => {
        if (isTauri) getCurrentWindow().toggleMaximize()
    }

    const handleClose = () => {
        if (isTauri) getCurrentWindow().close()
    }

    if (!isTauri) return null

    return (
        <>
            <div
                data-tauri-drag-region
                className="fixed top-0 left-0 right-0 z-[100] h-10 flex items-center justify-between select-none bg-background/80 backdrop-blur-md border-b border-border/50"
            >
                {/* Left: Logo & Title */}
                <div data-tauri-drag-region className="flex items-center gap-2 px-3 h-full">
                    <div className="p-1 bg-primary/10 rounded-lg">
                        {!logoError ? (
                            <img
                                src="./logo.png"
                                alt="Logo"
                                className="w-5 h-5 object-contain"
                                onError={() => setLogoError(true)}
                            />
                        ) : (
                            <Boxes className="w-4 h-4 text-primary" />
                        )}
                    </div>
                    <span data-tauri-drag-region className="text-sm font-medium text-foreground/80 truncate max-w-[400px]">
                        {title}
                    </span>
                </div>

                {/* Right: Window Controls */}
                <div className="flex items-center h-full">
                    <button
                        onClick={handleMinimize}
                        className={cn(
                            "h-full w-12 flex items-center justify-center",
                            "hover:bg-muted/50 transition-colors duration-150"
                        )}
                        aria-label="Minimize"
                    >
                        <Minus className="w-4 h-4 text-foreground/70" />
                    </button>
                    <button
                        onClick={handleMaximize}
                        className={cn(
                            "h-full w-12 flex items-center justify-center",
                            "hover:bg-muted/50 transition-colors duration-150"
                        )}
                        aria-label={isMaximized ? "Restore" : "Maximize"}
                    >
                        {isMaximized ? (
                            <Square className="w-3.5 h-3.5 text-foreground/70" />
                        ) : (
                            <Maximize2 className="w-3.5 h-3.5 text-foreground/70" />
                        )}
                    </button>
                    <button
                        onClick={handleClose}
                        className={cn(
                            "h-full w-12 flex items-center justify-center",
                            "hover:bg-red-500 hover:text-white transition-colors duration-150"
                        )}
                        aria-label="Close"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>
            </div>
        </>
    )
}
