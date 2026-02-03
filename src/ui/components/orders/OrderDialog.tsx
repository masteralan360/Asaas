import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/ui/components/dialog'
import { Button } from '@/ui/components/button'
import { Input } from '@/ui/components/input'
import { Label } from '@/ui/components/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/components/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/components/table'
import { CurrencySelector } from '@/ui/components/CurrencySelector'
import { useProducts, useSuppliers, useCustomers } from '@/local-db'
import { useWorkspace } from '@/workspace'
import { Plus, Trash2 } from 'lucide-react'
import { useExchangeRate } from '@/context/ExchangeRateContext'
import type { PurchaseOrder, SalesOrder, CurrencyCode, PurchaseOrderItem, SalesOrderItem } from '@/local-db/models'

// Helper type for form items
interface OrderItemRow {
    productId: string
    quantity: number
    unitPrice: number // Represents cost for Purchase, price for Sales
    total: number
    // Display helpers
    productName?: string
    sku?: string
}

interface OrderDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    mode: 'purchase' | 'sales'
    order?: PurchaseOrder | SalesOrder
    onSave: (data: any) => Promise<void>
}

export function OrderDialog({ open, onOpenChange, mode, order, onSave }: OrderDialogProps) {
    const { t } = useTranslation()
    const { activeWorkspace } = useWorkspace()
    const products = useProducts(activeWorkspace?.id)
    const suppliers = useSuppliers(activeWorkspace?.id)
    const customers = useCustomers(activeWorkspace?.id)
    const { exchangeData, eurRates, tryRates } = useExchangeRate()

    // Conversion Helper
    const convertPrice = (amount: number, from: CurrencyCode, to: CurrencyCode) => {
        if (from === to) return amount

        const getRate = (pair: 'usd_iqd' | 'usd_eur' | 'eur_iqd') => {
            if (pair === 'usd_iqd') return exchangeData ? exchangeData.rate / 100 : null
            if (pair === 'usd_eur') return eurRates.usd_eur ? eurRates.usd_eur.rate / 100 : null
            if (pair === 'eur_iqd') return eurRates.eur_iqd ? eurRates.eur_iqd.rate / 100 : null
            return null
        }

        let converted = amount

        if (from === 'usd' && to === 'iqd') {
            const r = getRate('usd_iqd'); if (r) converted = amount * r
        } else if (from === 'iqd' && to === 'usd') {
            const r = getRate('usd_iqd'); if (r) converted = amount / r
        } else if (from === 'usd' && to === 'eur') {
            const r = getRate('usd_eur'); if (r) converted = amount * r
        } else if (from === 'eur' && to === 'usd') {
            const r = getRate('usd_eur'); if (r) converted = amount / r
        } else if (from === 'eur' && to === 'iqd') {
            const r = getRate('eur_iqd'); if (r) converted = amount * r
        } else if (from === 'iqd' && to === 'eur') {
            const r = getRate('eur_iqd'); if (r) converted = amount / r
        } else if (from === 'try' && to === 'iqd') {
            if (tryRates.try_iqd) converted = amount * (tryRates.try_iqd.rate / 100)
        } else if (from === 'iqd' && to === 'try') {
            if (tryRates.try_iqd) converted = amount / (tryRates.try_iqd.rate / 100)
        } else if (from === 'usd' && to === 'try') {
            if (tryRates.usd_try) converted = amount * (tryRates.usd_try.rate / 100)
        } else if (from === 'try' && to === 'usd') {
            if (tryRates.usd_try) converted = amount / (tryRates.usd_try.rate / 100)
        } else if (from === 'try' && to === 'eur') {
            const tryIqdRate = tryRates.try_iqd ? tryRates.try_iqd.rate / 100 : null
            const eurIqdRate = eurRates.eur_iqd ? eurRates.eur_iqd.rate / 100 : null
            if (tryIqdRate && eurIqdRate) converted = (amount * tryIqdRate) / eurIqdRate
        } else if (from === 'eur' && to === 'try') {
            const eurIqdRate = eurRates.eur_iqd ? eurRates.eur_iqd.rate / 100 : null
            const tryIqdRate = tryRates.try_iqd ? tryRates.try_iqd.rate / 100 : null
            if (eurIqdRate && tryIqdRate) converted = (amount * eurIqdRate) / tryIqdRate
        }

        return to === 'iqd' ? Math.round(converted) : Math.round(converted * 100) / 100
    }

    // Form State
    const [date, setDate] = useState(new Date().toISOString().split('T')[0])
    const [entityId, setEntityId] = useState('') // supplierId or customerId
    const [currency, setCurrency] = useState<CurrencyCode>('usd')
    const [status, setStatus] = useState('draft')
    const [items, setItems] = useState<OrderItemRow[]>([])
    const [isSubmitting, setIsSubmitting] = useState(false)

    // Initialize/Reset
    useEffect(() => {
        if (open) {
            if (order) {
                // Edit mode
                setDate(order.createdAt.split('T')[0]) // Simplified date
                setEntityId(mode === 'purchase' ? (order as PurchaseOrder).supplierId : (order as SalesOrder).customerId)
                setCurrency(order.currency)
                setStatus(order.status)

                setItems(order.items.map(item => {
                    const product = products.find(p => p.id === item.productId)
                    // Determine unit price based on type
                    let price = 0
                    if (mode === 'purchase') {
                        price = (item as unknown as PurchaseOrderItem).unitCost || 0
                    } else {
                        price = (item as unknown as SalesOrderItem).unitPrice || 0
                    }

                    return {
                        productId: item.productId,
                        quantity: item.quantity,
                        unitPrice: price,
                        total: item.quantity * price,
                        productName: product?.name || item.productName || 'Unknown Product',
                        sku: product?.sku || item.productSku
                    }
                }))
            } else {
                // New mode
                setDate(new Date().toISOString().split('T')[0])
                setEntityId('')
                setCurrency('usd')
                setStatus('draft')
                setItems([])
            }
        }
    }, [open, order, mode, products]) // Dependencies: reset when opening

    // When entity changes, auto-set currency if fresh form
    useEffect(() => {
        if (order) return // Don't override on edit
        if (!entityId) return

        if (mode === 'purchase') {
            const supplier = suppliers.find(s => s.id === entityId)
            if (supplier && supplier.defaultCurrency) setCurrency(supplier.defaultCurrency)
        } else {
            const customer = customers.find(c => c.id === entityId)
            if (customer && customer.defaultCurrency) setCurrency(customer.defaultCurrency)
        }
    }, [entityId, mode, suppliers, customers, order])

    // Calculations
    const subtotal = items.reduce((sum, item) => sum + (item.total || 0), 0)
    // Add tax logic later if needed
    const total = subtotal

    // Item Handlers
    const addItem = () => {
        setItems([...items, { productId: '', quantity: 1, unitPrice: 0, total: 0 }])
    }

    const updateItem = (index: number, field: keyof OrderItemRow, value: any) => {
        const newItems = [...items]
        const item = { ...newItems[index], [field]: value }

        if (field === 'productId') {
            const product = products.find(p => p.id === value)
            if (product) {
                item.productName = product.name
                item.sku = product.sku
                // Set default price
                // Set default price with conversion
                const basePrice = mode === 'purchase' ? (product.costPrice || 0) : (product.price || 0)
                // Assuming product.currency is available, defaulting to 'usd' if missing (fallback)
                const prodCurrency = product.currency || 'usd'
                item.unitPrice = convertPrice(basePrice, prodCurrency, currency)
            }
        }

        // Recalculate total
        if (field === 'quantity' || field === 'unitPrice' || field === 'productId') {
            item.total = (item.quantity || 0) * (item.unitPrice || 0)
        }

        newItems[index] = item
        setItems(newItems)
    }

    const removeItem = (index: number) => {
        setItems(items.filter((_, i) => i !== index))
    }

    const handleCurrencyChange = (newCurrency: CurrencyCode) => {
        const oldCurrency = currency
        // Convert all existing items
        const newItems = items.map(item => {
            const newPrice = convertPrice(item.unitPrice, oldCurrency, newCurrency)
            return {
                ...item,
                unitPrice: newPrice,
                total: (item.quantity || 0) * newPrice
            }
        })
        setItems(newItems)
        setCurrency(newCurrency)
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!entityId || items.length === 0) return

        setIsSubmitting(true)
        try {
            const payload = {
                // Common fields
                status,
                currency,
                total,
                // Exchange Rate Snapshot
                exchangeRate: (() => {
                    if (currency === 'iqd' && exchangeData) return exchangeData.rate / 100
                    if (currency === 'eur' && eurRates.usd_eur) return eurRates.usd_eur.rate / 100
                    if (currency === 'try' && tryRates.usd_try) return tryRates.usd_try.rate / 100
                    return 1
                })(),
                exchangeRateSource: exchangeData ? exchangeData.source : 'manual',
                exchangeRateTimestamp: new Date().toISOString(),
                exchangeRates: { usd_iqd: exchangeData, eur: eurRates, try: tryRates },

                items: items.map(i => {
                    const product = products.find(p => p.id === i.productId)
                    const prodCurrency = product?.currency || 'usd'

                    const baseItem = {
                        productId: i.productId,
                        productName: i.productName || product?.name || 'Unknown',
                        productSku: i.sku || product?.sku || '',
                        quantity: i.quantity,
                        total: i.total
                    }

                    if (mode === 'purchase') {
                        return {
                            ...baseItem,
                            unitCost: i.unitPrice, // Map UI 'unitPrice' to 'unitCost'
                            originalCurrency: prodCurrency,
                            originalUnitCost: product?.costPrice || 0,
                            convertedUnitCost: i.unitPrice
                        }
                    } else {
                        return {
                            ...baseItem,
                            unitPrice: i.unitPrice,
                            costPrice: product?.costPrice || 0, // Track cost for profit
                            originalCurrency: prodCurrency,
                            originalUnitPrice: product?.price || 0,
                            convertedUnitPrice: i.unitPrice,
                            reservedQuantity: i.quantity // Immediate reservation
                        }
                    }
                }),
                // Specific fields
                ...(mode === 'purchase' ? { supplierId: entityId } : { customerId: entityId }),
            }
            await onSave(payload)
            onOpenChange(false)
        } catch (err) {
            console.error(err)
        } finally {
            setIsSubmitting(false)
        }
    }

    // Filtered products for dropdown (simplistic)
    const productOptions = useMemo(() => {
        return products.map(p => ({ label: `${p.sku} - ${p.name}`, value: p.id }))
    }, [products])

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{order ? (mode === 'purchase' ? t('orders.form.editPurchaseOrder', 'Edit Purchase Order') : t('orders.form.editSalesOrder', 'Edit Sales Order')) : (mode === 'purchase' ? t('orders.form.newPurchaseOrder', 'New Purchase Order') : t('orders.form.newSalesOrder', 'New Sales Order'))}</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-6">
                    {/* Header Fields */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <div className="md:col-span-2 space-y-2">
                            <Label>{mode === 'purchase' ? t('orders.form.supplier', 'Supplier') : t('orders.form.customer', 'Customer')}</Label>
                            <Select value={entityId} onValueChange={setEntityId}>
                                <SelectTrigger>
                                    <SelectValue placeholder={mode === 'purchase' ? t('orders.form.selectSupplier', 'Select Supplier') : t('orders.form.selectCustomer', 'Select Customer')} />
                                </SelectTrigger>
                                <SelectContent>
                                    {mode === 'purchase'
                                        ? suppliers.map(s => (
                                            <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                                        ))
                                        : customers.map(c => (
                                            <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                                        ))
                                    }
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>{t('orders.form.date', 'Date')}</Label>
                            <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <CurrencySelector
                                value={currency}
                                onChange={handleCurrencyChange}
                                label={t('orders.form.currency', 'Currency') as string}
                            />
                        </div>
                    </div>

                    {/* Items Table */}
                    <div className="border rounded-md">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-[40%]">{t('orders.form.table.product', 'Product')}</TableHead>
                                    <TableHead className="w-[15%]">{t('orders.form.table.qty', 'Quantity')}</TableHead>
                                    <TableHead className="w-[20%]">{t('orders.form.table.price', 'Unit Price')}</TableHead>
                                    <TableHead className="w-[20%] text-right">{t('orders.form.table.total', 'Total')}</TableHead>
                                    <TableHead className="w-[5%]"></TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {items.map((item, index) => (
                                    <TableRow key={index}>
                                        <TableCell>
                                            <Select value={item.productId} onValueChange={(v) => updateItem(index, 'productId', v)}>
                                                <SelectTrigger>
                                                    <SelectValue placeholder={t('orders.form.selectProduct', 'Select Product')} />
                                                </SelectTrigger>
                                                <SelectContent className="max-h-[300px]">
                                                    {productOptions.map(opt => (
                                                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </TableCell>
                                        <TableCell>
                                            <Input
                                                type="number"
                                                min="1"
                                                value={item.quantity}
                                                onChange={e => updateItem(index, 'quantity', parseFloat(e.target.value) || 0)}
                                            />
                                        </TableCell>
                                        <TableCell>
                                            <Input
                                                type="number"
                                                min="0"
                                                step="0.01"
                                                value={item.unitPrice}
                                                onChange={e => updateItem(index, 'unitPrice', parseFloat(e.target.value) || 0)}
                                            />
                                        </TableCell>
                                        <TableCell className="text-right">
                                            {item.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </TableCell>
                                        <TableCell>
                                            <Button type="button" variant="ghost" size="icon" onClick={() => removeItem(index)}>
                                                <Trash2 className="h-4 w-4 text-destructive" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                                {items.length === 0 && (
                                    <TableRow>
                                        <TableCell colSpan={5} className="text-center h-24 text-muted-foreground">
                                            {t('orders.form.noItems', 'No items added.')}
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </div>

                    <Button type="button" variant="outline" onClick={addItem} className="w-full">
                        <Plus className="mr-2 h-4 w-4" /> {t('orders.form.addItem', 'Add Item')}
                    </Button>

                    <div className="flex justify-end text-right">
                        <div className="w-48 space-y-2">
                            <div className="flex justify-between font-bold text-lg">
                                <span>{t('orders.form.total', 'Total')}:</span>
                                <span>{total.toLocaleString(undefined, { style: 'currency', currency: currency.toUpperCase() })}</span>
                            </div>
                        </div>
                    </div>

                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel', 'Cancel')}</Button>
                        <Button type="submit" disabled={isSubmitting || !entityId || items.length === 0}>
                            {isSubmitting ? t('common.saving', 'Saving...') : t('orders.form.saveOrder', 'Save Order')}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}
