import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/ui/components/dialog'
import { Button } from '@/ui/components/button'
import { Input } from '@/ui/components/input'
import { Label } from '@/ui/components/label'
import { Textarea } from '@/ui/components/textarea'
import { CurrencySelector } from '@/ui/components/CurrencySelector'
import type { Customer, CurrencyCode } from '@/local-db/models'

interface CustomerFormData {
    name: string
    email: string
    phone: string
    address: string
    city: string
    country: string
    defaultCurrency: CurrencyCode
    creditLimit: number
    notes: string
}

const initialData: CustomerFormData = {
    name: '',
    email: '',
    phone: '',
    address: '',
    city: '',
    country: '',
    defaultCurrency: 'usd',
    creditLimit: 0,
    notes: ''
}

interface CustomerDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    customer?: Customer
    onSave: (data: CustomerFormData) => Promise<void>
}

export function CustomerDialog({ open, onOpenChange, customer, onSave }: CustomerDialogProps) {
    const { t } = useTranslation()
    const [formData, setFormData] = useState<CustomerFormData>(initialData)
    const [isSubmitting, setIsSubmitting] = useState(false)

    useEffect(() => {
        if (customer) {
            setFormData({
                name: customer.name,
                email: customer.email || '',
                phone: customer.phone || '',
                address: customer.address || '',
                city: customer.city || '',
                country: customer.country || '',
                defaultCurrency: customer.defaultCurrency || 'usd',
                creditLimit: customer.creditLimit || 0,
                notes: customer.notes || ''
            })
        } else {
            setFormData(initialData)
        }
    }, [customer, open])

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!formData.name) return

        setIsSubmitting(true)
        try {
            await onSave(formData)
            onOpenChange(false)
        } catch (error) {
            console.error('Failed to save customer', error)
        } finally {
            setIsSubmitting(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{customer ? t('customers.editCustomer', 'Edit Customer') : t('customers.addCustomer', 'New Customer')}</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="col-span-2 space-y-2">
                            <Label htmlFor="name">{t('customers.form.name', 'Customer Name')} *</Label>
                            <Input
                                id="name"
                                value={formData.name}
                                onChange={e => setFormData({ ...formData, name: e.target.value })}
                                required
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="email">{t('customers.form.email', 'Email')}</Label>
                            <Input
                                id="email"
                                type="email"
                                value={formData.email}
                                onChange={e => setFormData({ ...formData, email: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="phone">{t('customers.form.phone', 'Phone')}</Label>
                            <Input
                                id="phone"
                                value={formData.phone}
                                onChange={e => setFormData({ ...formData, phone: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <CurrencySelector
                                label={t('customers.form.defaultCurrency', 'Default Currency') as string}
                                value={formData.defaultCurrency}
                                onChange={v => setFormData({ ...formData, defaultCurrency: v })}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="creditLimit">{t('customers.form.creditLimit', 'Credit Limit')}</Label>
                            <Input
                                id="creditLimit"
                                type="number"
                                min="0"
                                value={formData.creditLimit}
                                onChange={e => setFormData({ ...formData, creditLimit: parseFloat(e.target.value) || 0 })}
                            />
                        </div>
                        <div className="col-span-2 space-y-2">
                            <Label htmlFor="address">{t('customers.form.address', 'Address')}</Label>
                            <Input
                                id="address"
                                value={formData.address}
                                onChange={e => setFormData({ ...formData, address: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="city">{t('customers.form.city', 'City')}</Label>
                            <Input
                                id="city"
                                value={formData.city}
                                onChange={e => setFormData({ ...formData, city: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="country">{t('customers.form.country', 'Country')}</Label>
                            <Input
                                id="country"
                                value={formData.country}
                                onChange={e => setFormData({ ...formData, country: e.target.value })}
                            />
                        </div>
                        <div className="col-span-2 space-y-2">
                            <Label htmlFor="notes">{t('customers.form.notes', 'Notes')}</Label>
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
