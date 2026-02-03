import { useState } from 'react'
import { useSuppliers, createSupplier, updateSupplier, deleteSupplier, type Supplier } from '@/local-db'
import { useWorkspace } from '@/workspace'
import { Button } from '@/ui/components/button'
import { Plus, Search, Edit, Trash2 } from 'lucide-react'
import { Input } from '@/ui/components/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/components/table'
import { SupplierDialog } from '@/ui/components/suppliers/SupplierDialog'
import { DeleteConfirmationModal } from '@/ui/components/DeleteConfirmationModal'

import { useTranslation } from 'react-i18next'

export default function Suppliers() {
    const { t } = useTranslation()
    const { activeWorkspace } = useWorkspace()
    const suppliers = useSuppliers(activeWorkspace?.id)
    const [searchQuery, setSearchQuery] = useState('')
    const [isDialogOpen, setIsDialogOpen] = useState(false)
    const [editingSupplier, setEditingSupplier] = useState<Supplier | undefined>(undefined)
    const [deletingSupplier, setDeletingSupplier] = useState<Supplier | undefined>(undefined)

    const filteredSuppliers = suppliers.filter(s =>
        s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.contactName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.email?.toLowerCase().includes(searchQuery.toLowerCase())
    )

    const handleCreate = async (data: any) => {
        if (!activeWorkspace) return
        await createSupplier(activeWorkspace.id, data)
    }

    const handleUpdate = async (data: any) => {
        if (!editingSupplier) return
        await updateSupplier(editingSupplier.id, data)
    }

    const handleDelete = async () => {
        if (deletingSupplier) {
            await deleteSupplier(deletingSupplier.id)
            setDeletingSupplier(undefined)
        }
    }

    const openCreateDialog = () => {
        setEditingSupplier(undefined)
        setIsDialogOpen(true)
    }

    const openEditDialog = (supplier: Supplier) => {
        setEditingSupplier(supplier)
        setIsDialogOpen(true)
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">{t('suppliers.title', 'Suppliers')}</h2>
                    <p className="text-muted-foreground">{t('suppliers.subtitle', 'Manage your suppliers and purchase history.')}</p>
                </div>
                <Button onClick={openCreateDialog}>
                    <Plus className="mr-2 h-4 w-4" /> {t('suppliers.addSupplier', 'New Supplier')}
                </Button>
            </div>

            <div className="flex items-center py-4">
                <div className="relative w-full max-w-sm">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder={t('suppliers.searchPlaceholder', 'Search suppliers...')}
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
                            <TableHead>{t('suppliers.table.company', 'Company')}</TableHead>
                            <TableHead>{t('suppliers.table.contact', 'Contact')}</TableHead>
                            <TableHead>{t('suppliers.table.email', 'Email')}</TableHead>
                            <TableHead>{t('suppliers.table.phone', 'Phone')}</TableHead>
                            <TableHead>{t('suppliers.table.currency', 'Currency')}</TableHead>
                            <TableHead className="text-right">{t('suppliers.table.actions', 'Actions')}</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filteredSuppliers.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={6} className="h-24 text-center">
                                    {t('common.noData', 'No results found.')}
                                </TableCell>
                            </TableRow>
                        ) : (
                            filteredSuppliers.map((supplier) => (
                                <TableRow key={supplier.id}>
                                    <TableCell className="font-medium">{supplier.name}</TableCell>
                                    <TableCell>{supplier.contactName || '-'}</TableCell>
                                    <TableCell>{supplier.email || '-'}</TableCell>
                                    <TableCell>{supplier.phone || '-'}</TableCell>
                                    <TableCell className="uppercase">{supplier.defaultCurrency}</TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex justify-end gap-2">
                                            <Button variant="ghost" size="icon" onClick={() => openEditDialog(supplier)}>
                                                <Edit className="h-4 w-4" />
                                            </Button>
                                            <Button variant="ghost" size="icon" onClick={() => setDeletingSupplier(supplier)}>
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

            <SupplierDialog
                open={isDialogOpen}
                onOpenChange={setIsDialogOpen}
                supplier={editingSupplier}
                onSave={editingSupplier ? handleUpdate : handleCreate}
            />

            <DeleteConfirmationModal
                isOpen={!!deletingSupplier}
                onClose={() => setDeletingSupplier(undefined)}
                onConfirm={handleDelete}
                title={t('suppliers.confirmDelete', 'Delete Supplier')}
                description={t('suppliers.messages.deleteConfirm', 'Are you sure you want to delete this supplier?')}
            />
        </div>
    )
}
