import { useMemo, useRef, useState } from 'react'
import { Copy, Eye, ImagePlus, Link2, Loader2, MoreHorizontal, PackagePlus, Pencil, Search, Unlink, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
    createProduct,
    getPrimaryStorageFromList,
    linkProductVariant,
    unlinkProductVariant,
    type Category,
    type CurrencyCode,
    type IQDDisplayPreference,
    type Product,
    type Storage
} from '@/local-db'
import { storeProductImageFile } from '@/lib/productImageStorage'
import { platformService } from '@/services/platformService'
import { cn, formatCurrency } from '@/lib/utils'
import { ProductUnitIcon } from '@/ui/components/ProductUnitIcon'
import type { WorkspaceUnitOption } from '@/ui/components/unitRegistry'
import {
    Button,
    Card,
    CardContent,
    CardHeader,
    CurrencySelector,
    Dialog,
    DialogBody,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    Input,
    Label,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Textarea,
    useToast
} from '@/ui/components'

type VariantDraft = {
    name: string
    sku: string
    price: string
    costPrice: string
    quantity: string
    categoryId: string
    currency: CurrencyCode
    unit: string
    note: string
    imageUrl: string
}

interface ProductVariantsSectionProps {
    parent: Product
    variants: Product[]
    products: Product[]
    workspaceId: string
    userId?: string | null
    categories: Category[]
    storages: Storage[]
    unitOptions: WorkspaceUnitOption[]
    allowedCurrencies: CurrencyCode[]
    iqdDisplayPreference: IQDDisplayPreference
    canManage: boolean
    hideCosts: boolean
    onOpenProduct: (productId: string) => void
}

interface ProductVariantParentNoticeProps {
    variant: Product
    parent?: Product
    canManage: boolean
    onOpenParent: () => void
}

function createVariantDraft(parent: Product, hideCosts: boolean): VariantDraft {
    return {
        name: '',
        sku: '',
        price: String(parent.price),
        costPrice: hideCosts || parent.costPrice == null ? '' : String(parent.costPrice),
        quantity: '',
        categoryId: parent.categoryId || '',
        currency: parent.currency,
        unit: parent.unit || 'pcs',
        note: '',
        imageUrl: ''
    }
}

function getInitialStorageId(parent: Product, storages: Storage[]) {
    if (parent.storageId && storages.some((storage) => storage.id === parent.storageId && !storage.isDeleted)) {
        return parent.storageId
    }

    return getPrimaryStorageFromList(storages)?.id || ''
}

function getCurrencySymbol(currency: CurrencyCode, iqdDisplayPreference: IQDDisplayPreference) {
    switch (currency.toLowerCase()) {
        case 'usd':
            return '$'
        case 'eur':
            return 'EUR'
        case 'try':
            return 'TRY'
        case 'iqd':
            return iqdDisplayPreference
        default:
            return currency.toUpperCase()
    }
}

function VariantImage({ product }: { product: Product }) {
    if (product.imageUrl) {
        return <img src={product.imageUrl.startsWith('http') ? product.imageUrl : platformService.convertFileSrc(product.imageUrl)} alt="" className="h-10 w-10 rounded-lg border border-border/60 object-cover" />
    }

    return (
        <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-dashed border-border/70 bg-muted/30 text-muted-foreground">
            <PackagePlus className="h-4 w-4" />
        </div>
    )
}

export function ProductVariantParentNotice({ variant, parent, canManage, onOpenParent }: ProductVariantParentNoticeProps) {
    const { t } = useTranslation()
    const { toast } = useToast()
    const [isUnlinking, setIsUnlinking] = useState(false)

    const handleUnlink = async () => {
        setIsUnlinking(true)
        try {
            await unlinkProductVariant(variant.id)
            toast({
                title: t('products.variants.unlinked', { defaultValue: 'Product unlinked' }),
                description: t('products.variants.unlinkedDescription', { defaultValue: 'This product is now independent.' })
            })
        } catch (error) {
            toast({
                title: t('common.error', { defaultValue: 'Error' }),
                description: error instanceof Error ? error.message : t('products.variants.unlinkError', { defaultValue: 'Could not unlink this product.' }),
                variant: 'destructive'
            })
        } finally {
            setIsUnlinking(false)
        }
    }

    return (
        <div className="mb-6 flex flex-col gap-4 rounded-2xl border border-primary/25 bg-primary/[0.06] p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
                <p className="text-xs font-black uppercase tracking-[0.16em] text-primary">
                    {t('products.variants.variantOf', { defaultValue: 'Variant of' })}
                </p>
                <p className="mt-1 truncate text-sm font-bold text-foreground">
                    {parent?.name || t('products.variants.parentUnavailable', { defaultValue: 'Parent product unavailable' })}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                    {t('products.variants.independentDetails', { defaultValue: 'Its stock, prices, and product details remain independent.' })}
                </p>
            </div>
            <div className="flex shrink-0 gap-2">
                {parent && (
                    <Button type="button" variant="outline" size="sm" onClick={onOpenParent} className="h-10 gap-2 rounded-xl">
                        <Eye className="h-4 w-4" />
                        {t('products.variants.viewParent', { defaultValue: 'View parent' })}
                    </Button>
                )}
                {canManage && (
                    <Button type="button" variant="outline" size="sm" onClick={() => void handleUnlink()} disabled={isUnlinking} className="h-10 gap-2 rounded-xl text-destructive hover:text-destructive">
                        {isUnlinking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unlink className="h-4 w-4" />}
                        {t('products.variants.unlink', { defaultValue: 'Unlink' })}
                    </Button>
                )}
            </div>
        </div>
    )
}

export function ProductVariantsSection({
    parent,
    variants,
    products,
    workspaceId,
    userId,
    categories,
    storages,
    unitOptions,
    allowedCurrencies,
    iqdDisplayPreference,
    canManage,
    hideCosts,
    onOpenProduct
}: ProductVariantsSectionProps) {
    const { t } = useTranslation()
    const { toast } = useToast()
    const imageInputRef = useRef<HTMLInputElement>(null)
    const [isCreateOpen, setIsCreateOpen] = useState(false)
    const [isLinkOpen, setIsLinkOpen] = useState(false)
    const [isCreating, setIsCreating] = useState(false)
    const [isLinking, setIsLinking] = useState(false)
    const [unlinkingProductId, setUnlinkingProductId] = useState<string | null>(null)
    const [selectedProductId, setSelectedProductId] = useState<string | null>(null)
    const [searchTerm, setSearchTerm] = useState('')
    const [draft, setDraft] = useState<VariantDraft>(() => createVariantDraft(parent, hideCosts))

    const defaultStorageId = useMemo(() => getInitialStorageId(parent, storages), [parent, storages])
    const productsWithVariants = useMemo(
        () => new Set(products.filter((product) => product.parentProductId && !product.isDeleted).map((product) => product.parentProductId)),
        [products]
    )
    const eligibleProducts = useMemo(() => {
        const normalizedSearch = searchTerm.trim().toLocaleLowerCase()
        return products.filter((product) => {
            if (product.isDeleted || product.workspaceId !== workspaceId || product.id === parent.id) return false
            if (product.parentProductId || productsWithVariants.has(product.id)) return false
            if (!normalizedSearch) return true
            return `${product.name} ${product.sku}`.toLocaleLowerCase().includes(normalizedSearch)
        })
    }, [parent.id, products, productsWithVariants, searchTerm, workspaceId])

    const resetCreateDialog = () => {
        setDraft(createVariantDraft(parent, hideCosts))
    }

    const openCreateDialog = () => {
        resetCreateDialog()
        setIsCreateOpen(true)
    }

    const handleImageSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const image = event.target.files?.[0]
        if (!image) return

        const imageUrl = await storeProductImageFile(image, workspaceId)
        if (imageUrl) {
            setDraft((current) => ({ ...current, imageUrl }))
        }
        event.target.value = ''
    }

    const handleCreateVariant = async (event: React.FormEvent) => {
        event.preventDefault()
        const quantity = Number(draft.quantity)
        if (!Number.isFinite(quantity) || quantity <= 0) {
            toast({
                title: t('common.error', { defaultValue: 'Error' }),
                description: t('products.variants.stockMustBePositive', { defaultValue: 'Stock quantity must be greater than 0.' }),
                variant: 'destructive'
            })
            return
        }
        if (!defaultStorageId) {
            toast({
                title: t('products.noStorage.title', { defaultValue: 'No Storage Found' }),
                description: t('products.variants.storageRequired', { defaultValue: 'Create a storage before adding a variant.' }),
                variant: 'destructive'
            })
            return
        }

        const selectedCategory = categories.find((category) => category.id === draft.categoryId)
        const selectedStorage = storages.find((storage) => storage.id === defaultStorageId)
        setIsCreating(true)
        try {
            await createProduct(workspaceId, {
                parentProductId: parent.id,
                sku: draft.sku.trim(),
                name: draft.name.trim(),
                description: draft.note.trim(),
                categoryId: draft.categoryId || null,
                category: selectedCategory?.name || null,
                storageId: defaultStorageId,
                storageName: selectedStorage?.name,
                price: Number(draft.price) || 0,
                costPrice: hideCosts || draft.costPrice.trim() === '' ? null : Number(draft.costPrice),
                quantity,
                minStockLevel: 0,
                unit: draft.unit,
                currency: draft.currency,
                imageUrl: draft.imageUrl || undefined,
                canBeReturned: true,
                returnRules: '',
                createdBy: userId || null
            })
            setIsCreateOpen(false)
            toast({
                title: t('products.variants.created', { defaultValue: 'Variant created' }),
                description: t('products.variants.createdDescription', { defaultValue: 'The new product is now linked to this parent.' })
            })
        } catch (error) {
            toast({
                title: t('common.error', { defaultValue: 'Error' }),
                description: error instanceof Error ? error.message : t('products.variants.createError', { defaultValue: 'Could not create the variant.' }),
                variant: 'destructive'
            })
        } finally {
            setIsCreating(false)
        }
    }

    const handleLinkProduct = async () => {
        if (!selectedProductId) return

        setIsLinking(true)
        try {
            await linkProductVariant(parent.id, selectedProductId)
            setIsLinkOpen(false)
            setSelectedProductId(null)
            setSearchTerm('')
            toast({
                title: t('products.variants.linked', { defaultValue: 'Product linked' }),
                description: t('products.variants.linkedDescription', { defaultValue: 'The product is now a variant of this parent.' })
            })
        } catch (error) {
            toast({
                title: t('common.error', { defaultValue: 'Error' }),
                description: error instanceof Error ? error.message : t('products.variants.linkError', { defaultValue: 'Could not link this product.' }),
                variant: 'destructive'
            })
        } finally {
            setIsLinking(false)
        }
    }

    const handleUnlinkProduct = async (variant: Product) => {
        setUnlinkingProductId(variant.id)
        try {
            await unlinkProductVariant(variant.id)
            toast({
                title: t('products.variants.unlinked', { defaultValue: 'Product unlinked' }),
                description: t('products.variants.unlinkedDescription', { defaultValue: 'This product is now independent.' })
            })
        } catch (error) {
            toast({
                title: t('common.error', { defaultValue: 'Error' }),
                description: error instanceof Error ? error.message : t('products.variants.unlinkError', { defaultValue: 'Could not unlink this product.' }),
                variant: 'destructive'
            })
        } finally {
            setUnlinkingProductId(null)
        }
    }

    return (
        <>
            <Card className="overflow-hidden rounded-2xl border-border/60 shadow-sm">
                <CardHeader className="flex flex-col gap-4 border-b border-border/50 bg-muted/10 p-6 sm:flex-row sm:items-start sm:justify-between sm:p-8">
                    <div>
                        <h2 className="text-2xl font-black tracking-tight text-foreground">
                            {t('products.variants.title', { defaultValue: 'Variants ({{count}})', count: variants.length })}
                        </h2>
                        <p className="mt-1 text-sm text-muted-foreground">
                            {t('products.variants.description', { defaultValue: 'These are real products linked to this parent.' })}
                        </p>
                    </div>
                    {canManage && (
                        <div className="flex flex-col gap-2 sm:flex-row">
                            <Button type="button" onClick={openCreateDialog} className="h-11 gap-2 rounded-xl px-5 font-bold">
                                <PackagePlus className="h-4 w-4" />
                                {t('products.variants.create', { defaultValue: 'Create Variant' })}
                            </Button>
                            <Button type="button" variant="outline" onClick={() => setIsLinkOpen(true)} className="h-11 gap-2 rounded-xl px-5 font-bold">
                                <Link2 className="h-4 w-4" />
                                {t('products.variants.linkExisting', { defaultValue: 'Link Existing Product' })}
                            </Button>
                        </div>
                    )}
                </CardHeader>
                <CardContent className="p-0">
                    {variants.length === 0 ? (
                        <div className="m-6 rounded-2xl border border-dashed border-border/70 bg-muted/20 px-5 py-10 text-center sm:m-8">
                            <PackagePlus className="mx-auto h-6 w-6 text-primary/70" />
                            <p className="mt-3 font-bold text-foreground">{t('products.variants.emptyTitle', { defaultValue: 'No variants yet' })}</p>
                            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                                {t('products.variants.emptyDescription', { defaultValue: 'Create a new product or link an eligible existing product to start this variant group.' })}
                            </p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="min-w-[930px] w-full text-sm">
                                <thead className="border-b border-border/50 bg-muted/20 text-left text-xs font-black uppercase tracking-[0.12em] text-muted-foreground">
                                    <tr>
                                        <th className="px-6 py-4">{t('products.variants.variant', { defaultValue: 'Variant' })}</th>
                                        <th className="px-4 py-4">SKU</th>
                                        <th className="px-4 py-4">{t('products.barcodes.title', { defaultValue: 'Barcode' })}</th>
                                        <th className="px-4 py-4">{t('products.form.stock', { defaultValue: 'Stock' })}</th>
                                        <th className="px-4 py-4">{t('products.table.price', { defaultValue: 'Price' })}</th>
                                        {!hideCosts && <th className="px-4 py-4">{t('products.form.cost', { defaultValue: 'Cost' })}</th>}
                                        <th className="px-6 py-4 text-right">{t('common.actions', { defaultValue: 'Actions' })}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {variants.map((variant) => (
                                        <tr key={variant.id} className="border-b border-border/40 last:border-b-0 hover:bg-muted/20">
                                            <td className="px-6 py-4">
                                                <div className="flex min-w-[220px] items-center gap-3">
                                                    <VariantImage product={variant} />
                                                    <span className="font-bold text-foreground">{variant.name}</span>
                                                </div>
                                            </td>
                                            <td className="px-4 py-4 font-mono text-xs text-muted-foreground">{variant.sku || '—'}</td>
                                            <td className="px-4 py-4 font-mono text-xs text-muted-foreground">{variant.barcode || variant.barcodes?.[0] || '—'}</td>
                                            <td className={cn('px-4 py-4 font-bold tabular-nums', variant.quantity <= variant.minStockLevel ? 'text-amber-600' : 'text-emerald-600')}>
                                                {variant.quantity} {variant.unit}
                                            </td>
                                            <td className="px-4 py-4 font-bold tabular-nums">{formatCurrency(variant.price, variant.currency, iqdDisplayPreference)}</td>
                                            {!hideCosts && <td className="px-4 py-4 font-bold tabular-nums text-muted-foreground">{variant.costPrice == null ? '—' : formatCurrency(variant.costPrice, variant.currency, iqdDisplayPreference)}</td>}
                                            <td className="px-6 py-4 text-right">
                                                <div className="flex justify-end gap-1">
                                                    <Button type="button" variant="ghost" size="icon" onClick={() => onOpenProduct(variant.id)} title={t('common.view', { defaultValue: 'View' })} className="h-9 w-9 rounded-lg">
                                                        <Eye className="h-4 w-4" />
                                                    </Button>
                                                    {canManage && (
                                                        <>
                                                            <Button type="button" variant="ghost" size="icon" onClick={() => onOpenProduct(variant.id)} title={t('common.edit', { defaultValue: 'Edit' })} className="h-9 w-9 rounded-lg">
                                                                <Pencil className="h-4 w-4" />
                                                            </Button>
                                                            <DropdownMenu>
                                                                <DropdownMenuTrigger asChild>
                                                                    <Button type="button" variant="ghost" size="icon" title={t('common.more', { defaultValue: 'More actions' })} className="h-9 w-9 rounded-lg">
                                                                        <MoreHorizontal className="h-4 w-4" />
                                                                    </Button>
                                                                </DropdownMenuTrigger>
                                                                <DropdownMenuContent align="end" className="rounded-xl">
                                                                    <DropdownMenuItem disabled={unlinkingProductId === variant.id} onSelect={() => void handleUnlinkProduct(variant)} className="gap-2 text-destructive focus:text-destructive">
                                                                        {unlinkingProductId === variant.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unlink className="h-4 w-4" />}
                                                                        {t('products.variants.unlink', { defaultValue: 'Unlink variant' })}
                                                                    </DropdownMenuItem>
                                                                </DropdownMenuContent>
                                                            </DropdownMenu>
                                                        </>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                    <div className="mx-6 mb-6 flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/[0.05] p-4 text-sm text-primary sm:mx-8 sm:mb-8">
                        <Link2 className="mt-0.5 h-4 w-4 shrink-0" />
                        <p>{t('products.variants.info', { defaultValue: 'Variants are normal products. You can manage their price, stock, and other details independently.' })}</p>
                    </div>
                </CardContent>
            </Card>

            <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                <DialogContent layout="structured" className="max-w-3xl sm:max-w-3xl">
                    <DialogHeader layout="structured" className="shrink-0 bg-muted/25 px-6 py-5 sm:px-8">
                        <div className="flex items-start justify-between gap-4 pr-8">
                            <div className="min-w-0">
                                <DialogTitle className="flex items-center gap-2 text-xl font-black">
                                    <PackagePlus className="h-5 w-5 text-primary" />
                                    {t('products.variants.create', { defaultValue: 'Create Variant' })}
                                </DialogTitle>
                                <DialogDescription className="mt-1.5 max-w-xl text-sm">
                                    {t('products.variants.createSubtitle', { defaultValue: 'A new product will be created as a variant of {{parent}}.', parent: parent.name })}
                                </DialogDescription>
                            </div>
                            <span className="shrink-0 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-black text-primary">
                                {t('products.variants.newProduct', { defaultValue: 'New product' })}
                            </span>
                        </div>
                    </DialogHeader>
                    <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => void handleCreateVariant(event)}>
                        <DialogBody className="px-6 py-6 sm:px-8">
                            <div className="grid gap-5 sm:grid-cols-2">
                                <div className="space-y-2"><Label htmlFor="variant-name">{t('products.form.name', { defaultValue: 'Product Name' })} *</Label><Input id="variant-name" value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} required autoFocus className="h-11 rounded-xl" /></div>
                                <div className="space-y-2"><div className="flex items-center gap-1"><Label htmlFor="variant-sku">SKU *</Label><Button type="button" variant="ghost" size="icon" onClick={() => setDraft((current) => ({ ...current, sku: parent.sku }))} disabled={!parent.sku} aria-label={t('products.variants.copyParentSku', { defaultValue: 'Copy parent SKU' })} title={t('products.variants.copyParentSku', { defaultValue: 'Copy parent SKU' })} className="h-6 w-6 text-primary hover:text-primary"><Copy className="h-3.5 w-3.5" /></Button></div><Input id="variant-sku" value={draft.sku} onChange={(event) => setDraft((current) => ({ ...current, sku: event.target.value }))} required className="h-11 rounded-xl" /></div>
                                <div className="space-y-2"><Label htmlFor="variant-price">{t('products.table.price', { defaultValue: 'Price' })} *</Label><div className="relative"><Input id="variant-price" type="number" min="0" step="any" value={draft.price} onChange={(event) => setDraft((current) => ({ ...current, price: event.target.value }))} required className="h-11 rounded-xl pr-16 text-lg font-black text-primary" /><span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold uppercase tracking-wider text-muted-foreground/60">{getCurrencySymbol(draft.currency, iqdDisplayPreference)}</span></div></div>
                                {!hideCosts && <div className="space-y-2"><Label htmlFor="variant-cost">{t('products.form.cost', { defaultValue: 'Cost Price' })}</Label><div className="relative"><Input id="variant-cost" type="number" min="0" step="any" value={draft.costPrice} onChange={(event) => setDraft((current) => ({ ...current, costPrice: event.target.value }))} className="h-11 rounded-xl pr-16 font-bold" /><span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold uppercase tracking-wider text-muted-foreground/60">{getCurrencySymbol(draft.currency, iqdDisplayPreference)}</span></div></div>}
                                <div className="space-y-2"><Label htmlFor="variant-stock">{t('products.variants.stockQuantity', { defaultValue: 'Stock Quantity' })} *</Label><Input id="variant-stock" type="number" min="0.000001" step="any" value={draft.quantity} onChange={(event) => setDraft((current) => ({ ...current, quantity: event.target.value }))} placeholder="0" required className="h-11 rounded-xl" /></div>
                                <div className="space-y-2"><Label>{t('products.table.category', { defaultValue: 'Category' })}</Label><Select value={draft.categoryId || '__none__'} onValueChange={(value) => setDraft((current) => ({ ...current, categoryId: value === '__none__' ? '' : value }))}><SelectTrigger className="h-11 rounded-xl"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__none__">{t('categories.noCategory', { defaultValue: 'No Category' })}</SelectItem>{categories.map((category) => <SelectItem key={category.id} value={category.id}>{category.name}</SelectItem>)}</SelectContent></Select></div>
                                <CurrencySelector label={t('products.form.currency', { defaultValue: 'Currency' })} value={draft.currency} onChange={(currency) => setDraft((current) => ({ ...current, currency }))} iqdDisplayPreference={iqdDisplayPreference} allowedCurrencies={allowedCurrencies} />
                                <div className="space-y-2"><Label>{t('products.form.unit', { defaultValue: 'Unit' })}</Label><Select value={draft.unit} onValueChange={(value) => setDraft((current) => ({ ...current, unit: value }))}><SelectTrigger className="h-11 rounded-xl"><SelectValue /></SelectTrigger><SelectContent>{unitOptions.map((unit) => <SelectItem key={unit.value} value={unit.value}><span className="flex items-center gap-2"><ProductUnitIcon unit={unit.value} iconName={unit.icon} />{unit.value}</span></SelectItem>)}</SelectContent></Select></div>
                                <div className="space-y-2 sm:col-span-2"><Label htmlFor="variant-note">{t('common.note', { defaultValue: 'Note' })}</Label><Textarea id="variant-note" value={draft.note} onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))} placeholder={t('products.variants.notePlaceholder', { defaultValue: 'Optional note for this variant' })} className="min-h-24 rounded-xl" /></div>
                                <div className="space-y-2 sm:col-span-2"><Label>{t('products.variants.productImage', { defaultValue: 'Product Image' })}</Label><input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={(event) => void handleImageSelected(event)} /><button type="button" onClick={() => imageInputRef.current?.click()} className="flex h-28 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-primary/40 bg-primary/[0.03] text-sm font-bold text-primary transition-colors hover:bg-primary/[0.08]"><ImagePlus className="h-5 w-5" />{draft.imageUrl ? t('products.variants.changeImage', { defaultValue: 'Change image' }) : t('products.variants.uploadImage', { defaultValue: 'Upload image' })}</button>{draft.imageUrl && <div className="flex items-center justify-between text-xs text-muted-foreground"><span className="truncate">{t('products.variants.imageReady', { defaultValue: 'Image ready to save' })}</span><Button type="button" variant="ghost" size="sm" onClick={() => setDraft((current) => ({ ...current, imageUrl: '' }))} className="h-7 gap-1 text-destructive hover:text-destructive"><X className="h-3.5 w-3.5" />{t('common.remove', { defaultValue: 'Remove' })}</Button></div>}</div>
                            </div>
                        </DialogBody>
                        <DialogFooter layout="structured" className="shrink-0 bg-muted/15 px-6 py-4 sm:px-8"><Button type="button" variant="outline" onClick={() => setIsCreateOpen(false)} disabled={isCreating} className="h-11 rounded-xl">{t('common.cancel', { defaultValue: 'Cancel' })}</Button><Button type="submit" disabled={isCreating} className="h-11 gap-2 rounded-xl">{isCreating && <Loader2 className="h-4 w-4 animate-spin" />}{t('products.variants.create', { defaultValue: 'Create Variant' })}</Button></DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            <Dialog open={isLinkOpen} onOpenChange={setIsLinkOpen}>
                <DialogContent layout="structured" className="max-w-5xl sm:max-w-5xl">
                    <DialogHeader layout="structured" className="shrink-0 bg-muted/25 px-6 py-5 sm:px-8">
                        <div className="flex items-start justify-between gap-4 pr-8">
                            <div className="min-w-0">
                                <DialogTitle className="flex items-center gap-2 text-xl font-black"><Link2 className="h-5 w-5 text-primary" />{t('products.variants.linkExisting', { defaultValue: 'Link Existing Product' })}</DialogTitle>
                                <DialogDescription className="mt-1.5 max-w-2xl text-sm">{t('products.variants.linkSubtitle', { defaultValue: 'Link an existing independent product as a variant of {{parent}}.', parent: parent.name })}</DialogDescription>
                            </div>
                            <span className="shrink-0 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-black text-primary">{eligibleProducts.length}</span>
                        </div>
                    </DialogHeader>
                    <DialogBody className="px-6 py-6 sm:px-8">
                        <div className="space-y-5">
                            <div className="relative"><Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" /><Input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder={t('products.variants.search', { defaultValue: 'Search products by name or SKU...' })} className="h-12 rounded-xl pl-12" /></div>
                            <div className="overflow-hidden rounded-xl border border-border/60"><div className="hidden grid-cols-[1fr_180px_120px_140px] gap-4 border-b border-border/60 bg-muted/20 px-5 py-3 text-xs font-black uppercase tracking-[0.12em] text-muted-foreground md:grid"><span>{t('products.title', { defaultValue: 'Product' })}</span><span>SKU</span><span>{t('products.form.stock', { defaultValue: 'Stock' })}</span><span>{t('products.table.price', { defaultValue: 'Price' })}</span></div><div className="divide-y divide-border/50">{eligibleProducts.length === 0 ? <p className="px-5 py-10 text-center text-sm text-muted-foreground">{t('products.variants.noEligibleProducts', { defaultValue: 'No eligible products found. Existing variants and products that already have variants are excluded.' })}</p> : eligibleProducts.map((product) => <label key={product.id} className={cn('grid cursor-pointer gap-3 px-5 py-4 transition-colors md:grid-cols-[1fr_180px_120px_140px] md:items-center', selectedProductId === product.id ? 'bg-primary/[0.07]' : 'hover:bg-muted/30')}><div className="flex items-center gap-3"><input type="radio" name="variant-product" checked={selectedProductId === product.id} onChange={() => setSelectedProductId(product.id)} className="h-4 w-4 accent-primary" /><VariantImage product={product} /><span className="font-bold text-foreground">{product.name}</span></div><span className="font-mono text-xs text-muted-foreground">{product.sku || '—'}</span><span className="font-bold tabular-nums">{product.quantity}</span><span className="font-bold tabular-nums">{formatCurrency(product.price, product.currency, iqdDisplayPreference)}</span></label>)}</div></div>
                        </div>
                    </DialogBody>
                    <DialogFooter layout="structured" className="shrink-0 bg-muted/15 px-6 py-4 sm:px-8"><Button type="button" variant="outline" onClick={() => setIsLinkOpen(false)} disabled={isLinking} className="h-11 rounded-xl">{t('common.cancel', { defaultValue: 'Cancel' })}</Button><Button type="button" onClick={() => void handleLinkProduct()} disabled={!selectedProductId || isLinking} className="h-11 gap-2 rounded-xl">{isLinking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}{t('products.variants.linkProduct', { defaultValue: 'Link Product' })}</Button></DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    )
}
