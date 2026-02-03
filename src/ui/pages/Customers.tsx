import { useState } from 'react'
import { useCustomers, createCustomer, updateCustomer, deleteCustomer, type Customer } from '@/local-db'
import { useWorkspace } from '@/workspace'
import { Button } from '@/ui/components/button'
import { Plus, Search, Edit, Trash2, Users } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/components/card'
import { Input } from '@/ui/components/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/components/table'
import { CustomerDialog } from '@/ui/components/customers/CustomerDialog'
import { DeleteConfirmationModal } from '@/ui/components/DeleteConfirmationModal'

import { useTranslation } from 'react-i18next'

export default function Customers() {
    const { t } = useTranslation()
    const { activeWorkspace } = useWorkspace()
    const customers = useCustomers(activeWorkspace?.id)
    const [searchQuery, setSearchQuery] = useState('')
    const [isDialogOpen, setIsDialogOpen] = useState(false)
    const [editingCustomer, setEditingCustomer] = useState<Customer | undefined>(undefined)
    const [deletingCustomer, setDeletingCustomer] = useState<Customer | undefined>(undefined)

    const filteredCustomers = customers.filter(c =>
        c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.phone?.includes(searchQuery)
    )

    const handleCreate = async (data: any) => {
        if (!activeWorkspace) return
        await createCustomer(activeWorkspace.id, data)
    }

    const handleUpdate = async (data: any) => {
        if (!editingCustomer) return
        await updateCustomer(editingCustomer.id, data)
    }

    const handleDelete = async () => {
        if (deletingCustomer) {
            await deleteCustomer(deletingCustomer.id)
            setDeletingCustomer(undefined)
        }
    }

    const openCreateDialog = () => {
        setEditingCustomer(undefined)
        setIsDialogOpen(true)
    }

    const openEditDialog = (customer: Customer) => {
        setEditingCustomer(customer)
        setIsDialogOpen(true)
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <Users className="w-6 h-6 text-primary" />
                        {t('customers.title', 'Customers')}
                    </h1>
                    <p className="text-muted-foreground">{t('customers.subtitle', 'Manage your customers and track their orders.')}</p>
                </div>
                <Button onClick={openCreateDialog} className="rounded-xl shadow-lg transition-all active:scale-95">
                    <Plus className="mr-2 h-4 w-4" /> {t('customers.addCustomer', 'New Customer')}
                </Button>
            </div>

            <div className="flex items-center justify-between gap-4">
                <div className="relative w-full max-w-sm">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder={t('customers.searchPlaceholder', 'Search customers...')}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-10 rounded-xl bg-card border-none shadow-sm focus-visible:ring-1 focus-visible:ring-primary/50 transition-all"
                    />
                </div>
            </div>

            <Card className="rounded-2xl overflow-hidden border-2 shadow-sm">
                <CardHeader className="bg-muted/30 border-b">
                    <CardTitle className="text-lg font-bold flex items-center gap-2">
                        <Users className="w-5 h-5 text-primary/70" />
                        {t('customers.listTitle', 'Customers List')}
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader className="bg-muted/20">
                            <TableRow className="hover:bg-transparent border-b">
                                <TableHead className="font-bold py-4 pl-6 text-primary/80">{t('customers.table.name', 'Customer')}</TableHead>
                                <TableHead className="font-bold">{t('customers.table.contact', 'Email')}</TableHead>
                                <TableHead className="font-bold">{t('customers.form.phone', 'Phone')}</TableHead>
                                <TableHead className="font-bold">{t('customers.form.city', 'City')}</TableHead>
                                <TableHead className="font-bold">{t('customers.form.defaultCurrency', 'Currency')}</TableHead>
                                <TableHead className="text-right font-bold pr-6">{t('common.actions', 'Actions')}</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filteredCustomers.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={6} className="h-48 text-center bg-muted/5">
                                        <div className="flex flex-col items-center justify-center gap-2 opacity-30">
                                            <Users className="w-12 h-12" />
                                            <p className="text-sm font-medium">{t('common.noData', 'No results found.')}</p>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ) : (
                                filteredCustomers.map((customer) => (
                                    <TableRow key={customer.id} className="group hover:bg-muted/30 transition-colors border-b last:border-0 text-foreground/80">
                                        <TableCell className="font-bold pl-6 text-foreground">{customer.name}</TableCell>
                                        <TableCell className="text-xs">{customer.email || '-'}</TableCell>
                                        <TableCell className="text-xs font-mono">{customer.phone || '-'}</TableCell>
                                        <TableCell className="font-medium text-xs">{customer.city || '-'}</TableCell>
                                        <TableCell>
                                            <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-secondary/50 text-secondary-foreground uppercase tracking-widest">
                                                {customer.defaultCurrency}
                                            </span>
                                        </TableCell>
                                        <TableCell className="text-right pr-6">
                                            <div className="flex justify-end gap-1 opacity-10 md:opacity-0 group-hover:opacity-100 transition-opacity">
                                                <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl hover:bg-primary/10 hover:text-primary transition-all" onClick={() => openEditDialog(customer)}>
                                                    <Edit className="h-4 w-4" />
                                                </Button>
                                                <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl hover:bg-destructive/10 hover:text-destructive transition-all" onClick={() => setDeletingCustomer(customer)}>
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            <CustomerDialog
                open={isDialogOpen}
                onOpenChange={setIsDialogOpen}
                customer={editingCustomer}
                onSave={editingCustomer ? handleUpdate : handleCreate}
            />

            <DeleteConfirmationModal
                isOpen={!!deletingCustomer}
                onClose={() => setDeletingCustomer(undefined)}
                onConfirm={handleDelete}
                title={t('customers.confirmDelete', 'Delete Customer')}
                description={t('customers.messages.deleteConfirm', 'Are you sure you want to delete this customer?')}
            />
        </div >
    )
}
