import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
    usePurchaseOrders, createPurchaseOrder, updatePurchaseOrder,
    useSalesOrders, createSalesOrder, updateSalesOrder,
    useSuppliers, useCustomers,
    type PurchaseOrder, type SalesOrder
} from '@/local-db'
import { useWorkspace } from '@/workspace'
import { Button } from '@/ui/components/button'
import { ShoppingBag, Search, Plus, Eye, Truck } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/components/card'
import { Input } from '@/ui/components/input'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/ui/components/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/components/table'
import { OrderDialog } from '@/ui/components/orders/OrderDialog'
import { cn, formatCurrency, formatDate } from '@/lib/utils'

// Checking badge... if not exists, I'll allow simple styling.
// I'll check 'badge.tsx' in simple list earlier? No badge in Step 267 list. 
// I'll stick to span with generic classes.

export default function Orders() {
    const { t } = useTranslation()
    const { activeWorkspace } = useWorkspace()
    const purchaseOrders = usePurchaseOrders(activeWorkspace?.id)
    const salesOrders = useSalesOrders(activeWorkspace?.id)
    const suppliers = useSuppliers(activeWorkspace?.id)
    const customers = useCustomers(activeWorkspace?.id)

    const [activeTab, setActiveTab] = useState<'sales' | 'purchase'>('sales')
    const [searchSales, setSearchSales] = useState('')
    const [searchPurchase, setSearchPurchase] = useState('')
    const [isDialogOpen, setIsDialogOpen] = useState(false)
    const [editingOrder, setEditingOrder] = useState<PurchaseOrder | SalesOrder | undefined>(undefined)

    // Handlers
    const handleCreate = async (data: any) => {
        if (!activeWorkspace) return
        if (activeTab === 'purchase') {
            await createPurchaseOrder(activeWorkspace.id, data)
        } else {
            await createSalesOrder(activeWorkspace.id, data)
        }
    }

    const handleUpdate = async (data: any) => {
        if (!editingOrder) return
        if (activeTab === 'purchase') {
            await updatePurchaseOrder(editingOrder.id, data)
        } else {
            await updateSalesOrder(editingOrder.id, data)
        }
    }

    const openCreateDialog = () => {
        setEditingOrder(undefined)
        setIsDialogOpen(true)
    }

    const openEditDialog = (order: PurchaseOrder | SalesOrder) => {
        setEditingOrder(order)
        setIsDialogOpen(true) // The dialog supports switching mode via props, but we should make sure it matches activeTab
    }

    // Helper functions
    const getEntityName = (id: string, type: 'sales' | 'purchase') => {
        if (type === 'purchase') {
            return suppliers.find(s => s.id === id)?.name || t('common.unknownSupplier', 'Unknown Supplier')
        }
        return customers.find(c => c.id === id)?.name || t('common.unknownCustomer', 'Unknown Customer')
    }

    const filteredSalesOrders = salesOrders.filter(o =>
        o.orderNumber.toLowerCase().includes(searchSales.toLowerCase()) ||
        getEntityName(o.customerId, 'sales').toLowerCase().includes(searchSales.toLowerCase())
    )

    const filteredPurchaseOrders = purchaseOrders.filter(o =>
        o.orderNumber.toLowerCase().includes(searchPurchase.toLowerCase()) ||
        getEntityName(o.supplierId, 'purchase').toLowerCase().includes(searchPurchase.toLowerCase())
    )

    const { features } = useWorkspace()



    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <ShoppingBag className="w-6 h-6 text-primary" />
                        {t('orders.title', 'Orders')}
                    </h1>
                    <p className="text-muted-foreground">{t('orders.subtitle', 'Manage sales and purchase orders.')}</p>
                </div>
                <Button onClick={openCreateDialog} className="rounded-xl shadow-lg transition-all active:scale-95">
                    <Plus className="mr-2 h-4 w-4" /> {t('orders.newOrder', 'New Order')}
                </Button>
            </div>

            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="w-full">
                <TabsList className="grid w-full grid-cols-2 max-w-[400px] p-1 bg-muted/50 rounded-xl">
                    <TabsTrigger value="sales" className="rounded-lg font-bold transition-all data-[state=active]:bg-card data-[state=active]:shadow-sm">
                        {t('orders.tabs.sales', 'Sales Orders')}
                    </TabsTrigger>
                    <TabsTrigger value="purchase" className="rounded-lg font-bold transition-all data-[state=active]:bg-card data-[state=active]:shadow-sm">
                        {t('orders.tabs.purchase', 'Purchase Orders')}
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="sales" className="space-y-4 mt-6">
                    <div className="flex items-center justify-between gap-4">
                        <div className="relative w-full max-w-sm">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder={t('orders.searchSales', 'Search sales orders...')}
                                value={searchSales}
                                onChange={(e) => setSearchSales(e.target.value)}
                                className="pl-10 rounded-xl bg-card border-none shadow-sm focus-visible:ring-1 focus-visible:ring-primary/50 transition-all"
                            />
                        </div>
                    </div>

                    <Card className="rounded-2xl overflow-hidden border-2 shadow-sm">
                        <CardHeader className="bg-muted/30 border-b">
                            <CardTitle className="text-lg font-bold flex items-center gap-2">
                                <ShoppingBag className="w-5 h-5 text-primary/70" />
                                {t('orders.salesList', 'Sales Orders List')}
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="p-0">
                            <Table>
                                <TableHeader className="bg-muted/20">
                                    <TableRow className="hover:bg-transparent border-b">
                                        <TableHead className="font-bold py-4 pl-6 text-primary/80">{t('orders.table.orderNo', 'Order #')}</TableHead>
                                        <TableHead className="font-bold">{t('orders.table.customer', 'Customer')}</TableHead>
                                        <TableHead className="font-bold">{t('orders.table.date', 'Date')}</TableHead>
                                        <TableHead className="font-bold">{t('orders.table.total', 'Total')}</TableHead>
                                        <TableHead className="font-bold text-center">{t('orders.table.status', 'Status')}</TableHead>
                                        <TableHead className="text-right font-bold pr-6">{t('common.actions', 'Actions')}</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {filteredSalesOrders.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={6} className="h-48 text-center bg-muted/5">
                                                <div className="flex flex-col items-center justify-center gap-2 opacity-30">
                                                    <ShoppingBag className="w-12 h-12" />
                                                    <p className="text-sm font-medium">{t('common.noData', 'No results found.')}</p>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        filteredSalesOrders.map((order) => (
                                            <TableRow key={order.id} className="group hover:bg-muted/30 transition-colors border-b last:border-0 text-foreground/80">
                                                <TableCell className="font-mono font-bold pl-6 text-primary">{order.orderNumber}</TableCell>
                                                <TableCell className="font-bold text-foreground">{order.customerName || t('common.unnamed', 'Unnamed')}</TableCell>
                                                <TableCell className="text-xs">{formatDate(order.createdAt)}</TableCell>
                                                <TableCell className="font-black tabular-nums">{formatCurrency(order.total, order.currency, features.iqd_display_preference)}</TableCell>
                                                <TableCell className="text-center">
                                                    <span className={cn(
                                                        "px-2 py-0.5 rounded-lg text-[9px] font-bold uppercase tracking-widest border",
                                                        order.status === 'delivered' ? "bg-green-500/10 text-green-600 border-green-500/20" :
                                                            order.status === 'pending' ? "bg-orange-500/10 text-orange-600 border-orange-500/20" :
                                                                "bg-muted text-muted-foreground border-border"
                                                    )}>
                                                        {t(`orders.status.${order.status}`, order.status)}
                                                    </span>
                                                </TableCell>
                                                <TableCell className="text-right pr-6">
                                                    <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl hover:bg-primary/10 hover:text-primary transition-all" onClick={() => openEditDialog(order)}>
                                                        <Eye className="h-4 w-4" />
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="purchase" className="space-y-4 mt-6">
                    <div className="flex items-center justify-between gap-4">
                        <div className="relative w-full max-w-sm">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder={t('orders.searchPurchase', 'Search purchase orders...')}
                                value={searchPurchase}
                                onChange={(e) => setSearchPurchase(e.target.value)}
                                className="pl-10 rounded-xl bg-card border-none shadow-sm focus-visible:ring-1 focus-visible:ring-primary/50 transition-all"
                            />
                        </div>
                    </div>

                    <Card className="rounded-2xl overflow-hidden border-2 shadow-sm">
                        <CardHeader className="bg-muted/30 border-b">
                            <CardTitle className="text-lg font-bold flex items-center gap-2">
                                <Truck className="w-5 h-5 text-primary/70" />
                                {t('orders.purchaseList', 'Purchase Orders List')}
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="p-0">
                            <Table>
                                <TableHeader className="bg-muted/20">
                                    <TableRow className="hover:bg-transparent border-b">
                                        <TableHead className="font-bold py-4 pl-6 text-primary/80">{t('orders.table.orderNo', 'Order #')}</TableHead>
                                        <TableHead className="font-bold">{t('orders.table.customer', 'Supplier')}</TableHead>
                                        <TableHead className="font-bold">{t('orders.table.date', 'Date')}</TableHead>
                                        <TableHead className="font-bold">{t('orders.table.total', 'Total')}</TableHead>
                                        <TableHead className="font-bold text-center">{t('orders.table.status', 'Status')}</TableHead>
                                        <TableHead className="text-right font-bold pr-6">{t('common.actions', 'Actions')}</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {filteredPurchaseOrders.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={6} className="h-48 text-center bg-muted/5">
                                                <div className="flex flex-col items-center justify-center gap-2 opacity-30">
                                                    <Truck className="w-12 h-12" />
                                                    <p className="text-sm font-medium">{t('common.noData', 'No results found.')}</p>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        filteredPurchaseOrders.map((order) => (
                                            <TableRow key={order.id} className="group hover:bg-muted/30 transition-colors border-b last:border-0 text-foreground/80">
                                                <TableCell className="font-mono font-bold pl-6 text-primary">{order.orderNumber}</TableCell>
                                                <TableCell className="font-bold text-foreground">{order.supplierName || t('common.unnamed', 'Unnamed')}</TableCell>
                                                <TableCell className="text-xs">{formatDate(order.createdAt)}</TableCell>
                                                <TableCell className="font-black tabular-nums">{formatCurrency(order.total, order.currency, features.iqd_display_preference)}</TableCell>
                                                <TableCell className="text-center">
                                                    <span className={cn(
                                                        "px-2 py-0.5 rounded-lg text-[9px] font-bold uppercase tracking-widest border",
                                                        order.status === 'delivered' ? "bg-green-500/10 text-green-600 border-green-500/20" :
                                                            order.status === 'pending' ? "bg-orange-500/10 text-orange-600 border-orange-500/20" :
                                                                "bg-muted text-muted-foreground border-border"
                                                    )}>
                                                        {t(`orders.status.${order.status}`, order.status)}
                                                    </span>
                                                </TableCell>
                                                <TableCell className="text-right pr-6">
                                                    <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl hover:bg-primary/10 hover:text-primary transition-all" onClick={() => openEditDialog(order)}>
                                                        <Eye className="h-4 w-4" />
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>

            <OrderDialog
                open={isDialogOpen}
                onOpenChange={setIsDialogOpen}
                mode={activeTab}
                order={editingOrder}
                onSave={editingOrder ? handleUpdate : handleCreate}
            />
        </div>
    )
}
