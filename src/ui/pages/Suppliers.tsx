import { useState } from 'react'
import { useSuppliers, createSupplier, updateSupplier, deleteSupplier, type Supplier } from '@/local-db'
import { useWorkspace } from '@/workspace'
import { Button } from '@/ui/components/button'
import { Plus, Search, Edit, Trash2, Truck } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/components/card'
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
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <Truck className="w-6 h-6 text-primary" />
                        {t('suppliers.title', 'Suppliers')}
                    </h1>
                    <p className="text-muted-foreground">{t('suppliers.subtitle', 'Manage your suppliers and purchase history.')}</p>
                </div>
                <Button onClick={openCreateDialog} className="rounded-xl shadow-lg transition-all active:scale-95">
                    <Plus className="mr-2 h-4 w-4" /> {t('suppliers.addSupplier', 'New Supplier')}
                </Button>
            </div>

            <div className="flex items-center justify-between gap-4">
                <div className="relative w-full max-w-sm">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder={t('suppliers.searchPlaceholder', 'Search suppliers...')}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-10 rounded-xl bg-card border-none shadow-sm focus-visible:ring-1 focus-visible:ring-primary/50 transition-all"
                    />
                </div>
            </div>

            <Card className="rounded-2xl overflow-hidden border-2 shadow-sm">
                <CardHeader className="bg-muted/30 border-b">
                    <CardTitle className="text-lg font-bold flex items-center gap-2">
                        <Truck className="w-5 h-5 text-primary/70" />
                        {t('suppliers.listTitle', 'Suppliers List')}
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader className="bg-muted/20">
                            <TableRow className="hover:bg-transparent border-b">
                                <TableHead className="font-bold py-4 pl-6 text-primary/80">{t('suppliers.table.company', 'Company')}</TableHead>
                                <TableHead className="font-bold">{t('suppliers.table.contact', 'Contact')}</TableHead>
                                <TableHead className="font-bold">{t('suppliers.table.email', 'Email')}</TableHead>
                                <TableHead className="font-bold">{t('suppliers.table.phone', 'Phone')}</TableHead>
                                <TableHead className="font-bold">{t('suppliers.table.currency', 'Currency')}</TableHead>
                                <TableHead className="text-right font-bold pr-6">{t('suppliers.table.actions', 'Actions')}</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filteredSuppliers.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={6} className="h-48 text-center bg-muted/5">
                                        <div className="flex flex-col items-center justify-center gap-2 opacity-30">
                                            <Truck className="w-12 h-12" />
                                            <p className="text-sm font-medium">{t('common.noData', 'No results found.')}</p>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ) : (
                                filteredSuppliers.map((supplier) => (
                                    <TableRow key={supplier.id} className="group hover:bg-muted/30 transition-colors border-b last:border-0 text-foreground/80">
                                        <TableCell className="font-bold pl-6 text-foreground">{supplier.name}</TableCell>
                                        <TableCell className="font-medium">{supplier.contactName || '-'}</TableCell>
                                        <TableCell className="text-xs">{supplier.email || '-'}</TableCell>
                                        <TableCell className="text-xs font-mono">{supplier.phone || '-'}</TableCell>
                                        <TableCell>
                                            <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-secondary/50 text-secondary-foreground uppercase tracking-widest">
                                                {supplier.defaultCurrency}
                                            </span>
                                        </TableCell>
                                        <TableCell className="text-right pr-6">
                                            <div className="flex justify-end gap-1 opacity-10 md:opacity-0 group-hover:opacity-100 transition-opacity">
                                                <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl hover:bg-primary/10 hover:text-primary transition-all" onClick={() => openEditDialog(supplier)}>
                                                    <Edit className="h-4 w-4" />
                                                </Button>
                                                <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl hover:bg-destructive/10 hover:text-destructive transition-all" onClick={() => setDeletingSupplier(supplier)}>
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
        </div >
    )
}
