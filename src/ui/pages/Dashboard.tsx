import { useDashboardStats } from '@/local-db'
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/components'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Package, Users, ShoppingCart, FileText, TrendingUp, AlertTriangle } from 'lucide-react'
import { Link } from 'wouter'
import { useTranslation } from 'react-i18next'

export function Dashboard() {
    const stats = useDashboardStats()
    const { t } = useTranslation()

    const statCards = [
        {
            title: t('dashboard.totalProducts') || 'Total Products',
            value: stats.productCount,
            icon: Package,
            color: 'text-blue-500',
            bgColor: 'bg-blue-500/10',
            href: '/products'
        },
        {
            title: t('dashboard.totalCustomers'),
            value: stats.customerCount,
            icon: Users,
            color: 'text-emerald-500',
            bgColor: 'bg-emerald-500/10',
            href: '/customers'
        },
        {
            title: t('dashboard.totalOrders') || 'Total Orders',
            value: stats.orderCount,
            icon: ShoppingCart,
            color: 'text-purple-500',
            bgColor: 'bg-purple-500/10',
            href: '/orders'
        },
        {
            title: t('dashboard.totalRevenue'),
            value: formatCurrency(stats.totalRevenue),
            icon: TrendingUp,
            color: 'text-amber-500',
            bgColor: 'bg-amber-500/10',
            href: '/invoices'
        }
    ]

    return (
        <div className="space-y-6">
            {/* Page Header */}
            <div>
                <h1 className="text-2xl font-bold">{t('dashboard.title')}</h1>
                <p className="text-muted-foreground">{t('dashboard.subtitle') || 'Overview of your business metrics'}</p>
            </div>

            {/* Stats Grid */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                {statCards.map((stat) => (
                    <Link key={stat.title} href={stat.href}>
                        <Card className="cursor-pointer card-hover">
                            <CardHeader className="flex flex-row items-center justify-between pb-2">
                                <CardTitle className="text-sm font-medium text-muted-foreground">
                                    {stat.title}
                                </CardTitle>
                                <div className={`p-2 rounded-lg ${stat.bgColor}`}>
                                    <stat.icon className={`w-4 h-4 ${stat.color}`} />
                                </div>
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">{stat.value}</div>
                            </CardContent>
                        </Card>
                    </Link>
                ))}
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
                {/* Recent Orders */}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <ShoppingCart className="w-5 h-5 text-primary" />
                            {t('dashboard.recentOrders') || 'Recent Orders'}
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        {stats.recentOrders.length === 0 ? (
                            <p className="text-sm text-muted-foreground text-center py-4">
                                {t('common.noData') || 'No orders yet'}
                            </p>
                        ) : (
                            <div className="space-y-3">
                                {stats.recentOrders.map((order) => (
                                    <div
                                        key={order.id}
                                        className="flex items-center justify-between p-3 rounded-lg bg-secondary/50"
                                    >
                                        <div>
                                            <p className="font-medium">{order.orderNumber}</p>
                                            <p className="text-sm text-muted-foreground">{order.customerName}</p>
                                        </div>
                                        <div className="text-right">
                                            <p className="font-medium">{formatCurrency(order.total)}</p>
                                            <p className="text-xs text-muted-foreground">
                                                {formatDate(order.createdAt)}
                                            </p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Low Stock Alert */}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <AlertTriangle className="w-5 h-5 text-amber-500" />
                            {t('dashboard.lowStock')}
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        {stats.lowStockProducts.length === 0 ? (
                            <p className="text-sm text-muted-foreground text-center py-4">
                                All products are well stocked
                            </p>
                        ) : (
                            <div className="space-y-3">
                                {stats.lowStockProducts.slice(0, 5).map((product) => (
                                    <div
                                        key={product.id}
                                        className="flex items-center justify-between p-3 rounded-lg bg-amber-500/10"
                                    >
                                        <div>
                                            <p className="font-medium">{product.name}</p>
                                            <p className="text-sm text-muted-foreground">SKU: {product.sku}</p>
                                        </div>
                                        <div className="text-right">
                                            <p className="font-bold text-amber-500">
                                                {product.quantity} / {product.minStockLevel}
                                            </p>
                                            <p className="text-xs text-muted-foreground">{product.unit}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Pending Invoices */}
                <Card className="lg:col-span-2">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <FileText className="w-5 h-5 text-primary" />
                            {t('dashboard.pendingInvoices') || 'Pending Invoices'}
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        {stats.pendingInvoices.length === 0 ? (
                            <p className="text-sm text-muted-foreground text-center py-4">
                                No pending invoices
                            </p>
                        ) : (
                            <div className="grid gap-3 md:grid-cols-2">
                                {stats.pendingInvoices.slice(0, 4).map((invoice) => (
                                    <div
                                        key={invoice.id}
                                        className="flex items-center justify-between p-3 rounded-lg bg-secondary/50"
                                    >
                                        <div>
                                            <p className="font-medium">{invoice.invoiceNumber}</p>
                                            <p className="text-sm text-muted-foreground">{invoice.customerName}</p>
                                        </div>
                                        <div className="text-right">
                                            <p className="font-medium">{formatCurrency(invoice.total)}</p>
                                            <p className={`text-xs ${invoice.status === 'overdue' ? 'text-red-500' : 'text-muted-foreground'
                                                }`}>
                                                Due: {formatDate(invoice.dueDate)}
                                            </p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
