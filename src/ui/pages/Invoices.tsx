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
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/auth'

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
    const { t } = useTranslation()
    const { user } = useAuth()
    const canEdit = user?.role === 'admin' || user?.role === 'staff'
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
        if (confirm(t('invoices.messages.deleteConfirm') || 'Are you sure you want to delete this invoice?')) {
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
                        {t('invoices.title')}
                    </h1>
                    <p className="text-muted-foreground">{invoices.length} {t('invoices.subtitle')}</p>
                </div>
            </div>
            {canEdit && (
                <Button onClick={() => handleOpenDialog()} disabled={availableOrders.length === 0}>
                    <Plus className="w-4 h-4" />
                    {t('invoices.createInvoice')}
                </Button>
            )}

            {/* Stats */}
            <div className="grid gap-4 md:grid-cols-2">
                <Card>
                    <CardContent className="p-4 flex items-center justify-between">
                        <div>
                            <p className="text-sm text-muted-foreground">{t('invoices.stats.revenue')}</p>
                            <p className="text-2xl font-bold text-emerald-500">{formatCurrency(totalRevenue)}</p>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4 flex items-center justify-between">
                        <div>
                            <p className="text-sm text-muted-foreground">{t('invoices.stats.pending')}</p>
                            <p className="text-2xl font-bold text-amber-500">{formatCurrency(pendingAmount)}</p>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Search */}
            <div className="relative max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                    placeholder={t('invoices.searchPlaceholder') || "Search invoices..."}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-10"
                />
            </div>

            {/* Invoices Table */}
            <Card>
                <CardHeader>
                    <CardTitle>{t('invoices.listTitle') || "Invoice List"}</CardTitle>
                </CardHeader>
                <CardContent>
                    {filteredInvoices.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                            {invoices.length === 0 ? t('common.noData') : t('common.noData')}
                        </div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>{t('invoices.table.invoiceNumber')}</TableHead>
                                    <TableHead>{t('invoices.table.customer')}</TableHead>
                                    <TableHead>{t('invoices.table.status')}</TableHead>
                                    <TableHead className="text-right">{t('invoices.table.total')}</TableHead>
                                    <TableHead>{t('invoices.table.dueDate')}</TableHead>
                                    <TableHead>{t('invoices.table.created')}</TableHead>
                                    {canEdit && <TableHead className="text-right">{t('common.actions')}</TableHead>}
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredInvoices.map((invoice) => (
                                    <TableRow key={invoice.id}>
                                        <TableCell className="font-mono text-sm">{invoice.invoiceNumber}</TableCell>
                                        <TableCell className="font-medium">{invoice.customerName}</TableCell>
                                        <TableCell>
                                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[invoice.status]}`}>
                                                {t(`invoices.status.${invoice.status}`)}
                                            </span>
                                        </TableCell>
                                        <TableCell className="text-right font-medium">{formatCurrency(invoice.total)}</TableCell>
                                        <TableCell className={invoice.status === 'overdue' ? 'text-red-500' : 'text-muted-foreground'}>
                                            {formatDate(invoice.dueDate)}
                                        </TableCell>
                                        <TableCell className="text-muted-foreground text-sm">{formatDate(invoice.createdAt)}</TableCell>
                                        {canEdit && (
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
                                        )}
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
                        <DialogTitle>{editingInvoice ? t('invoices.form.editTitle') : t('invoices.form.createTitle')}</DialogTitle>
                    </DialogHeader>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        {!editingInvoice && (
                            <div className="space-y-2">
                                <Label>{t('invoices.form.selectOrder')}</Label>
                                <Select value={orderId} onValueChange={setOrderId} required>
                                    <SelectTrigger>
                                        <SelectValue placeholder={t('invoices.form.selectOrderPlaceholder')} />
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
                                        <span className="text-muted-foreground">{t('invoices.form.customer')}:</span>
                                        <span className="ml-2 font-medium">
                                            {editingInvoice?.customerName || selectedOrder?.customerName}
                                        </span>
                                    </div>
                                    <div>
                                        <span className="text-muted-foreground">{t('invoices.form.total')}:</span>
                                        <span className="ml-2 font-bold">
                                            {formatCurrency(editingInvoice?.total || selectedOrder?.total || 0)}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        )}

                        <div className="grid gap-4 md:grid-cols-2">
                            <div className="space-y-2">
                                <Label>{t('invoices.form.status')}</Label>
                                <Select value={status} onValueChange={(v) => setStatus(v as InvoiceStatus)}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {INVOICE_STATUSES.map((s) => (
                                            <SelectItem key={s} value={s} className="capitalize">{t(`invoices.status.${s}`)}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="dueDate">{t('invoices.form.dueDate')}</Label>
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
                            <Label htmlFor="notes">{t('invoices.form.notes')}</Label>
                            <Textarea
                                id="notes"
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                placeholder={t('invoices.form.notes') || "Additional notes..."}
                                rows={3}
                            />
                        </div>

                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                                {t('common.cancel')}
                            </Button>
                            <Button type="submit" disabled={isLoading || (!editingInvoice && !orderId)}>
                                {isLoading ? t('common.loading') : editingInvoice ? t('common.save') : t('invoices.createInvoice')}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    )
}
