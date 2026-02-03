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
import { Plus, Search, Edit } from 'lucide-react'
import { Input } from '@/ui/components/input'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/ui/components/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/components/table'
import { OrderDialog } from '@/ui/components/orders/OrderDialog'

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
    const [searchQuery, setSearchQuery] = useState('')
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

    const filteredOrders = activeTab === 'purchase'
        ? purchaseOrders.filter(o =>
            o.orderNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
            getEntityName(o.supplierId, 'purchase').toLowerCase().includes(searchQuery.toLowerCase())
        )
        : salesOrders.filter(o =>
            o.orderNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
            getEntityName(o.customerId, 'sales').toLowerCase().includes(searchQuery.toLowerCase())
        )

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'completed': return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300'
            case 'pending': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300'
            case 'draft': return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300'
            default: return 'bg-gray-100 text-gray-800'
        }
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">{t('orders.title', 'Orders')}</h2>
                    <p className="text-muted-foreground">{t('orders.subtitle', 'Manage purchase and sales orders.')}</p>
                </div>
                <Button
                    onClick={openCreateDialog}
                    disabled={activeTab === 'purchase' ? suppliers.length === 0 : customers.length === 0}
                >
                    <Plus className="mr-2 h-4 w-4" /> {t('orders.newOrder', 'New Order')}
                </Button>
            </div>

            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="space-y-4">
                <TabsList>
                    <TabsTrigger value="sales">{t('orders.tabs.sales', 'Sales Orders')}</TabsTrigger>
                    <TabsTrigger value="purchase">{t('orders.tabs.purchase', 'Purchase Orders')}</TabsTrigger>
                </TabsList>

                <div className="flex items-center py-4">
                    <div className="relative w-full max-w-sm">
                        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder={activeTab === 'purchase' ? t('orders.placeholder.searchPurchase', 'Search purchase orders...') : t('orders.placeholder.searchSales', 'Search sales orders...')}
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-8"
                        />
                    </div>
                </div>

                <TabsContent value="sales" className="space-y-4">
                    <div className="rounded-md border bg-card">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>{t('orders.table.orderNumber', 'Order #')}</TableHead>
                                    <TableHead>{t('orders.table.date', 'Date')}</TableHead>
                                    <TableHead>{t('orders.table.customer', 'Customer')}</TableHead>
                                    <TableHead>{t('orders.table.total', 'Total')}</TableHead>
                                    <TableHead>{t('orders.table.status', 'Status')}</TableHead>
                                    <TableHead className="text-right">{t('common.actions', 'Actions')}</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredOrders.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={6} className="h-24 text-center">{t('common.noData', 'No orders found.')}</TableCell>
                                    </TableRow>
                                ) : (
                                    (filteredOrders as SalesOrder[]).map(order => (
                                        <TableRow key={order.id}>
                                            <TableCell className="font-medium">{order.orderNumber}</TableCell>
                                            <TableCell>{new Date(order.createdAt).toLocaleDateString()}</TableCell>
                                            <TableCell>{getEntityName(order.customerId, 'sales')}</TableCell>
                                            <TableCell>
                                                {order.total.toLocaleString(undefined, { style: 'currency', currency: order.currency.toUpperCase() })}
                                            </TableCell>
                                            <TableCell>
                                                <span className={`px-2 py-1 rounded-full text-xs font-semibold ${getStatusColor(order.status)}`}>
                                                    {t(`orders.status.${order.status}`, order.status)}
                                                </span>
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <Button variant="ghost" size="icon" onClick={() => openEditDialog(order)}>
                                                    <Edit className="h-4 w-4" />
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </TabsContent>

                <TabsContent value="purchase" className="space-y-4">
                    <div className="rounded-md border bg-card">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>{t('orders.table.orderNumber', 'Order #')}</TableHead>
                                    <TableHead>{t('orders.table.date', 'Date')}</TableHead>
                                    <TableHead>{t('orders.form.supplier', 'Supplier')}</TableHead>
                                    <TableHead>{t('orders.table.total', 'Total')}</TableHead>
                                    <TableHead>{t('orders.table.status', 'Status')}</TableHead>
                                    <TableHead className="text-right">{t('common.actions', 'Actions')}</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredOrders.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={6} className="h-24 text-center">{t('common.noData', 'No orders found.')}</TableCell>
                                    </TableRow>
                                ) : (
                                    (filteredOrders as PurchaseOrder[]).map(order => (
                                        <TableRow key={order.id}>
                                            <TableCell className="font-medium">{order.orderNumber}</TableCell>
                                            <TableCell>{new Date(order.createdAt).toLocaleDateString()}</TableCell>
                                            <TableCell>{getEntityName(order.supplierId, 'purchase')}</TableCell>
                                            <TableCell>
                                                {order.total.toLocaleString(undefined, { style: 'currency', currency: order.currency.toUpperCase() })}
                                            </TableCell>
                                            <TableCell>
                                                <span className={`px-2 py-1 rounded-full text-xs font-semibold ${getStatusColor(order.status)}`}>
                                                    {t(`orders.status.${order.status}`, order.status)}
                                                </span>
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <Button variant="ghost" size="icon" onClick={() => openEditDialog(order)}>
                                                    <Edit className="h-4 w-4" />
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </div>
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
