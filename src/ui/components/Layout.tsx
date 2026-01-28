import { type ReactNode, Suspense } from 'react'
import { Link, useLocation } from 'wouter'
import { cn } from '@/lib/utils'
import { useAuth } from '@/auth'
import { useWorkspace } from '@/workspace'
import { SyncStatusIndicator } from './SyncStatusIndicator'
import { ExchangeRateIndicator } from './ExchangeRateIndicator'
import { GlobalSearch } from './GlobalSearch'
import { P2PSyncIndicator } from './P2PSyncStatus'
import { p2pSyncManager } from '@/lib/p2pSyncManager'
import { platformService } from '@/services/platformService'
import { whatsappManager } from '@/lib/whatsappWebviewManager'
import { ResourceSyncOverlay } from './p2p/ResourceSyncOverlay'

import {
    LayoutDashboard,
    Package,
    Users,
    ShoppingCart,
    FileText,
    Settings,
    LogOut,
    Menu,
    X,
    Boxes,
    Copy,
    Check,
    UsersRound,
    CreditCard,
    Receipt,
    TrendingUp,
    ChevronLeft,
    ChevronRight,
    BarChart3,
    RotateCw,
    MessageSquare
} from 'lucide-react'
import { useState } from 'react'
import { Button } from './button'
import { useTranslation } from 'react-i18next'
import { useEffect } from 'react'
import { supabase } from '@/auth/supabase'
import { isMobile, isDesktop } from '@/lib/platform'

interface LayoutProps {
    children: ReactNode
}

export function Layout({ children }: LayoutProps) {
    const [location] = useLocation()
    const { user, sessionId, signOut } = useAuth()
    const { hasFeature, workspaceName, isFullscreen, features } = useWorkspace()
    const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
    const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(() => {
        if (typeof window !== 'undefined') {
            return localStorage.getItem('desktop_sidebar_open') !== 'false'
        }
        return true
    })
    const [members, setMembers] = useState<{ id: string, name: string, role: string, profile_url?: string }[]>([])
    const { t } = useTranslation()
    const [logoError, setLogoError] = useState(false)
    const [copied, setCopied] = useState(false)
    const [version, setVersion] = useState('')
    const [isWhatsAppEnabled, setIsWhatsAppEnabled] = useState(whatsappManager.isEnabled())

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }

    useEffect(() => {
        if (!user?.workspaceId) return

        const fetchMembers = async () => {
            const { data, error } = await supabase
                .from('profiles')
                .select('id, name, role, profile_url')
                .eq('workspace_id', user.workspaceId)

            if (!error && data) {
                setMembers(data)
            }
        }

        fetchMembers()

        // Initialize P2P Sync Manager
        if (user?.id && user?.workspaceId) {
            p2pSyncManager.initialize(user.id, user.workspaceId, sessionId).catch(console.error);
        }

        // Fetch App Version
        // @ts-ignore
        if (window.__TAURI_INTERNALS__) {
            import('@tauri-apps/api/app').then(({ getVersion }) => {
                getVersion().then(setVersion).catch(console.error)
            })
        }

        // Handle mobile sidebar trigger from child components
        const handleOpen = () => setMobileSidebarOpen(true)
        window.addEventListener('open-mobile-sidebar', handleOpen)
        window.addEventListener('profile-updated', fetchMembers)

        // Handle WhatsApp enabled state changes from other components
        const handleWhatsAppChange = (e: any) => {
            setIsWhatsAppEnabled(e.detail.enabled);
        }
        window.addEventListener('whatsapp-enabled-change', handleWhatsAppChange);

        return () => {
            window.removeEventListener('open-mobile-sidebar', handleOpen)
            window.removeEventListener('profile-updated', fetchMembers)
            window.removeEventListener('whatsapp-enabled-change', handleWhatsAppChange)
        }
    }, [user?.workspaceId])

    // @ts-ignore
    const isTauri = typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__

    // WhatsApp Webview Global Visibility Sync
    useEffect(() => {
        if (!isTauri) return;

        // If user is NOT on the whatsapp page, ensure the webview is hidden
        // This acts as a global fail-safe during navigation or refreshes
        if (location !== '/whatsapp') {
            whatsappManager.hide().catch(() => { });
        }
    }, [location, isTauri]);

    const navigation = [
        { name: t('nav.dashboard'), href: '/', icon: LayoutDashboard },
        // POS - requires feature flag AND role
        ...((user?.role === 'admin' || user?.role === 'staff') && hasFeature('allow_pos') ? [
            { name: t('nav.pos') || 'POS', href: '/pos', icon: CreditCard }
        ] : []),
        // Sales - always visible (history of transactions)
        { name: t('nav.sales') || 'Sales', href: '/sales', icon: Receipt },
        // Revenue - admin only
        ...(user?.role === 'admin' ? [
            { name: t('nav.revenue') || 'Net Revenue', href: '/revenue', icon: TrendingUp },
            { name: t('nav.performance') || 'Team Performance', href: '/performance', icon: BarChart3 }
        ] : []),
        // WhatsApp - requires feature flag AND role AND desktop platform
        ...((user?.role === 'admin' || user?.role === 'staff') && hasFeature('allow_whatsapp') && isDesktop() ? [
            { name: 'WhatsApp', href: '/whatsapp', icon: MessageSquare }
        ] : []),
        // Products - always visible
        { name: t('nav.products'), href: '/products', icon: Package },
        // Customers - requires feature flag
        ...(hasFeature('allow_customers') ? [
            { name: t('nav.customers'), href: '/customers', icon: Users }
        ] : []),
        // Orders - requires feature flag
        ...(hasFeature('allow_orders') ? [
            { name: t('nav.orders'), href: '/orders', icon: ShoppingCart }
        ] : []),
        // Invoices - requires feature flag
        ...(hasFeature('allow_invoices') ? [
            { name: t('nav.invoices'), href: '/invoices', icon: FileText }
        ] : []),
        // Admin/Staff routes
        ...((user?.role === 'admin' || user?.role === 'staff') ? [
            { name: t('members.title'), href: '/members', icon: UsersRound },
        ] : []),
        ...((user?.role === 'admin' || user?.role === 'staff') ? [
            { name: t('nav.settings'), href: '/settings', icon: Settings }
        ] : []),
    ]

    return (
        <div className="h-screen overflow-hidden bg-transparent">
            <ResourceSyncOverlay />
            {/* Mobile sidebar backdrop */}
            {mobileSidebarOpen && (
                <div
                    className={cn("fixed inset-0 z-40 bg-black/50 lg:hidden", isTauri && "top-[var(--titlebar-height)]")}
                    onClick={() => setMobileSidebarOpen(false)}
                />
            )}

            {/* Sidebar */}
            <aside
                className={cn(
                    'fixed z-50 w-64 transition-transform duration-300 ease-in-out flex flex-col',
                    'glass sidebar-gradient shadow-2xl',
                    isTauri ? 'top-[var(--titlebar-height)] h-[calc(100vh-var(--titlebar-height))]' : 'inset-y-0 h-full',
                    'pt-[var(--safe-area-top)] pb-[var(--safe-area-bottom)]',
                    // Desktop state
                    desktopSidebarOpen ? 'lg:translate-x-0 lg:rtl:translate-x-0' : 'lg:-translate-x-full lg:rtl:translate-x-full',
                    // Positioning
                    'left-0 rtl:left-auto rtl:right-0',
                    'border-r rtl:border-r-0 rtl:border-l border-border',
                    // Mobile state
                    mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full rtl:translate-x-full'
                )}
            >
                {/* Logo */}
                <div className="flex items-center gap-3 px-6 py-5 border-b border-border">
                    <div className="p-2 bg-primary/10 rounded-xl">
                        {features.logo_url ? (
                            <img
                                src={features.logo_url.startsWith('http') ? features.logo_url : platformService.convertFileSrc(features.logo_url)}
                                alt="Workspace Logo"
                                className="w-8 h-8 object-contain"
                                onError={() => setLogoError(true)}
                            />
                        ) : !logoError ? (
                            <img
                                src="./logo.png"
                                alt="Logo"
                                className="w-8 h-8 object-contain"
                                onError={() => setLogoError(true)}
                            />
                        ) : (
                            <Boxes className="w-6 h-6 text-primary" />
                        )}
                    </div>
                    <div>
                        <h1 className="text-lg font-bold gradient-text">{workspaceName || 'ERP System'}</h1>
                        <p className="text-xs text-muted-foreground">Workspace</p>
                    </div>
                    <button
                        className="ms-auto lg:hidden"
                        onClick={() => setMobileSidebarOpen(false)}
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Navigation */}
                <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto custom-scrollbar">
                    {navigation.map((item) => {
                        const isActive = location === item.href ||
                            (item.href !== '/' && location.startsWith(item.href))
                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                onClick={() => setMobileSidebarOpen(false)}
                            >
                                <span
                                    className={cn(
                                        'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-300',
                                        isActive
                                            ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/30 scale-[1.02]'
                                            : 'text-muted-foreground hover:bg-primary/5 hover:text-primary'
                                    )}
                                >
                                    <item.icon className="w-5 h-5" />
                                    {item.name}
                                </span>
                            </Link>
                        )
                    })}

                    {/* Workspace Members Section */}
                    {(user?.role === 'admin' || user?.role === 'staff') && (
                        <div className="pt-6 pb-2">
                            <h2 className="px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                                {t('auth.members')}
                            </h2>

                            {/* Workspace Code */}
                            {user?.workspaceCode && (
                                <div
                                    className="mx-3 mb-4 p-2.5 bg-secondary/30 rounded-lg border border-border group hover:border-primary/50 transition-all cursor-pointer relative overflow-hidden"
                                    onClick={() => copyToClipboard(user.workspaceCode)}
                                >
                                    <div className="relative z-10">
                                        <p className="text-[10px] text-muted-foreground uppercase font-bold mb-1 flex items-center justify-between">
                                            {t('auth.workspaceCode')}
                                            {copied ? (
                                                <span className="flex items-center gap-1 text-emerald-500 animate-in fade-in zoom-in duration-300">
                                                    <Check className="w-3 h-3" />
                                                    {t('auth.copied')}
                                                </span>
                                            ) : (
                                                <Copy className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-all" />
                                            )}
                                        </p>
                                        <p className="text-sm font-mono font-bold tracking-wider">{user.workspaceCode}</p>
                                    </div>
                                    <div className="absolute inset-0 bg-primary/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                                </div>
                            )}

                            <div className="px-3 space-y-3">
                                {members.map((member) => {
                                    // Use dynamic user profile for the current user to ensure immediate updates
                                    const profileUrl = member.id === user?.id && user?.profileUrl
                                        ? user.profileUrl
                                        : member.profile_url;

                                    return (
                                        <div key={member.id} className="flex items-center gap-3">
                                            <div className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center text-xs font-medium overflow-hidden">
                                                {profileUrl ? (
                                                    <img
                                                        src={platformService.convertFileSrc(profileUrl)}
                                                        alt={member.name}
                                                        className="w-full h-full object-cover"
                                                    />
                                                ) : (
                                                    member.name?.charAt(0).toUpperCase() || 'M'
                                                )}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-medium truncate">{member.name}</p>
                                                <p className="text-[10px] text-muted-foreground capitalize">{member.role}</p>
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                    )}
                </nav>

                <div className="p-4 border-t border-border bg-background/50 backdrop-blur-md shrink-0">
                    <div className="flex items-center gap-3 px-3 py-2">
                        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary to-purple-600 flex items-center justify-center text-sm font-bold text-white overflow-hidden shadow-sm">
                            {user?.profileUrl ? (
                                <img
                                    src={user.profileUrl.startsWith('http') ? user.profileUrl : platformService.convertFileSrc(user.profileUrl)}
                                    alt={user.name}
                                    className="w-full h-full object-cover"
                                />
                            ) : (
                                user?.name?.charAt(0).toUpperCase() || 'U'
                            )}
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate text-start">{user?.name}</p>
                            <p className="text-xs text-muted-foreground capitalize text-start">{user?.role}</p>
                        </div>
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={signOut}
                            className="text-muted-foreground hover:text-destructive"
                        >
                            <LogOut className="w-4 h-4" />
                        </Button>
                    </div>
                    {/* Version Display */}
                    <div className="mt-2 text-center">
                        <p className="text-[10px] text-muted-foreground font-mono opacity-50">
                            v{version}
                        </p>
                    </div>
                </div>
            </aside>

            {/* Main content Scroll Container */}
            <div className={cn(
                "h-full bg-background transition-[padding] duration-300 ease-in-out flex flex-col overflow-hidden",
                isTauri && "mt-[var(--titlebar-height)] h-[calc(100vh-var(--titlebar-height))]",
                desktopSidebarOpen ? "lg:pl-64 lg:rtl:pl-0 lg:rtl:pr-64" : "lg:pl-0",
                "pb-[var(--safe-area-bottom)]"
            )}>
                {/* Top bar */}
                <header className={cn(
                    "flex-shrink-0 z-30 flex items-center gap-4 px-4 py-3 bg-background/60 backdrop-blur-xl border-b border-border/50",
                    "pt-[calc(0.75rem+var(--safe-area-top))]",
                    location === '/pos' && "hidden lg:flex" // Hide on mobile if POS
                )}>
                    {/* Mobile Toggle */}
                    <button
                        className="lg:hidden p-2 -ms-2 rounded-lg hover:bg-secondary"
                        onClick={() => setMobileSidebarOpen(true)}
                    >
                        <Menu className="w-5 h-5" />
                    </button>

                    {/* Desktop Toggle */}
                    <button
                        className="hidden lg:block p-2 -ms-2 rounded-lg hover:bg-secondary"
                        onClick={() => {
                            const newState = !desktopSidebarOpen
                            setDesktopSidebarOpen(newState)
                            localStorage.setItem('desktop_sidebar_open', String(newState))
                        }}
                    >
                        {desktopSidebarOpen ? (
                            <ChevronLeft className="w-5 h-5" />
                        ) : (
                            <ChevronRight className="w-5 h-5" />
                        )}
                    </button>

                    <div className="flex-1 flex justify-center px-4">
                        {(!isTauri || isFullscreen) && (
                            <GlobalSearch className="max-w-[500px] animate-in fade-in slide-in-from-top-2 duration-300" />
                        )}
                    </div>

                    <div className="flex items-center gap-3">
                        {isTauri && location === '/whatsapp' && (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => whatsappManager.setEnabled(!whatsappManager.isEnabled())}
                                className={cn(
                                    "h-8 px-2 gap-2 border-border/50 hover:bg-secondary/50 transition-all duration-300",
                                    isWhatsAppEnabled ? "text-emerald-500" : "text-red-500"
                                )}
                                title={isWhatsAppEnabled ? "Turn Off WhatsApp Webview" : "Turn On WhatsApp Webview"}
                            >
                                <div className={cn(
                                    "w-2 h-2 rounded-full",
                                    isWhatsAppEnabled ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-red-500"
                                )} />
                                <MessageSquare className="w-4 h-4" />
                                <span className="text-[10px] font-bold uppercase tracking-wider hidden sm:inline">
                                    {isWhatsAppEnabled ? "Live" : "Off"}
                                </span>
                            </Button>
                        )}
                        <P2PSyncIndicator />
                        <ExchangeRateIndicator />
                        <div className="w-px h-4 bg-border mx-1" />
                        <SyncStatusIndicator />

                        {/* Refresh Button - Only for non-Tauri or Mobile where TitleBar is absent */}
                        {(!isTauri || isMobile()) && (
                            <button
                                onClick={() => window.location.reload()}
                                className="p-2 hover:bg-secondary rounded-full text-muted-foreground transition-colors"
                                title="Refresh"
                            >
                                <RotateCw className="w-4 h-4" />
                            </button>
                        )}
                    </div>
                </header>

                {/* Page content */}
                <main className={cn(
                    "page-enter flex-1 min-h-0",
                    location === '/whatsapp' ? "p-0" : "p-4 lg:p-6 overflow-y-auto custom-scrollbar"
                )}>
                    <Suspense fallback={<PageLoading />}>
                        {children}
                    </Suspense>
                </main>
            </div>
        </div>
    )
}

function PageLoading() {
    return (
        <div className="flex flex-col items-center justify-center py-12 gap-4">
            <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-muted-foreground animate-pulse font-medium">Loading Page...</p>
        </div>
    )
}
