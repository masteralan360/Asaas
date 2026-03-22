import { useState, useMemo } from 'react'
import { transferInventoryBetweenStorages, useInventory, useProducts, useStorages } from '@/local-db'
import { useWorkspace } from '@/workspace'
import { Button } from '@/ui/components/button'
import { ArrowRightLeft, Check, Warehouse, Package, ChevronRight } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/ui/components/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/components/select'
import { Label } from '@/ui/components/label'
import { Input } from '@/ui/components/input'
import { useTranslation } from 'react-i18next'
import { useToast } from '@/ui/components/use-toast'
import { Checkbox } from '@/ui/components'

export default function InventoryTransfer() {
    const { t } = useTranslation()
    const { activeWorkspace } = useWorkspace()
    const storages = useStorages(activeWorkspace?.id)
    const inventory = useInventory(activeWorkspace?.id)
    const products = useProducts(activeWorkspace?.id)
    const { toast } = useToast()

    const [sourceStorageId, setSourceStorageId] = useState<string>('')
    const [targetStorageId, setTargetStorageId] = useState<string>('')
    const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set())
    const [transferQuantities, setTransferQuantities] = useState<Record<string, string>>({})
    const [isTransferring, setIsTransferring] = useState(false)

    const sourceProducts = useMemo(() => inventory
        .filter((row) => row.storageId === sourceStorageId)
        .map((row) => {
            const product = products.find((entry) => entry.id === row.productId)
            if (!product || product.isDeleted) {
                return null
            }

            return { row, product }
        })
        .filter((entry): entry is { row: (typeof inventory)[number]; product: (typeof products)[number] } => !!entry),
    [inventory, products, sourceStorageId])

    const availableTargetStorages = useMemo(
        () => storages.filter(s => s.id !== sourceStorageId),
        [storages, sourceStorageId]
    )

    const toggleProduct = (productId: string, availableQuantity: number) => {
        setSelectedProductIds(prev => {
            const next = new Set(prev)
            const isSelected = next.has(productId)
            if (isSelected) {
                next.delete(productId)
            } else {
                next.add(productId)
            }

            setTransferQuantities(current => {
                const nextQuantities = { ...current }
                if (isSelected) {
                    delete nextQuantities[productId]
                } else if (!nextQuantities[productId]) {
                    nextQuantities[productId] = String(availableQuantity)
                }
                return nextQuantities
            })

            return next
        })
    }

    const selectAllProducts = () => {
        if (selectedProductIds.size === sourceProducts.length) {
            setSelectedProductIds(new Set())
            setTransferQuantities({})
        } else {
            setSelectedProductIds(new Set(sourceProducts.map(({ product }) => product.id)))
            setTransferQuantities(current => {
                const nextQuantities: Record<string, string> = {}
                for (const { product, row } of sourceProducts) {
                    nextQuantities[product.id] = current[product.id] || String(row.quantity)
                }
                return nextQuantities
            })
        }
    }

    const selectedTransferItems = useMemo(() => sourceProducts
        .filter(({ product }) => selectedProductIds.has(product.id))
        .map(({ product, row }) => ({
            productId: product.id,
            productName: product.name,
            unit: product.unit,
            availableQuantity: row.quantity,
            quantity: Number(transferQuantities[product.id] || 0)
        })),
    [selectedProductIds, sourceProducts, transferQuantities])

    const hasInvalidTransferQuantity = selectedTransferItems.some((item) =>
        !Number.isInteger(item.quantity) || item.quantity <= 0 || item.quantity > item.availableQuantity
    )

    const handleTransfer = async () => {
        if (!activeWorkspace || !targetStorageId || selectedProductIds.size === 0) return

        if (hasInvalidTransferQuantity) {
            toast({
                title: t('common.error', 'Error'),
                description: t('inventoryTransfer.invalidQuantity', 'Enter a valid quantity for each selected product.'),
                variant: 'destructive'
            })
            return
        }

        setIsTransferring(true)

        try {
            const result = await transferInventoryBetweenStorages(
                activeWorkspace.id,
                sourceStorageId,
                targetStorageId,
                selectedTransferItems.map((item) => ({
                    productId: item.productId,
                    quantity: item.quantity
                }))
            )

            const targetStorage = storages.find(s => s.id === targetStorageId)
            const storageDisplayName = targetStorage?.isSystem
                ? (t(`storages.${targetStorage.name.toLowerCase()}`) || targetStorage.name)
                : targetStorage?.name || '';

            toast({
                title: t('inventoryTransfer.success', 'Transfer Complete'),
                description: t('inventoryTransfer.successMessage', '{{count}} products moved to {{storage}}', {
                    count: result.movedCount,
                    storage: storageDisplayName
                })
            })

            // Reset state
            setSelectedProductIds(new Set())
            setTransferQuantities({})
            setTargetStorageId('')
        } catch (error) {
            toast({
                title: t('common.error', 'Error'),
                description: error instanceof Error
                    ? error.message
                    : t('inventoryTransfer.error', 'Failed to transfer products'),
                variant: 'destructive'
            })
        } finally {
            setIsTransferring(false)
        }
    }

    const sourceStorage = storages.find(s => s.id === sourceStorageId)
    const targetStorage = storages.find(s => s.id === targetStorageId)

    const sourceDisplayName = sourceStorage?.isSystem
        ? (t(`storages.${sourceStorage.name.toLowerCase()}`) || sourceStorage.name)
        : sourceStorage?.name;
    const targetDisplayName = targetStorage?.isSystem
        ? (t(`storages.${targetStorage.name.toLowerCase()}`) || targetStorage.name)
        : targetStorage?.name;

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-2">
                <h1 className="text-2xl font-bold flex items-center gap-2">
                    <ArrowRightLeft className="w-6 h-6 text-primary" />
                    {t('inventoryTransfer.title', 'Inventory Transfer')}
                </h1>
                <p className="text-muted-foreground">
                    {t('inventoryTransfer.subtitle', 'Move products between storage locations.')}
                </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Step 1: Select Source */}
                <Card className="rounded-2xl border-2 shadow-sm">
                    <CardHeader className="bg-muted/30 border-b p-4">
                        <CardTitle className="text-base font-bold flex items-center gap-2">
                            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold">1</span>
                            {t('inventoryTransfer.selectSource', 'Select Source')}
                        </CardTitle>
                        <CardDescription>{t('inventoryTransfer.sourceDescription', 'Choose storage to transfer from')}</CardDescription>
                    </CardHeader>
                    <CardContent className="p-4 space-y-4">
                        <Select value={sourceStorageId} onValueChange={id => {
                            setSourceStorageId(id)
                            setTargetStorageId('')
                            setSelectedProductIds(new Set())
                            setTransferQuantities({})
                        }}>
                            <SelectTrigger className="rounded-xl">
                                <SelectValue placeholder={t('inventoryTransfer.selectStorage', 'Select storage...')} />
                            </SelectTrigger>
                            <SelectContent>
                                {storages.map(s => (
                                    <SelectItem key={s.id} value={s.id}>
                                        <div className="flex items-center gap-2">
                                            <Warehouse className="w-4 h-4" />
                                            {s.isSystem ? (t(`storages.${s.name.toLowerCase()}`) || s.name) : s.name}
                                        </div>
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>

                        {sourceStorageId && (
                            <div className="text-sm text-muted-foreground">
                                {sourceProducts.length} {t('inventoryTransfer.productsAvailable', 'products available')}
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Step 2: Select Products */}
                <Card className="rounded-2xl border-2 shadow-sm">
                    <CardHeader className="bg-muted/30 border-b p-4">
                        <CardTitle className="text-base font-bold flex items-center gap-2">
                            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold">2</span>
                            {t('inventoryTransfer.selectProducts', 'Select Products')}
                        </CardTitle>
                        <CardDescription>{t('inventoryTransfer.productsDescription', 'Choose products to transfer')}</CardDescription>
                    </CardHeader>
                    <CardContent className="p-4">
                        {!sourceStorageId ? (
                            <div className="text-center text-muted-foreground py-8">
                                <Package className="w-8 h-8 mx-auto mb-2 opacity-30" />
                                <p className="text-sm">{t('inventoryTransfer.selectSourceFirst', 'Select a source storage first')}</p>
                            </div>
                        ) : sourceProducts.length === 0 ? (
                            <div className="text-center text-muted-foreground py-8">
                                <Package className="w-8 h-8 mx-auto mb-2 opacity-30" />
                                <p className="text-sm">{t('inventoryTransfer.noProducts', 'No products in this storage')}</p>
                            </div>
                        ) : (
                            <div className="space-y-2 max-h-64 overflow-y-auto">
                                <div className="flex items-center gap-2 pb-2 border-b">
                                    <Checkbox
                                        id="select-all"
                                        checked={selectedProductIds.size === sourceProducts.length}
                                        onCheckedChange={selectAllProducts}
                                    />
                                    <Label htmlFor="select-all" className="text-sm font-medium cursor-pointer">
                                        {t('common.selectAll', 'Select All')} ({sourceProducts.length})
                                    </Label>
                                </div>
                                {sourceProducts.map(({ row, product }) => (
                                    <div key={row.id} className="flex items-center gap-3 p-2 hover:bg-muted/30 rounded-lg transition-colors">
                                        <Checkbox
                                            id={product.id}
                                            checked={selectedProductIds.has(product.id)}
                                            onCheckedChange={() => toggleProduct(product.id, row.quantity)}
                                        />
                                        <Label htmlFor={product.id} className="flex-1 cursor-pointer">
                                            <div className="flex items-center justify-between">
                                                <span className="text-sm font-medium">{product.name}</span>
                                                <span className="text-xs text-muted-foreground">
                                                    {row.quantity} {product.unit}
                                                </span>
                                            </div>
                                            <div className="text-xs text-muted-foreground">{product.sku}</div>
                                        </Label>
                                        <div className="w-24">
                                            <Input
                                                type="number"
                                                min="1"
                                                max={row.quantity}
                                                step="1"
                                                value={transferQuantities[product.id] || ''}
                                                disabled={!selectedProductIds.has(product.id)}
                                                onChange={(event) => setTransferQuantities((current) => ({
                                                    ...current,
                                                    [product.id]: event.target.value
                                                }))}
                                                className="h-9 rounded-lg text-center"
                                                aria-label={`${product.name} ${t('common.quantity', 'Quantity')}`}
                                            />
                                            {selectedProductIds.has(product.id) && (
                                                <div className="mt-1 text-[11px] text-muted-foreground text-center">
                                                    {`${t('inventoryTransfer.available', 'Available')}: ${row.quantity} ${product.unit}`}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Step 3: Select Destination */}
                <Card className="rounded-2xl border-2 shadow-sm">
                    <CardHeader className="bg-muted/30 border-b p-4">
                        <CardTitle className="text-base font-bold flex items-center gap-2">
                            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold">3</span>
                            {t('inventoryTransfer.selectDestination', 'Select Destination')}
                        </CardTitle>
                        <CardDescription>{t('inventoryTransfer.destinationDescription', 'Choose target storage')}</CardDescription>
                    </CardHeader>
                    <CardContent className="p-4 space-y-4">
                        <Select value={targetStorageId} onValueChange={setTargetStorageId} disabled={!sourceStorageId}>
                            <SelectTrigger className="rounded-xl">
                                <SelectValue placeholder={t('inventoryTransfer.selectStorage', 'Select storage...')} />
                            </SelectTrigger>
                            <SelectContent>
                                {availableTargetStorages.map(s => (
                                    <SelectItem key={s.id} value={s.id}>
                                        <div className="flex items-center gap-2">
                                            <Warehouse className="w-4 h-4" />
                                            {s.isSystem ? (t(`storages.${s.name.toLowerCase()}`) || s.name) : s.name}
                                        </div>
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>

                        {selectedProductIds.size > 0 && targetStorageId && (
                            <div className="p-3 bg-primary/5 rounded-xl border border-primary/20">
                                <div className="flex items-center gap-2 text-sm">
                                    <span className="font-medium">{sourceDisplayName}</span>
                                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                                    <span className="font-medium">{targetDisplayName}</span>
                                </div>
                                <div className="text-xs text-muted-foreground mt-1">
                                    {selectedProductIds.size} {t('inventoryTransfer.productsSelected', 'products selected')}
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* Transfer Button */}
            <div className="flex justify-end">
                <Button
                    onClick={handleTransfer}
                    disabled={!sourceStorageId || !targetStorageId || selectedProductIds.size === 0 || hasInvalidTransferQuantity || isTransferring}
                    className="rounded-xl shadow-lg px-8 gap-2"
                    size="lg"
                >
                    {isTransferring ? (
                        <>
                            <ArrowRightLeft className="w-5 h-5 animate-spin" />
                            {t('inventoryTransfer.transferring', 'Transferring...')}
                        </>
                    ) : (
                        <>
                            <Check className="w-5 h-5" />
                            {t('inventoryTransfer.confirmTransfer', 'Confirm Transfer')}
                        </>
                    )}
                </Button>
            </div>
        </div>
    )
}
