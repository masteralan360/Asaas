import { type ReactNode } from 'react'
import { Link, useLocation } from 'wouter'
import { cn } from '@/lib/utils'
import { useAuth } from '@/auth'
import { SyncStatusIndicator } from './SyncStatusIndicator'
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
    Boxes
} from 'lucide-react'
import { useState } from 'react'
import { Button } from './button'
import { useTranslation } from 'react-i18next'

interface LayoutProps {
    children: ReactNode
}

export function Layout({ children }: LayoutProps) {
    const [location] = useLocation()
    const { user, signOut } = useAuth()
    const [sidebarOpen, setSidebarOpen] = useState(false)
    const { t } = useTranslation()
    const [logoError, setLogoError] = useState(false)

    const navigation = [
        { name: t('nav.dashboard'), href: '/', icon: LayoutDashboard },
        { name: t('nav.products'), href: '/products', icon: Package },
        { name: t('nav.customers'), href: '/customers', icon: Users },
        { name: t('nav.orders'), href: '/orders', icon: ShoppingCart },
        { name: t('nav.invoices'), href: '/invoices', icon: FileText },
        ...(user?.role === 'admin' ? [{ name: t('nav.settings'), href: '/settings', icon: Settings }] : []),
    ]

    return (
        <div className="min-h-screen bg-background">
            {/* Mobile sidebar backdrop */}
            {sidebarOpen && (
                <div
                    className="fixed inset-0 z-40 bg-black/50 lg:hidden"
                    onClick={() => setSidebarOpen(false)}
                />
            )}

            {/* Sidebar */}
            <aside
                className={cn(
                    'fixed inset-y-0 z-50 w-64 bg-card transform transition-transform duration-300 ease-in-out',
                    // Desktop: always show (ltr:translate-x-0, rtl:translate-x-0)
                    'lg:translate-x-0 lg:rtl:translate-x-0',
                    // Positioning
                    'left-0 rtl:left-auto rtl:right-0',
                    'border-r rtl:border-r-0 rtl:border-l border-border',
                    // Mobile state handling
                    sidebarOpen ? 'translate-x-0' : '-translate-x-full rtl:translate-x-full'
                )}
            >
                {/* Logo */}
                <div className="flex items-center gap-3 px-6 py-5 border-b border-border">
                    <div className="p-2 bg-primary/10 rounded-lg">
                        {!logoError ? (
                            <img
                                src="/logo.png"
                                alt="Logo"
                                className="w-8 h-8 object-contain"
                                onError={() => setLogoError(true)}
                            />
                        ) : (
                            <Boxes className="w-6 h-6 text-primary" />
                        )}
                    </div>
                    <div>
                        <h1 className="text-lg font-bold gradient-text">ERP System</h1>
                        <p className="text-xs text-muted-foreground">Offline-First</p>
                    </div>
                    <button
                        className="ms-auto lg:hidden"
                        onClick={() => setSidebarOpen(false)}
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Navigation */}
                <nav className="flex-1 px-3 py-4 space-y-1">
                    {navigation.map((item) => {
                        const isActive = location === item.href ||
                            (item.href !== '/' && location.startsWith(item.href))
                        return (
                            <Link
                                key={item.href}
                                href={item.href}
                                onClick={() => setSidebarOpen(false)}
                            >
                                <span
                                    className={cn(
                                        'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all',
                                        isActive
                                            ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/25'
                                            : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                                    )}
                                >
                                    <item.icon className="w-5 h-5" />
                                    {item.name}
                                </span>
                            </Link>
                        )
                    })}
                </nav>

                {/* User info */}
                <div className="p-4 border-t border-border">
                    <div className="flex items-center gap-3 px-3 py-2">
                        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary to-purple-600 flex items-center justify-center text-sm font-bold text-white">
                            {user?.name?.charAt(0).toUpperCase() || 'U'}
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
                </div>
            </aside>

            {/* Main content */}
            <div className="lg:pl-64 lg:rtl:pl-0 lg:rtl:pr-64 transition-[padding] duration-300 ease-in-out">
                {/* Top bar */}
                <header className="sticky top-0 z-30 flex items-center gap-4 px-4 py-3 bg-background/80 backdrop-blur-lg border-b border-border">
                    <button
                        className="lg:hidden p-2 -ms-2 rounded-lg hover:bg-secondary"
                        onClick={() => setSidebarOpen(true)}
                    >
                        <Menu className="w-5 h-5" />
                    </button>

                    <div className="flex-1" />

                    <SyncStatusIndicator />
                </header>

                {/* Page content */}
                <main className="p-4 lg:p-6">
                    {children}
                </main>
            </div>
        </div>
    )
}
