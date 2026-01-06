import { useState } from 'react'
import { useInvoices, useOrders, createInvoice, updateInvoice, deleteInvoice, type Invoice, type InvoiceStatus } from '@/local-db'
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
import { Plus, Pencil, Trash2, FileText, Search } from 'lucide-react'

const INVOICE_STATUSES: InvoiceStatus[] = ['draft', 'sent', 'paid', 'overdue', 'cancelled']

const statusColors: Record<InvoiceStatus, string> = {
    draft: 'bg-slate-500/10 text-slate-500',
    sent: 'bg-blue-500/10 text-blue-500',
    paid: 'bg-emerald-500/10 text-emerald-500',
    overdue: 'bg-red-500/10 text-red-500',
    cancelled: 'bg-slate-500/10 text-slate-500'
}

export function Invoices() {
    const invoices = useInvoices()
    const orders = useOrders()
    const [search, setSearch] = useState('')
    const [isDialogOpen, setIsDialogOpen] = useState(false)
    const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null)
    const [isLoading, setIsLoading] = useState(false)

    // Form state
    const [orderId, setOrderId] = useState('')
    const [status, setStatus] = useState<InvoiceStatus>('draft')
    const [dueDate, setDueDate] = useState('')
    const [notes, setNotes] = useState('')

    const filteredInvoices = invoices.filter(
        (i) =>
            i.invoiceNumber.toLowerCase().includes(search.toLowerCase()) ||
            i.customerName.toLowerCase().includes(search.toLowerCase())
    )

    // Get orders that don't have invoices yet
    const availableOrders = orders.filter(
        o => o.status !== 'cancelled' && !invoices.some(i => i.orderId === o.id)
    )

    const selectedOrder = orders.find(o => o.id === orderId)

    const handleOpenDialog = (invoice?: Invoice) => {
        if (invoice) {
            setEditingInvoice(invoice)
            setOrderId(invoice.orderId)
            setStatus(invoice.status)
            setDueDate(invoice.dueDate.split('T')[0])
            setNotes(invoice.notes || '')
        } else {
            setEditingInvoice(null)
            setOrderId('')
            setStatus('draft')
            setDueDate(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0])
            setNotes('')
        }
        setIsDialogOpen(true)
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setIsLoading(true)

        try {
            if (editingInvoice) {
                await updateInvoice(editingInvoice.id, {
                    status,
                    dueDate: new Date(dueDate).toISOString(),
                    notes,
                    paidAt: status === 'paid' ? new Date().toISOString() : undefined
                })
            } else if (selectedOrder) {
                await createInvoice({
                    orderId: selectedOrder.id,
                    customerId: selectedOrder.customerId,
                    customerName: selectedOrder.customerName,
                    items: selectedOrder.items,
                    subtotal: selectedOrder.subtotal,
                    tax: selectedOrder.tax,
                    discount: selectedOrder.discount,
                    total: selectedOrder.total,
                    status,
                    dueDate: new Date(dueDate).toISOString(),
                    notes
                })
            }
            setIsDialogOpen(false)
        } catch (error) {
            console.error('Error saving invoice:', error)
        } finally {
            setIsLoading(false)
        }
    }

    const handleDelete = async (id: string) => {
        if (confirm('Are you sure you want to delete this invoice?')) {
            await deleteInvoice(id)
        }
    }

    const totalRevenue = invoices
        .filter(i => i.status === 'paid')
        .reduce((sum, i) => sum + i.total, 0)

    const pendingAmount = invoices
        .filter(i => i.status === 'sent' || i.status === 'overdue')
        .reduce((sum, i) => sum + i.total, 0)

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <FileText className="w-6 h-6 text-primary" />
                        Invoices
                    </h1>
                    <p className="text-muted-foreground">{invoices.length} invoices total</p>
                </div>
                <Button onClick={() => handleOpenDialog()} disabled={availableOrders.length === 0}>
                    <Plus className="w-4 h-4" />
                    Create Invoice
                </Button>
            </div>

            {/* Stats */}
            <div className="grid gap-4 md:grid-cols-2">
                <Card>
                    <CardContent className="p-4 flex items-center justify-between">
                        <div>
                            <p className="text-sm text-muted-foreground">Total Revenue (Paid)</p>
                            <p className="text-2xl font-bold text-emerald-500">{formatCurrency(totalRevenue)}</p>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4 flex items-center justify-between">
                        <div>
                            <p className="text-sm text-muted-foreground">Pending Amount</p>
                            <p className="text-2xl font-bold text-amber-500">{formatCurrency(pendingAmount)}</p>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Search */}
            <div className="relative max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                    placeholder="Search invoices..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-10"
                />
            </div>

            {/* Invoices Table */}
            <Card>
                <CardHeader>
                    <CardTitle>Invoice List</CardTitle>
                </CardHeader>
                <CardContent>
                    {filteredInvoices.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                            {invoices.length === 0 ? 'No invoices yet.' : 'No invoices match your search.'}
                        </div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Invoice #</TableHead>
                                    <TableHead>Customer</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead className="text-right">Total</TableHead>
                                    <TableHead>Due Date</TableHead>
                                    <TableHead>Created</TableHead>
                                    <TableHead className="text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredInvoices.map((invoice) => (
                                    <TableRow key={invoice.id}>
                                        <TableCell className="font-mono text-sm">{invoice.invoiceNumber}</TableCell>
                                        <TableCell className="font-medium">{invoice.customerName}</TableCell>
                                        <TableCell>
                                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[invoice.status]}`}>
                                                {invoice.status}
                                            </span>
                                        </TableCell>
                                        <TableCell className="text-right font-medium">{formatCurrency(invoice.total)}</TableCell>
                                        <TableCell className={invoice.status === 'overdue' ? 'text-red-500' : 'text-muted-foreground'}>
                                            {formatDate(invoice.dueDate)}
                                        </TableCell>
                                        <TableCell className="text-muted-foreground text-sm">{formatDate(invoice.createdAt)}</TableCell>
                                        <TableCell className="text-right">
                                            <div className="flex justify-end gap-2">
                                                <Button variant="ghost" size="icon" onClick={() => handleOpenDialog(invoice)}>
                                                    <Pencil className="w-4 h-4" />
                                                </Button>
                                                <Button variant="ghost" size="icon" onClick={() => handleDelete(invoice.id)}>
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
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{editingInvoice ? 'Edit Invoice' : 'Create Invoice from Order'}</DialogTitle>
                    </DialogHeader>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        {!editingInvoice && (
                            <div className="space-y-2">
                                <Label>Select Order</Label>
                                <Select value={orderId} onValueChange={setOrderId} required>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select an order..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {availableOrders.map((o) => (
                                            <SelectItem key={o.id} value={o.id}>
                                                {o.orderNumber} - {o.customerName} ({formatCurrency(o.total)})
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        )}

                        {(selectedOrder || editingInvoice) && (
                            <div className="p-3 rounded-lg bg-secondary/50">
                                <div className="grid grid-cols-2 gap-2 text-sm">
                                    <div>
                                        <span className="text-muted-foreground">Customer:</span>
                                        <span className="ml-2 font-medium">
                                            {editingInvoice?.customerName || selectedOrder?.customerName}
                                        </span>
                                    </div>
                                    <div>
                                        <span className="text-muted-foreground">Total:</span>
                                        <span className="ml-2 font-bold">
                                            {formatCurrency(editingInvoice?.total || selectedOrder?.total || 0)}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        )}

                        <div className="grid gap-4 md:grid-cols-2">
                            <div className="space-y-2">
                                <Label>Status</Label>
                                <Select value={status} onValueChange={(v) => setStatus(v as InvoiceStatus)}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {INVOICE_STATUSES.map((s) => (
                                            <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="dueDate">Due Date</Label>
                                <Input
                                    id="dueDate"
                                    type="date"
                                    value={dueDate}
                                    onChange={(e) => setDueDate(e.target.value)}
                                    required
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="notes">Notes (Optional)</Label>
                            <Textarea
                                id="notes"
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                placeholder="Additional notes..."
                                rows={3}
                            />
                        </div>

                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                                Cancel
                            </Button>
                            <Button type="submit" disabled={isLoading || (!editingInvoice && !orderId)}>
                                {isLoading ? 'Saving...' : editingInvoice ? 'Update' : 'Create Invoice'}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    )
}
