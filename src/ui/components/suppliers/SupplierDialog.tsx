import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/ui/components/dialog'
import { Button } from '@/ui/components/button'
import { Input } from '@/ui/components/input'
import { Label } from '@/ui/components/label'
import { Textarea } from '@/ui/components/textarea'
import { CurrencySelector } from '@/ui/components/CurrencySelector'
import type { Supplier, CurrencyCode } from '@/local-db/models'

interface SupplierFormData {
    name: string
    contactName: string
    email: string
    phone: string
    address: string
    city: string
    country: string
    defaultCurrency: CurrencyCode
    creditLimit: number
    notes: string
}

const initialData: SupplierFormData = {
    name: '',
    contactName: '',
    email: '',
    phone: '',
    address: '',
    city: '',
    country: '',
    defaultCurrency: 'usd',
    creditLimit: 0,
    notes: ''
}

interface SupplierDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    supplier?: Supplier
    onSave: (data: SupplierFormData) => Promise<void>
}

export function SupplierDialog({ open, onOpenChange, supplier, onSave }: SupplierDialogProps) {
    const { t } = useTranslation()
    const [formData, setFormData] = useState<SupplierFormData>(initialData)
    const [isSubmitting, setIsSubmitting] = useState(false)

    useEffect(() => {
        if (supplier) {
            setFormData({
                name: supplier.name,
                contactName: supplier.contactName || '',
                email: supplier.email || '',
                phone: supplier.phone || '',
                address: supplier.address || '',
                city: supplier.city || '',
                country: supplier.country || '',
                defaultCurrency: supplier.defaultCurrency,
                creditLimit: supplier.creditLimit || 0,
                notes: supplier.notes || ''
            })
        } else {
            setFormData(initialData)
        }
    }, [supplier, open])

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!formData.name) return

        setIsSubmitting(true)
        try {
            await onSave(formData)
            onOpenChange(false)
        } catch (error) {
            console.error('Failed to save supplier', error)
        } finally {
            setIsSubmitting(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{supplier ? t('suppliers.editSupplier', 'Edit Supplier') : t('suppliers.addSupplier', 'New Supplier')}</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="col-span-2 space-y-2">
                            <Label htmlFor="name">{t('suppliers.form.name', 'Company Name')} *</Label>
                            <Input
                                id="name"
                                value={formData.name}
                                onChange={e => setFormData({ ...formData, name: e.target.value })}
                                required
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="contactName">{t('suppliers.form.contactName', 'Contact Name')}</Label>
                            <Input
                                id="contactName"
                                value={formData.contactName}
                                onChange={e => setFormData({ ...formData, contactName: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="email">{t('suppliers.form.email', 'Email')}</Label>
                            <Input
                                id="email"
                                type="email"
                                value={formData.email}
                                onChange={e => setFormData({ ...formData, email: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="phone">{t('suppliers.form.phone', 'Phone')}</Label>
                            <Input
                                id="phone"
                                value={formData.phone}
                                onChange={e => setFormData({ ...formData, phone: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <CurrencySelector
                                label={t('suppliers.form.defaultCurrency', 'Default Currency') as string}
                                value={formData.defaultCurrency}
                                onChange={v => setFormData({ ...formData, defaultCurrency: v })}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="creditLimit">{t('suppliers.form.creditLimit', 'Credit Limit')}</Label>
                            <Input
                                id="creditLimit"
                                type="number"
                                min="0"
                                value={formData.creditLimit}
                                onChange={e => setFormData({ ...formData, creditLimit: parseFloat(e.target.value) || 0 })}
                            />
                        </div>
                        <div className="col-span-2 space-y-2">
                            <Label htmlFor="address">{t('suppliers.form.address', 'Address')}</Label>
                            <Input
                                id="address"
                                value={formData.address}
                                onChange={e => setFormData({ ...formData, address: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="city">{t('suppliers.form.city', 'City')}</Label>
                            <Input
                                id="city"
                                value={formData.city}
                                onChange={e => setFormData({ ...formData, city: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="country">{t('suppliers.form.country', 'Country')}</Label>
                            <Input
                                id="country"
                                value={formData.country}
                                onChange={e => setFormData({ ...formData, country: e.target.value })}
                            />
                        </div>
                        <div className="col-span-2 space-y-2">
                            <Label htmlFor="notes">{t('suppliers.form.notes', 'Notes')}</Label>
                            <Textarea
                                id="notes"
                                value={formData.notes}
                                onChange={e => setFormData({ ...formData, notes: e.target.value })}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                            {t('common.cancel', 'Cancel')}
                        </Button>
                        <Button type="submit" disabled={isSubmitting}>
                            {isSubmitting ? t('common.saving', 'Saving...') : t('common.save', 'Save')}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}
