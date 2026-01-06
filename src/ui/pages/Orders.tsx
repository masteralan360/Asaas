import { useState } from 'react'
import { useOrders, useCustomers, useProducts, createOrder, updateOrder, deleteOrder, type Order, type OrderItem, type OrderStatus } from '@/local-db'
import { formatCurrency, formatDate } from '@/lib/utils'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
    Button,
    Input,
    Label,
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    Textarea,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/components'
import { Plus, Pencil, Trash2, ShoppingCart, Search, Package } from 'lucide-react'

const ORDER_STATUSES: OrderStatus[] = ['pending', 'processing', 'shipped', 'delivered', 'cancelled']

const statusColors: Record<OrderStatus, string> = {
    pending: 'bg-amber-500/10 text-amber-500',
    processing: 'bg-blue-500/10 text-blue-500',
    shipped: 'bg-purple-500/10 text-purple-500',
    delivered: 'bg-emerald-500/10 text-emerald-500',
    cancelled: 'bg-red-500/10 text-red-500'
}

export function Orders() {
    const orders = useOrders()
    const customers = useCustomers()
    const products = useProducts()
    const [search, setSearch] = useState('')
    const [isDialogOpen, setIsDialogOpen] = useState(false)
    const [editingOrder, setEditingOrder] = useState<Order | null>(null)
    const [isLoading, setIsLoading] = useState(false)

    // Form state
    const [customerId, setCustomerId] = useState('')
    const [status, setStatus] = useState<OrderStatus>('pending')
    const [items, setItems] = useState<OrderItem[]>([])
    const [notes, setNotes] = useState('')
    const [shippingAddress, setShippingAddress] = useState('')
    const [discount, setDiscount] = useState(0)
    const [tax, setTax] = useState(0)

    const filteredOrders = orders.filter(
        (o) =>
            o.orderNumber.toLowerCase().includes(search.toLowerCase()) ||
            o.customerName.toLowerCase().includes(search.toLowerCase())
    )

    const subtotal = items.reduce((sum, item) => sum + item.total, 0)
    const total = subtotal + tax - discount

    const handleOpenDialog = (order?: Order) => {
        if (order) {
            setEditingOrder(order)
            setCustomerId(order.customerId)
            setStatus(order.status)
            setItems(order.items)
            setNotes(order.notes || '')
            setShippingAddress(order.shippingAddress)
            setDiscount(order.discount)
            setTax(order.tax)
        } else {
            setEditingOrder(null)
            setCustomerId('')
            setStatus('pending')
            setItems([])
            setNotes('')
            setShippingAddress('')
            setDiscount(0)
            setTax(0)
        }
        setIsDialogOpen(true)
    }

    const addItem = (productId: string) => {
        const product = products.find(p => p.id === productId)
        if (!product) return

        const existingIndex = items.findIndex(i => i.productId === productId)
        if (existingIndex >= 0) {
            const updated = [...items]
            updated[existingIndex].quantity += 1
            updated[existingIndex].total = updated[existingIndex].quantity * updated[existingIndex].unitPrice
            setItems(updated)
        } else {
            setItems([...items, {
                productId: product.id,
                productName: product.name,
                quantity: 1,
                unitPrice: product.price,
                total: product.price
            }])
        }
    }

    const updateItemQuantity = (index: number, quantity: number) => {
        const updated = [...items]
        updated[index].quantity = quantity
        updated[index].total = quantity * updated[index].unitPrice
        setItems(updated)
    }

    const removeItem = (index: number) => {
        setItems(items.filter((_, i) => i !== index))
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setIsLoading(true)

        const customer = customers.find(c => c.id === customerId)
        if (!customer) {
            setIsLoading(false)
            return
        }

        try {
            const orderData = {
                customerId,
                customerName: customer.name,
                items,
                subtotal,
                tax,
                discount,
                total,
                status,
                notes,
                shippingAddress
            }

            if (editingOrder) {
                await updateOrder(editingOrder.id, orderData)
            } else {
                await createOrder(orderData)
            }
            setIsDialogOpen(false)
        } catch (error) {
            console.error('Error saving order:', error)
        } finally {
            setIsLoading(false)
        }
    }

    const handleDelete = async (id: string) => {
        if (confirm('Are you sure you want to delete this order?')) {
            await deleteOrder(id)
        }
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <ShoppingCart className="w-6 h-6 text-primary" />
                        Orders
                    </h1>
                    <p className="text-muted-foreground">{orders.length} orders total</p>
                </div>
                <Button onClick={() => handleOpenDialog()} disabled={customers.length === 0 || products.length === 0}>
                    <Plus className="w-4 h-4" />
                    New Order
                </Button>
            </div>

            {customers.length === 0 && (
                <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/20">
                    <p className="text-sm text-amber-500">Add customers before creating orders.</p>
                </div>
            )}

            {/* Search */}
            <div className="relative max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                    placeholder="Search orders..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-10"
                />
            </div>

            {/* Orders Table */}
            <Card>
                <CardHeader>
                    <CardTitle>Order List</CardTitle>
                </CardHeader>
                <CardContent>
                    {filteredOrders.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                            {orders.length === 0 ? 'No orders yet.' : 'No orders match your search.'}
                        </div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Order #</TableHead>
                                    <TableHead>Customer</TableHead>
                                    <TableHead>Items</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead className="text-right">Total</TableHead>
                                    <TableHead>Date</TableHead>
                                    <TableHead className="text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredOrders.map((order) => (
                                    <TableRow key={order.id}>
                                        <TableCell className="font-mono text-sm">{order.orderNumber}</TableCell>
                                        <TableCell className="font-medium">{order.customerName}</TableCell>
                                        <TableCell>{order.items.length} items</TableCell>
                                        <TableCell>
                                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[order.status]}`}>
                                                {order.status}
                                            </span>
                                        </TableCell>
                                        <TableCell className="text-right font-medium">{formatCurrency(order.total)}</TableCell>
                                        <TableCell className="text-muted-foreground text-sm">{formatDate(order.createdAt)}</TableCell>
                                        <TableCell className="text-right">
                                            <div className="flex justify-end gap-2">
                                                <Button variant="ghost" size="icon" onClick={() => handleOpenDialog(order)}>
                                                    <Pencil className="w-4 h-4" />
                                                </Button>
                                                <Button variant="ghost" size="icon" onClick={() => handleDelete(order.id)}>
                                                    <Trash2 className="w-4 h-4 text-destructive" />
                                                </Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>

            {/* Add/Edit Dialog */}
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>{editingOrder ? 'Edit Order' : 'Create New Order'}</DialogTitle>
                    </DialogHeader>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="grid gap-4 md:grid-cols-2">
                            <div className="space-y-2">
                                <Label>Customer</Label>
                                <Select value={customerId} onValueChange={setCustomerId} required>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select customer" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {customers.map((c) => (
                                            <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Status</Label>
                                <Select value={status} onValueChange={(v) => setStatus(v as OrderStatus)}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {ORDER_STATUSES.map((s) => (
                                            <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        {/* Add Products */}
                        <div className="space-y-2">
                            <Label>Add Products</Label>
                            <Select onValueChange={addItem}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Select product to add..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {products.map((p) => (
                                        <SelectItem key={p.id} value={p.id}>
                                            <span className="flex items-center gap-2">
                                                <Package className="w-4 h-4" />
                                                {p.name} - {formatCurrency(p.price)}
                                            </span>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Order Items */}
                        {items.length > 0 && (
                            <div className="border rounded-lg overflow-hidden">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Product</TableHead>
                                            <TableHead className="w-24">Qty</TableHead>
                                            <TableHead className="text-right">Price</TableHead>
                                            <TableHead className="text-right">Total</TableHead>
                                            <TableHead className="w-10"></TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {items.map((item, index) => (
                                            <TableRow key={index}>
                                                <TableCell>{item.productName}</TableCell>
                                                <TableCell>
                                                    <Input
                                                        type="number"
                                                        min="1"
                                                        value={item.quantity}
                                                        onChange={(e) => updateItemQuantity(index, parseInt(e.target.value) || 1)}
                                                        className="w-20"
                                                    />
                                                </TableCell>
                                                <TableCell className="text-right">{formatCurrency(item.unitPrice)}</TableCell>
                                                <TableCell className="text-right font-medium">{formatCurrency(item.total)}</TableCell>
                                                <TableCell>
                                                    <Button type="button" variant="ghost" size="icon" onClick={() => removeItem(index)}>
                                                        <Trash2 className="w-4 h-4 text-destructive" />
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        )}

                        {/* Totals */}
                        <div className="grid gap-4 md:grid-cols-3">
                            <div className="space-y-2">
                                <Label htmlFor="discount">Discount</Label>
                                <Input
                                    id="discount"
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={discount}
                                    onChange={(e) => setDiscount(parseFloat(e.target.value) || 0)}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="tax">Tax</Label>
                                <Input
                                    id="tax"
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={tax}
                                    onChange={(e) => setTax(parseFloat(e.target.value) || 0)}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Total</Label>
                                <div className="h-10 px-3 py-2 border rounded-md bg-secondary font-bold">
                                    {formatCurrency(total)}
                                </div>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="shippingAddress">Shipping Address</Label>
                            <Textarea
                                id="shippingAddress"
                                value={shippingAddress}
                                onChange={(e) => setShippingAddress(e.target.value)}
                                placeholder="Enter shipping address..."
                                rows={2}
                                required
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="notes">Notes (Optional)</Label>
                            <Textarea
                                id="notes"
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                placeholder="Additional notes..."
                                rows={2}
                            />
                        </div>

                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                                Cancel
                            </Button>
                            <Button type="submit" disabled={isLoading || items.length === 0 || !customerId}>
                                {isLoading ? 'Saving...' : editingOrder ? 'Update Order' : 'Create Order'}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    )
}
