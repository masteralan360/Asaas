import { useState } from 'react'
import { useCustomers, createCustomer, updateCustomer, deleteCustomer, type Customer } from '@/local-db'
import { useWorkspace } from '@/workspace'
import { Button } from '@/ui/components/button'
import { Plus, Search, Edit, Trash2 } from 'lucide-react'
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
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">{t('customers.title', 'Customers')}</h2>
                    <p className="text-muted-foreground">{t('customers.subtitle', 'Manage your customers and track their orders.')}</p>
                </div>
                <Button onClick={openCreateDialog}>
                    <Plus className="mr-2 h-4 w-4" /> {t('customers.addCustomer', 'New Customer')}
                </Button>
            </div>

            <div className="flex items-center py-4">
                <div className="relative w-full max-w-sm">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder={t('customers.searchPlaceholder', 'Search customers...')}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-8"
                    />
                </div>
            </div>

            <div className="rounded-md border bg-card">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>{t('customers.table.name', 'Customer')}</TableHead>
                            <TableHead>{t('customers.table.contact', 'Email')}</TableHead>
                            <TableHead>{t('customers.form.phone', 'Phone')}</TableHead>
                            <TableHead>{t('customers.form.city', 'City')}</TableHead>
                            <TableHead>{t('customers.form.defaultCurrency', 'Currency')}</TableHead>
                            <TableHead className="text-right">{t('common.actions', 'Actions')}</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filteredCustomers.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={6} className="h-24 text-center">
                                    {t('common.noData', 'No results found.')}
                                </TableCell>
                            </TableRow>
                        ) : (
                            filteredCustomers.map((customer) => (
                                <TableRow key={customer.id}>
                                    <TableCell className="font-medium">{customer.name}</TableCell>
                                    <TableCell>{customer.email || '-'}</TableCell>
                                    <TableCell>{customer.phone || '-'}</TableCell>
                                    <TableCell>{customer.city || '-'}</TableCell>
                                    <TableCell className="uppercase">{customer.defaultCurrency}</TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex justify-end gap-2">
                                            <Button variant="ghost" size="icon" onClick={() => openEditDialog(customer)}>
                                                <Edit className="h-4 w-4" />
                                            </Button>
                                            <Button variant="ghost" size="icon" onClick={() => setDeletingCustomer(customer)}>
                                                <Trash2 className="h-4 w-4 text-destructive" />
                                            </Button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>

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
        </div>
    )
}
