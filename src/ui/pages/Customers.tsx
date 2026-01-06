import { useState } from 'react'
import { useCustomers, createCustomer, updateCustomer, deleteCustomer, type Customer } from '@/local-db'
import { formatCurrency } from '@/lib/utils'
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
    Textarea
} from '@/ui/components'
import { Plus, Pencil, Trash2, Users, Search, Mail, Phone, MapPin } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/auth'

type CustomerFormData = Omit<Customer, 'id' | 'createdAt' | 'updatedAt' | 'syncStatus' | 'lastSyncedAt' | 'version' | 'isDeleted' | 'totalOrders' | 'totalSpent'>

const initialFormData: CustomerFormData = {
    name: '',
    email: '',
    phone: '',
    address: '',
    city: '',
    country: '',
    notes: ''
}

export function Customers() {
    const customers = useCustomers()
    const { t } = useTranslation()
    const { user } = useAuth()
    const canEdit = user?.role === 'admin' || user?.role === 'staff'
    const [search, setSearch] = useState('')
    const [isDialogOpen, setIsDialogOpen] = useState(false)
    const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null)
    const [formData, setFormData] = useState<CustomerFormData>(initialFormData)
    const [isLoading, setIsLoading] = useState(false)

    const filteredCustomers = customers.filter(
        (c) =>
            c.name.toLowerCase().includes(search.toLowerCase()) ||
            c.email.toLowerCase().includes(search.toLowerCase()) ||
            c.phone.includes(search)
    )

    const handleOpenDialog = (customer?: Customer) => {
        if (customer) {
            setEditingCustomer(customer)
            setFormData({
                name: customer.name,
                email: customer.email,
                phone: customer.phone,
                address: customer.address,
                city: customer.city,
                country: customer.country,
                notes: customer.notes || ''
            })
        } else {
            setEditingCustomer(null)
            setFormData(initialFormData)
        }
        setIsDialogOpen(true)
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setIsLoading(true)

        try {
            if (editingCustomer) {
                await updateCustomer(editingCustomer.id, formData)
            } else {
                await createCustomer(formData)
            }
            setIsDialogOpen(false)
            setFormData(initialFormData)
        } catch (error) {
            console.error('Error saving customer:', error)
        } finally {
            setIsLoading(false)
        }
    }

    const handleDelete = async (id: string) => {
        if (confirm(t('customers.messages.deleteConfirm') || 'Are you sure you want to delete this customer?')) {
            await deleteCustomer(id)
        }
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <Users className="w-6 h-6 text-primary" />
                        {t('customers.title')}
                    </h1>
                    <p className="text-muted-foreground">{customers.length} {t('customers.subtitle')}</p>
                </div>
            </div>
            {canEdit && (
                <Button onClick={() => handleOpenDialog()}>
                    <Plus className="w-4 h-4" />
                    {t('customers.addCustomer')}
                </Button>
            )}

            {/* Search */}
            <div className="relative max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                    placeholder={t('customers.searchPlaceholder') || "Search customers..."}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-10"
                />
            </div>

            {/* Customers Table */}
            <Card>
                <CardHeader>
                    <CardTitle>{t('customers.title')}</CardTitle>
                </CardHeader>
                <CardContent>
                    {filteredCustomers.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                            {customers.length === 0 ? t('common.noData') : t('common.noData')}
                        </div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>{t('customers.table.name')}</TableHead>
                                    <TableHead>{t('customers.table.contact')}</TableHead>
                                    <TableHead>{t('customers.table.location')}</TableHead>
                                    <TableHead className="text-right">{t('customers.table.orders')}</TableHead>
                                    <TableHead className="text-right">{t('customers.table.totalSpent')}</TableHead>
                                    {canEdit && <TableHead className="text-right">{t('common.actions')}</TableHead>}
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredCustomers.map((customer) => (
                                    <TableRow key={customer.id}>
                                        <TableCell className="font-medium">{customer.name}</TableCell>
                                        <TableCell>
                                            <div className="flex flex-col gap-1">
                                                <span className="flex items-center gap-1 text-sm">
                                                    <Mail className="w-3 h-3" /> {customer.email}
                                                </span>
                                                <span className="flex items-center gap-1 text-sm text-muted-foreground">
                                                    <Phone className="w-3 h-3" /> {customer.phone}
                                                </span>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <span className="flex items-center gap-1">
                                                <MapPin className="w-3 h-3" /> {customer.city}, {customer.country}
                                            </span>
                                        </TableCell>
                                        <TableCell className="text-right">{customer.totalOrders}</TableCell>
                                        <TableCell className="text-right">{formatCurrency(customer.totalSpent)}</TableCell>
                                        {canEdit && (
                                            <TableCell className="text-right">
                                                <div className="flex justify-end gap-2">
                                                    <Button variant="ghost" size="icon" onClick={() => handleOpenDialog(customer)}>
                                                        <Pencil className="w-4 h-4" />
                                                    </Button>
                                                    <Button variant="ghost" size="icon" onClick={() => handleDelete(customer.id)}>
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
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>{editingCustomer ? t('common.edit') : t('customers.addCustomer')}</DialogTitle>
                    </DialogHeader>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="grid gap-4 md:grid-cols-2">
                            <div className="space-y-2">
                                <Label htmlFor="name">{t('customers.form.name')}</Label>
                                <Input
                                    id="name"
                                    value={formData.name}
                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    placeholder="John Doe"
                                    required
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="email">{t('customers.form.email')}</Label>
                                <Input
                                    id="email"
                                    type="email"
                                    value={formData.email}
                                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                    placeholder="john@example.com"
                                    required
                                />
                            </div>
                        </div>

                        <div className="grid gap-4 md:grid-cols-2">
                            <div className="space-y-2">
                                <Label htmlFor="phone">{t('customers.form.phone')}</Label>
                                <Input
                                    id="phone"
                                    value={formData.phone}
                                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                                    placeholder="+1 234 567 8900"
                                    required
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="country">{t('customers.form.country')}</Label>
                                <Input
                                    id="country"
                                    value={formData.country}
                                    onChange={(e) => setFormData({ ...formData, country: e.target.value })}
                                    placeholder="United States"
                                    required
                                />
                            </div>
                        </div>

                        <div className="grid gap-4 md:grid-cols-2">
                            <div className="space-y-2">
                                <Label htmlFor="city">{t('customers.form.city')}</Label>
                                <Input
                                    id="city"
                                    value={formData.city}
                                    onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                                    placeholder="New York"
                                    required
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="address">{t('customers.form.address')}</Label>
                                <Input
                                    id="address"
                                    value={formData.address}
                                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                                    placeholder="123 Main St"
                                    required
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="notes">{t('customers.form.notes')}</Label>
                            <Textarea
                                id="notes"
                                value={formData.notes}
                                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                                placeholder={t('customers.form.notes') || "Additional notes..."}
                                rows={3}
                            />
                        </div>

                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                                {t('common.cancel')}
                            </Button>
                            <Button type="submit" disabled={isLoading}>
                                {isLoading ? t('common.loading') : editingCustomer ? t('common.save') : t('common.create')}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    )
}
