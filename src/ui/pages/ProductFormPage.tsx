import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useRoute } from 'wouter'
import {
    ArrowLeft,
    Barcode,
    Box,
    BottleWine,
    Boxes,
    Camera,
    Cylinder,
    ChevronRight,
    CircleDot,
    Copy,
    Shuffle,
    DollarSign,
    Droplets,
    FileText,
    ImagePlus,
    Info,
    Package,
    Pencil,
    Plus,
    Ruler,
    Scale,
    Settings,
    ShoppingBag,
    SquareDashed,
    Tag,
    Trash2,
    Type,
    Wallet,
    Warehouse,
    Weight
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useLiveQuery } from 'dexie-react-hooks'

import { useAuth } from '@/auth'
import {
    addProductBarcode,
    createProduct,
    db,
    deleteProductBarcode,
    DuplicateProductBarcodeError,
    DuplicateProductSkuError,
    findActiveProductBySku,
    getPrimaryStorageFromList,
    replaceProductPriceBookItems,
    updateProductBarcode,
    updateProduct,
    useCategories,
    usePriceBookCatalogState,
    useProduct,
    useProductBarcodes,
    useStorages,
    type Product,
    type ProductBarcode,
    type PriceBookItem
} from '@/local-db'
import type { CurrencyCode } from '@/local-db/models'
import { assetManager } from '@/lib/assetManager'
import { normalizeBarcodeDigits, normalizeBarcodeScannerText } from '@/lib/barcodeScanner'
import { generateRandomUpc } from '@/lib/upc'
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard'
import { isTauri } from '@/lib/platform'
import { roundQuantity } from '@/lib/quantity'
import { cn, formatCurrency, formatNumericInput, sanitizeNumericInput } from '@/lib/utils'
import { getInventoryRowsForProduct } from '@/local-db/inventory'
import { platformService } from '@/services/platformService'
import { useWorkspace } from '@/workspace'
import { isLocalWorkspaceMode } from '@/workspace/workspaceMode'
import { BarcodeScannerToggleButton } from '@/ui/components/BarcodeScannerToggleButton'
import { useDemoTutorial } from '@/demo'
import {
    ProductPriceBookItemsEditor,
    type ProductPriceBookDraft
} from '@/ui/components/ProductPriceBookItemsEditor'
import {
    Button,
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CurrencySelector,
    DeleteConfirmationModal,
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Input,
    Label,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Switch,
    Textarea,
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
    useToast
} from '@/ui/components'

const UNITS = ['pcs', 'gram', 'liter', 'bottle', 'can', 'box', 'pack', 'carton', 'bag', 'm²', 'Kg']
const DYNAMIC_UNITS = new Set(['m²', 'Kg'])
function isDynamicUnit(unit: string): boolean {
    return DYNAMIC_UNITS.has(unit)
}

function ProductUnitIcon({ unit }: { unit: string }) {
    const className = 'h-4 w-4 text-primary/70'

    switch (unit) {
        case 'pcs':
            return <CircleDot className={className} />
        case 'Kg':
            return <Weight className={className} />
        case 'gram':
            return <Scale className={className} />
        case 'liter':
            return <Droplets className={className} />
        case 'bottle':
            return <BottleWine className={className} />
        case 'can':
            return <Cylinder className={className} />
        case 'box':
            return <Box className={className} />
        case 'pack':
            return <Package className={className} />
        case 'carton':
            return <Boxes className={className} />
        case 'bag':
            return <ShoppingBag className={className} />
        case 'm²':
            return <SquareDashed className={className} />
        default:
            return <Ruler className={className} />
    }
}
type ProductScannerTarget = 'none' | 'sku' | 'barcode'

const PRODUCT_SCANNER_TARGET_KEY = 'products_scanner_target'
const PRODUCT_SKU_SCANNER_ENABLED_KEY = 'products_sku_scanner_enabled'
const PRODUCT_BARCODE_SCANNER_ENABLED_KEY = 'products_barcode_scanner_enabled'
const PRODUCT_SKU_HID_DEVICE_KEY = 'products_sku_hid_device_id'
const PRODUCT_BARCODE_HID_DEVICE_KEY = 'products_barcode_hid_device_id'
const PRODUCT_FORM_SCANNER_IDLE_COMMIT_DELAY_MS = 1200

type ProductFormMode = 'create' | 'edit' | 'clone'

type ProductFormData = {
    sku: string
    name: string
    description: string
    categoryId: string | undefined
    price: string
    costPrice: string
    quantity: number | ''
    minStockLevel: number | ''
    unit: string
    perQuantity: string
    currency: CurrencyCode
    imageUrl: string
    canBeReturned: boolean
    returnRules: string
    storageId: string
}

function mapPriceBookItemsToDrafts(items: PriceBookItem[]): ProductPriceBookDraft[] {
    return [...items]
        .sort((left, right) => left.priceBookId.localeCompare(right.priceBookId))
        .map((item) => ({
            priceBookId: item.priceBookId,
            costPrice: String(item.costPrice),
            price: String(item.price),
            currency: item.currency
        }))
}

function serializePriceBookDrafts(rows: ProductPriceBookDraft[]) {
    return JSON.stringify(
        rows
            .map((row) => ({
                priceBookId: row.priceBookId,
                costPrice: row.costPrice.trim() === '' ? null : Number(row.costPrice),
                price: row.price.trim() === '' ? null : Number(row.price),
                currency: row.currency
            }))
            .sort((left, right) => left.priceBookId.localeCompare(right.priceBookId))
    )
}

const emptyProductFormData: ProductFormData = {
    sku: '',
    name: '',
    description: '',
    categoryId: undefined,
    price: '',
    costPrice: '',
    quantity: '',
    minStockLevel: 0,
    unit: 'pcs',
    perQuantity: '1',
    currency: 'usd',
    imageUrl: '',
    canBeReturned: true,
    returnRules: '',
    storageId: ''
}

function readStoredBoolean(key: string) {
    if (typeof localStorage === 'undefined') {
        return false
    }

    return localStorage.getItem(key) === 'true'
}

function readStoredScannerTarget(): ProductScannerTarget {
    if (typeof localStorage === 'undefined') {
        return 'none'
    }

    const storedTarget = localStorage.getItem(PRODUCT_SCANNER_TARGET_KEY)
    if (storedTarget === 'sku' || storedTarget === 'barcode') {
        return storedTarget
    }

    if (readStoredBoolean(PRODUCT_SKU_SCANNER_ENABLED_KEY)) {
        return 'sku'
    }

    if (readStoredBoolean(PRODUCT_BARCODE_SCANNER_ENABLED_KEY)) {
        return 'barcode'
    }

    return 'none'
}

function writeStoredScannerTarget(target: ProductScannerTarget) {
    if (typeof localStorage === 'undefined') {
        return
    }

    localStorage.setItem(PRODUCT_SCANNER_TARGET_KEY, target)
    localStorage.setItem(PRODUCT_SKU_SCANNER_ENABLED_KEY, String(target === 'sku'))
    localStorage.setItem(PRODUCT_BARCODE_SCANNER_ENABLED_KEY, String(target === 'barcode'))
}

function getCurrencySymbol(currency: string, iqdPreference: string) {
    switch (currency.toLowerCase()) {
        case 'usd':
            return '$'
        case 'eur':
            return 'EUR'
        case 'try':
            return 'TRY'
        case 'iqd':
            return iqdPreference
        default:
            return currency.toUpperCase()
    }
}

function createInitialFormData(defaultCurrency: CurrencyCode, defaultStorageId: string): ProductFormData {
    return {
        ...emptyProductFormData,
        currency: defaultCurrency,
        storageId: defaultStorageId
    }
}

function mapProductToFormData(product: Product): ProductFormData {
    return {
        sku: product.sku,
        name: product.name,
        description: product.description,
        categoryId: product.categoryId || undefined,
        price: String(product.price),
        costPrice: String(product.costPrice),
        quantity: product.quantity,
        minStockLevel: product.minStockLevel,
        unit: product.unit,
        perQuantity: '1',
        currency: product.currency,
        imageUrl: product.imageUrl || '',
        canBeReturned: product.canBeReturned ?? true,
        returnRules: product.returnRules || '',
        storageId: product.storageId || ''
    }
}

function ProductEditor({ mode, productId }: { mode: ProductFormMode; productId?: string }) {
    const { t } = useTranslation()
    const { user } = useAuth()
    const { features, hasCapability } = useWorkspace()
    const [, navigate] = useLocation()
    const { toast } = useToast()
    const demoTutorial = useDemoTutorial()
    const categories = useCategories(user?.workspaceId)
    const storages = useStorages(user?.workspaceId)
    const product = useProduct(productId)
    const workspaceId = user?.workspaceId || ''
    const priceBooksEnabled = hasCapability('priceBooks')
    const sourcePriceBookProductId = mode === 'create' ? undefined : product?.id
    const {
        priceBooks,
        priceBookItems,
        isReady: isPriceBookCatalogReady,
        error: priceBookCatalogError
    } = usePriceBookCatalogState(
        priceBooksEnabled ? workspaceId || undefined : undefined,
        { enabled: priceBooksEnabled }
    )
    const sourcePriceBookItems = useMemo(
        () => sourcePriceBookProductId
            ? priceBookItems.filter((item) => item.productId === sourcePriceBookProductId)
            : [],
        [priceBookItems, sourcePriceBookProductId]
    )
    const canEdit = user?.role === 'admin' || user?.role === 'staff'
    const isClone = mode === 'clone'
    const isEditing = mode === 'edit'
    const isReadOnly = isEditing && !canEdit
    const canEditStockAllocation = mode !== 'edit'
    const isDesktopShell = isTauri()
    const persistedProductId = isEditing ? product?.id : undefined
    const productBarcodes = useProductBarcodes(persistedProductId)

    const productInventoryRows = useLiveQuery(
        async () => {
            if (!persistedProductId) return []
            return getInventoryRowsForProduct(persistedProductId)
        },
        [persistedProductId]
    )

    const productStorages = useMemo(() => {
        if (!productInventoryRows || productInventoryRows.length === 0) return []
        const map = new Map<string, number>()
        for (const row of productInventoryRows) {
            const storage = storages.find((s) => s.id === row.storageId)
            if (!storage) continue
            const current = map.get(storage.name) ?? 0
            map.set(storage.name, current + row.quantity)
        }
        return Array.from(map.entries()).map(([name, quantity]) => ({ name, quantity })).sort((a, b) => b.quantity - a.quantity)
    }, [productInventoryRows, storages])

    const [formData, setFormData] = useState<ProductFormData>(() =>
        createInitialFormData(
            features.default_currency,
            mode === 'create' ? '' : (getPrimaryStorageFromList(storages)?.id || '')
        )
    )
    const [priceBookRows, setPriceBookRows] = useState<ProductPriceBookDraft[]>([])
    const [isSaving, setIsSaving] = useState(false)
    const [imageError, setImageError] = useState(false)
    const [storageError, setStorageError] = useState(false)
    const [returnRulesModalOpen, setReturnRulesModalOpen] = useState(false)
    const [missingProductStateVisible, setMissingProductStateVisible] = useState(false)
    const [newBarcodeValue, setNewBarcodeValue] = useState('')
    const [newBarcodeLabel, setNewBarcodeLabel] = useState('')
    const [isSubmittingBarcode, setIsSubmittingBarcode] = useState(false)
    const [barcodeToDelete, setBarcodeToDelete] = useState<ProductBarcode | null>(null)
    const [isDeletingBarcode, setIsDeletingBarcode] = useState(false)
    const [isGeneratingSku, setIsGeneratingSku] = useState(false)
    const [activeScannerTarget, setActiveScannerTarget] = useState<ProductScannerTarget>(() => readStoredScannerTarget())
    const skuInputRef = useRef<HTMLInputElement>(null)
    const isGeneratingSkuRef = useRef(false)
    const storageTriggerRef = useRef<HTMLButtonElement>(null)
    const newBarcodeInputRef = useRef<HTMLInputElement>(null)
    const cameraInputRef = useRef<HTMLInputElement>(null)
    const imageUploadInputRef = useRef<HTMLInputElement>(null)
    const initializedKeyRef = useRef<string | null>(null)
    const initialFormSnapshotRef = useRef<string | null>(null)
    const initializedPriceBookRowsKeyRef = useRef<string | null>(null)
    const initialPriceBookRowsSnapshotRef = useRef<string | null>(null)
    const createdProductIdRef = useRef<string | null>(null)

    const isProductDirty = useMemo(() => {
        if (!initialFormSnapshotRef.current || isReadOnly) {
            return false
        }

        const currentStr = JSON.stringify(formData)
        if (currentStr === initialFormSnapshotRef.current) {
            return false
        }

        try {
            const snapshot = JSON.parse(initialFormSnapshotRef.current)
            const keys = Object.keys(formData) as (keyof ProductFormData)[]

            for (const key of keys) {
                let v1: any = formData[key]
                let v2: any = snapshot[key]

                // normalize empty representations
                if (v1 === '' || v1 === undefined) v1 = null
                if (v2 === '' || v2 === undefined) v2 = null

                // string-based comparison for values that might be coerced
                if (v1 !== null && v2 !== null) {
                    if (String(v1) !== String(v2)) {
                        return true
                    }
                } else if (v1 !== v2) {
                    return true
                }
            }
            return false
        } catch {
            return currentStr !== initialFormSnapshotRef.current
        }
    }, [formData, isReadOnly])

    const arePriceBookRowsDirty = useMemo(() => {
        if (!priceBooksEnabled || isReadOnly || initialPriceBookRowsSnapshotRef.current === null) {
            return false
        }

        return serializePriceBookDrafts(priceBookRows) !== initialPriceBookRowsSnapshotRef.current
    }, [isReadOnly, priceBookRows, priceBooksEnabled])

    const isDirty = isProductDirty || arePriceBookRowsDirty

    const { showGuard, confirmNavigation, cancelNavigation, requestNavigation } = useUnsavedChangesGuard(isDirty)

    useEffect(() => {
        createdProductIdRef.current = null
    }, [mode, productId])

    useEffect(() => {
        if (!canEdit && mode !== 'edit') {
            navigate('/products')
        }
    }, [canEdit, mode, navigate])

    useEffect(() => {
        if (mode === 'create') {
            setMissingProductStateVisible(false)
            return
        }

        if (product) {
            setMissingProductStateVisible(false)
            return
        }

        const timer = window.setTimeout(() => setMissingProductStateVisible(true), 500)
        return () => window.clearTimeout(timer)
    }, [mode, product])

    useEffect(() => {
        const nextKey = mode === 'create'
            ? 'create'
            : product
                ? `${mode}:${product.id}:${product.updatedAt}`
                : null

        if (!nextKey || initializedKeyRef.current === nextKey) {
            return
        }

        let nextFormData: ProductFormData

        if (mode === 'create') {
            nextFormData = createInitialFormData(features.default_currency, '')
        } else {
            if (!product) {
                return
            }

            nextFormData = mapProductToFormData(product)
        }

        setFormData(nextFormData)
        setImageError(false)
        initialFormSnapshotRef.current = JSON.stringify(nextFormData)
        initializedKeyRef.current = nextKey
    }, [features.default_currency, mode, product, storages])

    useEffect(() => {
        if (!priceBooksEnabled || !isPriceBookCatalogReady) {
            return
        }

        const sourceKey = mode === 'create'
            ? 'create'
            : product
                ? `${mode}:${product.id}`
                : null

        if (!sourceKey) {
            return
        }

        const nextRows = mode === 'create'
            ? []
            : mapPriceBookItemsToDrafts(sourcePriceBookItems)
        const nextSnapshot = serializePriceBookDrafts(nextRows)

        if (initializedPriceBookRowsKeyRef.current !== sourceKey) {
            setPriceBookRows(nextRows)
            initialPriceBookRowsSnapshotRef.current = nextSnapshot
            initializedPriceBookRowsKeyRef.current = sourceKey
            return
        }

        const currentSnapshot = serializePriceBookDrafts(priceBookRows)
        const rowsWereEdited = initialPriceBookRowsSnapshotRef.current !== null
            && currentSnapshot !== initialPriceBookRowsSnapshotRef.current
        if (!rowsWereEdited && nextSnapshot !== initialPriceBookRowsSnapshotRef.current) {
            setPriceBookRows(nextRows)
            initialPriceBookRowsSnapshotRef.current = nextSnapshot
        }
    }, [
        isPriceBookCatalogReady,
        mode,
        priceBookRows,
        priceBooksEnabled,
        product,
        sourcePriceBookItems
    ])

    if (!canEdit && mode !== 'edit') {
        return null
    }

    const goToProducts = () => {
        if (isReadOnly) {
            navigate('/products')
            return
        }

        if (!requestNavigation('/products')) {
            navigate('/products')
        }
    }

    const getDisplayImageUrl = (url?: string) => {
        if (!url) return ''
        if (url.startsWith('http')) return url
        return platformService.convertFileSrc(url)
    }

    const handleImageUpload = async () => {
        if (!canEdit) return

        if (isDesktopShell) {
            const targetPath = await platformService.pickAndSaveImage(workspaceId)
            if (targetPath) {
                setFormData((current) => ({ ...current, imageUrl: targetPath }))
                setImageError(false)

                assetManager.uploadFromPath(targetPath).catch(console.error)
            }
            return
        }

        imageUploadInputRef.current?.click()
    }

    const handleFileSelected = async (file: File) => {
        if (isDesktopShell) {
            const targetPath = await platformService.saveImageFile(file, workspaceId)
            if (targetPath) {
                setFormData((current) => ({ ...current, imageUrl: targetPath }))
                setImageError(false)

                assetManager.uploadFromPath(targetPath).catch(console.error)
            }
            return
        }

        const ext = file.name.split('.').pop() || 'jpg'
        const fileName = `${Date.now()}.${ext}`
        const targetPath = `product-images/${workspaceId}/${fileName}`
        const r2Path = `${workspaceId}/product-images/${fileName}`

        const { r2Service } = await import('@/services/r2Service')
        if (!isLocalWorkspaceMode(workspaceId) && r2Service.isConfigured()) {
            const success = await r2Service.upload(r2Path, file)
            if (success) {
                setFormData((current) => ({ ...current, imageUrl: targetPath }))
                setImageError(false)
                return
            }
        }

        const reader = new FileReader()
        reader.onloadend = () => {
            setFormData((current) => ({ ...current, imageUrl: reader.result as string }))
            setImageError(false)
        }
        reader.readAsDataURL(file)
    }

    const handleCameraCapture = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0]
        if (!file) return

        await handleFileSelected(file)

        if (cameraInputRef.current) {
            cameraInputRef.current.value = ''
        }
    }

    const handleImageFileInputChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0]
        if (!file) return

        await handleFileSelected(file)

        if (imageUploadInputRef.current) {
            imageUploadInputRef.current.value = ''
        }
    }

    const handleRemoveImage = async () => {
        if (!formData.imageUrl || !canEdit) {
            return
        }

        try {
            await assetManager.deleteAsset(formData.imageUrl)
            setFormData((current) => ({ ...current, imageUrl: '' }))
            setImageError(false)
        } catch (error) {
            console.error('[Products] Error removing image:', error)
        }
    }

    const showBarcodeErrorToast = (error: unknown) => {
        if (error instanceof DuplicateProductBarcodeError) {
            toast({
                variant: 'destructive',
                title: t('messages.error'),
                description: t('products.barcodes.duplicate') || 'This barcode is already assigned to another product.'
            })
            return
        }

        toast({
            variant: 'destructive',
            title: t('messages.error'),
            description: error instanceof Error ? error.message : (t('common.error') || 'Something went wrong')
        })
    }

    const showProductSaveErrorToast = (error: unknown) => {
        if (error instanceof DuplicateProductSkuError) {
            toast({
                variant: 'destructive',
                title: t('common.error', { defaultValue: 'Error' }),
                description: t('products.messages.skuDuplicate', {
                    defaultValue: 'A product with this SKU already exists in this workspace.'
                })
            })
            return
        }

        toast({
            title: t('common.error', { defaultValue: 'Error' }),
            description: error instanceof Error ? error.message : t('products.messages.saveError', {
                defaultValue: 'Failed to save the product'
            }),
            variant: 'destructive'
        })
    }

    const handleAddBarcode = async () => {
        if (!workspaceId || !persistedProductId || isReadOnly) {
            return
        }

        const barcodeValue = normalizeBarcodeScannerText(newBarcodeValue)
        if (!barcodeValue) {
            return
        }

        const alreadyExists = productBarcodes.some((barcodeRow) => (
            normalizeBarcodeScannerText(barcodeRow.barcode) === barcodeValue
        ))
        if (alreadyExists) {
            showBarcodeErrorToast(new DuplicateProductBarcodeError())
            return
        }

        setIsSubmittingBarcode(true)
        try {
            await addProductBarcode(workspaceId, persistedProductId, barcodeValue, newBarcodeLabel)
            setNewBarcodeValue('')
            setNewBarcodeLabel('')
        } catch (error) {
            showBarcodeErrorToast(error)
        } finally {
            setIsSubmittingBarcode(false)
        }
    }

    const handleBarcodeLabelBlur = async (barcodeRow: ProductBarcode, nextValue: string) => {
        if (isReadOnly) {
            return
        }

        const normalizedCurrent = barcodeRow.label?.trim() || ''
        const normalizedNext = nextValue.trim()
        if (normalizedCurrent === normalizedNext) {
            return
        }

        try {
            await updateProductBarcode(barcodeRow.id, { label: normalizedNext || undefined })
        } catch (error) {
            showBarcodeErrorToast(error)
        }
    }

    const handleBarcodeLabelKeyDown = async (
        event: React.KeyboardEvent<HTMLInputElement>,
        barcodeRow: ProductBarcode
    ) => {
        if (event.key !== 'Enter') {
            return
        }

        event.preventDefault()
        await handleBarcodeLabelBlur(barcodeRow, event.currentTarget.value)
        event.currentTarget.blur()
    }

    const handleSetPrimaryBarcode = async (barcodeRow: ProductBarcode) => {
        if (isReadOnly || barcodeRow.isPrimary) {
            return
        }

        try {
            await updateProductBarcode(barcodeRow.id, { isPrimary: true })
        } catch (error) {
            showBarcodeErrorToast(error)
        }
    }

    const handleConfirmDeleteBarcode = async () => {
        if (!barcodeToDelete) {
            return
        }

        setIsDeletingBarcode(true)
        try {
            await deleteProductBarcode(barcodeToDelete.id)
            setBarcodeToDelete(null)
        } catch (error) {
            showBarcodeErrorToast(error)
        } finally {
            setIsDeletingBarcode(false)
        }
    }

    const handleScannerTargetChange = (target: ProductScannerTarget) => {
        setActiveScannerTarget(target)
        writeStoredScannerTarget(target)
    }

    const handleSkuScannerEnabledChange = (enabled: boolean) => {
        handleScannerTargetChange(enabled ? 'sku' : 'none')
    }

    const handleBarcodeScannerEnabledChange = (enabled: boolean) => {
        handleScannerTargetChange(enabled ? 'barcode' : 'none')
    }

    const handleSkuBarcodeScan = (value: string) => {
        if (isReadOnly || activeScannerTarget !== 'sku') {
            return
        }

        setFormData((current) => ({ ...current, sku: normalizeBarcodeScannerText(value) }))
    }

    const handleGenerateSku = async () => {
        if (isReadOnly || !workspaceId || isGeneratingSkuRef.current) {
            return
        }

        isGeneratingSkuRef.current = true
        setIsGeneratingSku(true)
        try {
            for (let attempt = 0; attempt < 20; attempt += 1) {
                const sku = generateRandomUpc()
                if (sku === formData.sku) {
                    continue
                }

                const existingProduct = await findActiveProductBySku(workspaceId, sku)

                if (!existingProduct) {
                    setFormData((current) => ({ ...current, sku }))
                    skuInputRef.current?.focus()
                    return
                }
            }

            toast({
                variant: 'destructive',
                title: t('common.error', { defaultValue: 'Error' }),
                description: t('products.form.generateUpcError', {
                    defaultValue: 'Could not generate a unique UPC. Please try again.'
                })
            })
        } finally {
            isGeneratingSkuRef.current = false
            setIsGeneratingSku(false)
        }
    }

    const handleAdditionalBarcodeScan = (value: string) => {
        if (isReadOnly || !persistedProductId || activeScannerTarget !== 'barcode') {
            return
        }

        setNewBarcodeValue(normalizeBarcodeScannerText(value))
    }

    const persistProduct = async ({ navigateAfterSave = true }: { navigateAfterSave?: boolean } = {}) => {
        if (!workspaceId || !canEdit) {
            return false
        }

        if (priceBooksEnabled && !isPriceBookCatalogReady) {
            toast({
                title: priceBookCatalogError
                    ? t('common.error', { defaultValue: 'Error' })
                    : t('priceBooks.loading', { defaultValue: 'Loading Price Book prices' }),
                description: priceBookCatalogError
                    ? t('priceBooks.loadingError', {
                        defaultValue: 'Price Book prices could not be loaded. Retrying automatically...'
                    })
                    : t('priceBooks.loadingDescription', {
                        defaultValue: 'Wait for the existing custom prices to finish loading, then save again.'
                    }),
                ...(priceBookCatalogError ? { variant: 'destructive' as const } : {})
            })
            return false
        }

        setIsSaving(true)

        try {
            const categoryName = formData.categoryId
                ? categories.find((category) => category.id === formData.categoryId)?.name
                : null
            const storageName = formData.storageId
                ? storages.find((storage) => storage.id === formData.storageId)?.name
                : null

            const { perQuantity: _perQuantity, ...formDataToSave } = formData
            const dataToSave = {
                ...formDataToSave,
                sku: formData.sku.trim(),
                category: categoryName || null,
                storageName: storageName || undefined,
                categoryId: formData.categoryId || null,
                storageId: formData.storageId || null,
                price: isDynamicUnit(formData.unit)
                    ? (Number(formData.price) || 0) / (Number(formData.perQuantity) || 1)
                    : Number(formData.price) || 0,
                costPrice: isDynamicUnit(formData.unit)
                    ? (Number(formData.costPrice) || 0) / (Number(formData.perQuantity) || 1)
                    : Number(formData.costPrice) || 0,
                quantity: roundQuantity(Number(formData.quantity) || 0),
                minStockLevel: roundQuantity(Number(formData.minStockLevel) || 0),
                createdBy: user?.id || null
            }

            let savedProductId: string

            if (isEditing && product && !isClone) {
                if (product.imageUrl && product.imageUrl !== formData.imageUrl) {
                    assetManager.deleteAsset(product.imageUrl).catch((error) =>
                        console.error('[Products] Failed to delete old asset:', error)
                    )
                }

                await updateProduct(product.id, dataToSave)
                savedProductId = product.id
            } else if (createdProductIdRef.current) {
                await updateProduct(createdProductIdRef.current, dataToSave)
                savedProductId = createdProductIdRef.current
            } else {
                const createdProduct = await createProduct(workspaceId, dataToSave)
                createdProductIdRef.current = createdProduct.id
                savedProductId = createdProduct.id
                demoTutorial.completeProductCreated(createdProduct)
            }

            if (priceBooksEnabled) {
                const savedItems = await replaceProductPriceBookItems(
                    workspaceId,
                    savedProductId,
                    priceBookRows.map((row) => ({
                        priceBookId: row.priceBookId,
                        costPrice: Number(row.costPrice),
                        price: Number(row.price),
                        currency: row.currency
                    })),
                    user?.id || null
                )
                const savedRows = mapPriceBookItemsToDrafts(savedItems)
                setPriceBookRows(savedRows)
                initialPriceBookRowsSnapshotRef.current = serializePriceBookDrafts(savedRows)
            }

            initialFormSnapshotRef.current = JSON.stringify(formData)

            if (navigateAfterSave) {
                navigate('/products')
            }

            return true
        } catch (error: any) {
            console.error('Error saving product:', error)
            showProductSaveErrorToast(error)
            return false
        } finally {
            setIsSaving(false)
        }
    }

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault()

        if (mode === 'create' && !formData.storageId) {
            setStorageError(true)
            storageTriggerRef.current?.focus()
            storageTriggerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
            return
        }

        if (demoTutorial.isCurrentTask('product') && (Number(formData.quantity) || 0) <= 0) {
            const quantityInput = document.getElementById('product-quantity') as HTMLInputElement | null
            quantityInput?.focus()
            quantityInput?.scrollIntoView({ behavior: 'smooth', block: 'center' })
            toast({
                title: t('products.form.stock') || 'Stock',
                description: 'Enter initial stock greater than 0 to continue the tutorial.',
                variant: 'destructive'
            })
            return
        }

        await persistProduct()
    }

    const title = isClone
        ? t('common.clone') || 'Clone Product'
        : isEditing
            ? isReadOnly
                ? t('common.view') || 'View Product'
                : t('common.edit') || 'Edit Product'
            : t('products.addProduct') || 'Add Product'

    const subtitle = isReadOnly
        ? (t('products.readOnlyNotice') || 'Viewing this product in read-only mode.')
        : isClone
            ? (t('products.cloneSubtitle') || 'Review the copied values, then create a new product.')
            : isEditing
                ? (t('products.editSubtitle') || 'Update product details, pricing, and return rules. Use Stock Adjustments for stock changes.')
                : (t('products.subtitle') || 'Manage your inventory')

    const unitLabel = t(`products.units.${formData.unit}`, formData.unit)
    const quantityValue = Number(formData.quantity) || 0
    const minStockValue = Number(formData.minStockLevel) || 0
    const lowStock = quantityValue <= minStockValue
    const perQty = Number(formData.perQuantity) || 1
    const effectivePrice = isDynamicUnit(formData.unit)
        ? (Number(formData.price) || 0) / perQty
        : Number(formData.price) || 0
    const effectiveCost = isDynamicUnit(formData.unit)
        ? (Number(formData.costPrice) || 0) / perQty
        : Number(formData.costPrice) || 0
    const pricePreview = formatCurrency(effectivePrice, formData.currency, features.iqd_display_preference)
    const costPreview = formatCurrency(effectiveCost, formData.currency, features.iqd_display_preference)
    const marginValue = effectivePrice - effectiveCost
    const marginPreview = formatCurrency(marginValue, formData.currency, features.iqd_display_preference)
    const selectedCategoryLabel = formData.categoryId
        ? categories.find((category) => category.id === formData.categoryId)?.name || (t('categories.noCategory') || 'No category')
        : (t('categories.noCategory') || 'No category')
    const labelMixed = t('products.form.mixedStorages') || 'Mixed'
    const selectedStorageLabel = isEditing
        ? productStorages.length === 0
            ? '—'
            : productStorages.length === 1
                ? productStorages[0].name
                : (
                    <TooltipProvider>
                        <Tooltip delayDuration={200}>
                            <TooltipTrigger asChild>
                                <span className="cursor-help border-b-2 border-dotted border-foreground/30">{labelMixed}</span>
                            </TooltipTrigger>
                            <TooltipContent side="top" align="start" className="max-w-[240px] space-y-1.5 p-3">
                                {productStorages.map((entry) => (
                                    <div key={entry.name} className="flex items-center justify-between gap-4 text-sm">
                                        <span>{entry.name}</span>
                                        <span className="font-mono tabular-nums text-muted-foreground">{entry.quantity}</span>
                                    </div>
                                ))}
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                )
        : formData.storageId
            ? storages.find((storage) => storage.id === formData.storageId)?.name || (t('storages.selectStorage') || 'Select Storage')
            : (t('storages.selectStorage') || 'Select Storage')
    const returnRulesPreview = formData.returnRules.trim() || (t('products.form.noReturnRules') || 'No custom return guidance yet.')
    const statusLabel = isClone
        ? (t('common.clone') || 'Clone')
        : isEditing
            ? isReadOnly
                ? (t('common.view') || 'View')
                : (t('common.edit') || 'Edit')
            : (t('common.create') || 'Create')
    const scannerEnabledLabel = t('pos.scannerEnabled', { defaultValue: 'Scanner Enabled' })
    const scannerDisabledLabel = t('pos.scannerDisabled', { defaultValue: 'Scanner Disabled' })

    if (mode !== 'create' && !product) {
        return (
            <div className="mx-auto max-w-5xl space-y-6">
                <Button variant="ghost" className="w-fit gap-2 px-0" allowViewer={true} onClick={() => navigate('/products')}>
                    <ArrowLeft className="h-4 w-4" />
                    {t('products.backToList') || 'Back to Products'}
                </Button>
                <Card className="border-border/60 shadow-sm">
                    <CardContent className="flex min-h-[280px] flex-col items-center justify-center gap-3 text-center">
                        <Package className="h-10 w-10 text-muted-foreground/50" />
                        <h1 className="text-xl font-bold">
                            {missingProductStateVisible
                                ? (t('products.notFoundTitle') || 'Product not found')
                                : (t('common.loading') || 'Loading...')}
                        </h1>
                        <p className="max-w-md text-sm text-muted-foreground">
                            {missingProductStateVisible
                                ? (t('products.notFoundDescription') || 'This product could not be found. It may have been deleted or is no longer available.')
                                : (t('products.loadingDescription') || 'Fetching the product details for this page.')}
                        </p>
                    </CardContent>
                </Card>
            </div>
        )
    }

    return (
        <div className="w-full space-y-6">
            <section className="overflow-hidden rounded-[2rem] border border-primary/15 bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.16),_transparent_42%),linear-gradient(180deg,rgba(255,255,255,0.75),rgba(255,255,255,0.94))] dark:bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.08),_transparent_42%),linear-gradient(180deg,rgba(30,41,59,0.4),rgba(30,41,59,0.7))] px-6 py-6 shadow-sm backdrop-blur sm:px-8">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-4">
                        <Button variant="ghost" className="w-fit gap-2 px-0" allowViewer={true} onClick={goToProducts}>
                            <ArrowLeft className="h-4 w-4" />
                            {t('products.backToList') || 'Back to Products'}
                        </Button>
                        <div className="space-y-3">
                            <div className="flex items-start gap-4">
                                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-inner">
                                    {isClone ? <Copy className="h-6 w-6" /> : isEditing ? <Pencil className="h-6 w-6" /> : <Plus className="h-6 w-6" />}
                                </div>
                                <div className="space-y-1">
                                    <h1 className="text-3xl font-black tracking-tight text-foreground">{title}</h1>
                                    <p className="max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">{subtitle}</p>
                                </div>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <div className="rounded-full border border-primary/15 bg-primary/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] text-primary">
                                    {statusLabel}
                                </div>
                                <div className="rounded-full border border-border/60 bg-background/70 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                                    {t('products.table.sku')}: {formData.sku || '--'}
                                </div>
                                <div className="rounded-full border border-border/60 bg-background/70 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                                    {formData.currency.toUpperCase()}
                                </div>
                                {isDirty && !isReadOnly && (
                                    <div className="rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-amber-600">
                                        {t('common.unsavedChanges.title') || 'Unsaved Changes'}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-3 lg:w-[420px]">
                        <div className="rounded-2xl border border-border/60 bg-background/80 px-4 py-3">
                            <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{t('products.table.price')}</div>
                            <div className="mt-1 text-lg font-black text-primary">{pricePreview}</div>
                        </div>
                        <div className="rounded-2xl border border-border/60 bg-background/80 px-4 py-3">
                            <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{t('products.form.stock')}</div>
                            <div className={cn('mt-1 text-lg font-black', lowStock ? 'text-amber-600' : 'text-foreground')}>
                                {quantityValue} {unitLabel}
                            </div>
                        </div>
                        <div className="rounded-2xl border border-border/60 bg-background/80 px-4 py-3">
                            <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{t('products.table.category')}</div>
                            <div className="mt-1 truncate text-sm font-semibold text-foreground">{selectedCategoryLabel}</div>
                        </div>
                    </div>
                </div>
            </section>

            {isReadOnly && (
                <div className="flex items-center gap-2 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-800">
                    <Info className="h-5 w-5" />
                    {t('products.readOnlyNotice') || 'Viewing this product in read-only mode.'}
                </div>
            )}

            <form id="product-form-page" onSubmit={handleSubmit} className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_340px]">
                <div className="min-w-0 space-y-6">
                    <Card className="overflow-hidden border-border/60 shadow-sm">
                        <CardHeader className="border-b border-border/50 bg-muted/10">
                            <CardTitle className="text-2xl font-black">
                                {t('products.form.productDetailsTitle') || 'Product Details'}
                            </CardTitle>
                            <p className="text-sm text-muted-foreground">
                                {t('products.form.productDetailsDesc') || 'Capture the core identity, description, unit, category, and storage location for this product.'}
                            </p>
                        </CardHeader>
                        <CardContent className="space-y-8 p-6 sm:p-8">
                            <div className="space-y-4">
                                <div className="flex items-center gap-2">
                                    <div className="h-4 w-1 rounded-full bg-primary" />
                                    <h2 className="text-sm font-black uppercase tracking-widest text-primary/80">
                                        {t('products.form.basicInfo')}
                                    </h2>
                                </div>
                                <div className="grid gap-6 md:grid-cols-2">
                                    <div className="space-y-2">
                                        <div className="flex items-center gap-1">
                                            <Label htmlFor="product-sku" className="flex items-center gap-2 font-bold">
                                                <Barcode className="h-4 w-4 text-primary/60" />
                                                {t('products.table.sku')}
                                            </Label>
                                            {!isReadOnly && (
                                                <TooltipProvider>
                                                    <Tooltip>
                                                        <TooltipTrigger asChild>
                                                            <Button
                                                                type="button"
                                                                variant="ghost"
                                                                size="icon"
                                                                onClick={(event) => {
                                                                    if (!isEditing || event.detail === 0) {
                                                                        void handleGenerateSku()
                                                                    }
                                                                }}
                                                                onDoubleClick={() => {
                                                                    if (isEditing) {
                                                                        void handleGenerateSku()
                                                                    }
                                                                }}
                                                                disabled={isGeneratingSku}
                                                                aria-label={isEditing
                                                                    ? t('products.form.generateUpcOnDoubleClick', { defaultValue: 'Double-click to generate a unique UPC' })
                                                                    : t('products.form.generateUpc', { defaultValue: 'Generate a unique UPC' })}
                                                                className="h-6 w-6 rounded-md text-muted-foreground hover:text-primary"
                                                            >
                                                                <Shuffle className="h-3.5 w-3.5" />
                                                            </Button>
                                                        </TooltipTrigger>
                                                        <TooltipContent>
                                                            {isEditing
                                                                ? t('products.form.generateUpcOnDoubleClick', { defaultValue: 'Double-click to generate a unique UPC' })
                                                                : t('products.form.generateUpc', { defaultValue: 'Generate a unique UPC' })}
                                                        </TooltipContent>
                                                    </Tooltip>
                                                </TooltipProvider>
                                            )}
                                        </div>
                                        <div className="flex gap-2">
                                            <Input
                                                ref={skuInputRef}
                                                id="product-sku"
                                                data-tour-id="tutorial-product-sku"
                                                value={formData.sku}
                                                onChange={(event) => setFormData((current) => ({
                                                    ...current,
                                                    sku: normalizeBarcodeDigits(event.target.value)
                                                }))}
                                                placeholder="PRD-001"
                                                readOnly={isReadOnly}
                                                required
                                                className="h-12 min-w-0 flex-1 rounded-lg border-border/40 bg-muted/10 font-mono"
                                            />
                                            {!isReadOnly && (
                                                <BarcodeScannerToggleButton
                                                    enabled={activeScannerTarget === 'sku'}
                                                    onEnabledChange={handleSkuScannerEnabledChange}
                                                    onScan={handleSkuBarcodeScan}
                                                    label={t('products.table.sku')}
                                                    activeLabel={scannerEnabledLabel}
                                                    inactiveLabel={scannerDisabledLabel}
                                                    deviceStorageKey={PRODUCT_SKU_HID_DEVICE_KEY}
                                                    targetInputRef={skuInputRef}
                                                    idleCommitDelayMs={PRODUCT_FORM_SCANNER_IDLE_COMMIT_DELAY_MS}
                                                />
                                            )}
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="product-name" className="flex items-center gap-2 font-bold">
                                            <Type className="h-4 w-4 text-primary/60" />
                                            {t('products.table.name')}
                                        </Label>
                                        <Input
                                            id="product-name"
                                            data-tour-id="tutorial-product-name"
                                            value={formData.name}
                                            onChange={(event) => setFormData((current) => ({ ...current, name: event.target.value }))}
                                            placeholder={t('products.form.name') || 'Product name'}
                                            readOnly={isReadOnly}
                                            required
                                            className="h-12 rounded-lg border-border/40 bg-muted/10 font-bold"
                                        />
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="product-description" className="flex items-center gap-2 font-bold">
                                        <FileText className="h-4 w-4 text-primary/60" />
                                        {t('products.form.description')}
                                    </Label>
                                    <Textarea
                                        id="product-description"
                                        value={formData.description}
                                        onChange={(event) => setFormData((current) => ({ ...current, description: event.target.value }))}
                                        placeholder={t('products.form.description') || 'Product description...'}
                                        rows={3}
                                        readOnly={isReadOnly}
                                        className="min-h-[100px] rounded-lg border-border/40 bg-muted/10"
                                    />
                                </div>
                            </div>

                            <div className="space-y-4">
                                <div className="flex items-center gap-2">
                                    <div className="h-4 w-1 rounded-full bg-primary" />
                                    <h2 className="text-sm font-black uppercase tracking-widest text-primary/80">
                                        {t('products.form.categorization')}
                                    </h2>
                                </div>
                                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                                    <div className="space-y-2">
                                        <Label htmlFor="product-category" className="flex items-center gap-2 font-bold">
                                            <Tag className="h-4 w-4 text-primary/60" />
                                            {t('products.table.category')}
                                        </Label>
                                        <Select
                                            value={formData.categoryId || 'none'}
                                            onValueChange={(value) => setFormData((current) => ({ ...current, categoryId: value === 'none' ? undefined : value }))}
                                            disabled={isReadOnly}
                                        >
                                            <SelectTrigger id="product-category" className="h-12 rounded-lg border-border/40 bg-muted/10" allowViewer={true}>
                                                <SelectValue placeholder={t('categories.noCategory')} />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="none">{t('categories.noCategory')}</SelectItem>
                                                {categories.map((category) => (
                                                    <SelectItem key={category.id} value={category.id}>
                                                        {category.name}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="product-unit" className="flex items-center gap-2 font-bold">
                                            <Ruler className="h-4 w-4 text-primary/60" />
                                            {t('products.form.unit')}
                                        </Label>
                                        <Select
                                            value={formData.unit}
                                            onValueChange={(value) => setFormData((current) => ({ ...current, unit: value }))}
                                            disabled={isReadOnly}
                                        >
                                            <SelectTrigger id="product-unit" data-tour-id="tutorial-product-unit" className="h-12 rounded-lg border-border/40 bg-muted/10" allowViewer={true}>
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {UNITS.map((unit) => (
                                                    <SelectItem key={unit} value={unit}>
                                                        <span className="flex items-center gap-2">
                                                            <ProductUnitIcon unit={unit} />
                                                            {t(`products.units.${unit}`, unit)}
                                                        </span>
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    {mode !== 'create' ? null : (
                                        <div className="space-y-2">
                                            <Label htmlFor="product-storage" className="flex items-center gap-2 font-bold">
                                                <Warehouse className="h-4 w-4 text-primary/60" />
                                                {t('storages.title') || 'Storage'}
                                            </Label>
                                            <Select
                                                value={formData.storageId}
                                                onValueChange={(value) => {
                                                    setFormData((current) => ({ ...current, storageId: value }))
                                                    setStorageError(false)
                                                }}
                                                disabled={isReadOnly || !canEditStockAllocation}
                                            >
                                                <SelectTrigger
                                                    ref={storageTriggerRef}
                                                    id="product-storage"
                                                    data-tour-id="tutorial-product-storage"
                                                    className={cn('h-12 rounded-lg bg-muted/10', storageError ? 'border-destructive ring-2 ring-destructive/50' : 'border-border/40')}
                                                    allowViewer={true}
                                                >
                                                    <SelectValue placeholder={t('storages.selectStorage') || 'Select Storage'} />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {storages.map((storage) => (
                                                        <SelectItem key={storage.id} value={storage.id}>
                                                            <div className="flex items-center gap-2">
                                                                <div className={cn('h-1.5 w-1.5 rounded-full', storage.isSystem ? 'bg-primary' : 'bg-muted-foreground/30')} />
                                                                {storage.isSystem ? (t(`storages.${storage.name.toLowerCase()}`) || storage.name) : storage.name}
                                                            </div>
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    )}
                                </div>
                                <div className="grid gap-3 sm:grid-cols-3">
                                    <div className="rounded-2xl border border-border/50 bg-background/80 p-4">
                                        <div className="text-[11px] font-black uppercase tracking-[0.18em] text-muted-foreground">{t('products.table.category')}</div>
                                        <div className="mt-1 text-sm font-semibold text-foreground">{selectedCategoryLabel}</div>
                                    </div>
                                    <div className="rounded-2xl border border-border/50 bg-background/80 p-4">
                                        <div className="text-[11px] font-black uppercase tracking-[0.18em] text-muted-foreground">{t('products.form.unit')}</div>
                                        <div className="mt-1 text-sm font-semibold text-foreground">{unitLabel}</div>
                                    </div>
                                    <div className="rounded-2xl border border-border/50 bg-background/80 p-4">
                                        <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.18em] text-muted-foreground">
                                            <Warehouse className="h-4 w-4 text-primary/60" />
                                            {t('storages.title') || 'Storage'}
                                        </div>
                                        <div className="mt-1 text-sm font-semibold text-foreground">{selectedStorageLabel}</div>
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {(isEditing || isClone) && (
                        <Card className="overflow-hidden border-border/60 shadow-sm">
                            <CardHeader className="border-b border-border/50 bg-muted/10">
                                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                                    <div className="space-y-1">
                                        <CardTitle className="text-2xl font-black">
                                            {t('products.barcodes.title') || 'Barcodes'}
                                        </CardTitle>
                                        <p className="text-sm text-muted-foreground">
                                            {persistedProductId
                                                ? t('products.barcodes.manageDescription', {
                                                    defaultValue: 'Attach every scannable code that should resolve to this product in POS.'
                                                })
                                                : (t('products.barcodes.saveFirstDescription') || 'Save this product first, then manage its barcodes here.')}
                                        </p>
                                    </div>
                                    {persistedProductId && !isReadOnly && (
                                        <BarcodeScannerToggleButton
                                            enabled={activeScannerTarget === 'barcode'}
                                            onEnabledChange={handleBarcodeScannerEnabledChange}
                                            onScan={handleAdditionalBarcodeScan}
                                            label={t('products.barcodes.title') || 'Barcodes'}
                                            activeLabel={scannerEnabledLabel}
                                            inactiveLabel={scannerDisabledLabel}
                                            deviceStorageKey={PRODUCT_BARCODE_HID_DEVICE_KEY}
                                            targetInputRef={newBarcodeInputRef}
                                            idleCommitDelayMs={PRODUCT_FORM_SCANNER_IDLE_COMMIT_DELAY_MS}
                                        />
                                    )}
                                </div>
                            </CardHeader>
                            <CardContent className="space-y-4 p-6 sm:p-8">
                                {persistedProductId ? (
                                    <>
                                        {productBarcodes.length > 0 ? (
                                            <div className="space-y-3">
                                                {productBarcodes.map((barcodeRow) => (
                                                    <div key={barcodeRow.id} className="rounded-2xl border border-border/60 bg-background/80 p-4">
                                                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                                                            <div className="min-w-0 flex-1 space-y-3">
                                                                <div className="flex flex-wrap items-center gap-2">
                                                                    <span className="rounded-full border border-primary/15 bg-primary/10 px-3 py-1 font-mono text-sm font-bold text-primary">
                                                                        {barcodeRow.barcode}
                                                                    </span>
                                                                    {barcodeRow.isPrimary && (
                                                                        <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-emerald-600">
                                                                            {t('products.barcodes.primary') || 'Primary'}
                                                                        </span>
                                                                    )}
                                                                </div>

                                                                {isReadOnly ? (
                                                                    <p className="text-sm text-muted-foreground">
                                                                        {barcodeRow.label || '—'}
                                                                    </p>
                                                                ) : (
                                                                    <div className="max-w-md space-y-2">
                                                                        <Label
                                                                            htmlFor={`product-barcode-label-${barcodeRow.id}`}
                                                                            className="text-[11px] font-black uppercase tracking-[0.16em] text-muted-foreground"
                                                                        >
                                                                            {t('products.barcodes.label') || 'Label'}
                                                                        </Label>
                                                                        <Input
                                                                            id={`product-barcode-label-${barcodeRow.id}`}
                                                                            defaultValue={barcodeRow.label || ''}
                                                                            placeholder={t('products.barcodes.label') || 'Label'}
                                                                            className="h-10 rounded-lg border-border/40 bg-muted/10"
                                                                            onBlur={(event) => {
                                                                                void handleBarcodeLabelBlur(barcodeRow, event.currentTarget.value)
                                                                            }}
                                                                            onKeyDown={(event) => {
                                                                                void handleBarcodeLabelKeyDown(event, barcodeRow)
                                                                            }}
                                                                        />
                                                                    </div>
                                                                )}
                                                            </div>

                                                            <div className="flex flex-wrap items-center gap-4 lg:justify-end">
                                                                <div className="flex items-center gap-3 rounded-full border border-border/50 bg-muted/20 px-3 py-2">
                                                                    <Label
                                                                        htmlFor={`product-barcode-primary-${barcodeRow.id}`}
                                                                        className="text-[11px] font-black uppercase tracking-[0.16em] text-muted-foreground"
                                                                    >
                                                                        {t('products.barcodes.primary') || 'Primary'}
                                                                    </Label>
                                                                    <Switch
                                                                        id={`product-barcode-primary-${barcodeRow.id}`}
                                                                        checked={barcodeRow.isPrimary}
                                                                        onCheckedChange={(checked) => {
                                                                            if (checked) {
                                                                                void handleSetPrimaryBarcode(barcodeRow)
                                                                            }
                                                                        }}
                                                                        disabled={isReadOnly || barcodeRow.isPrimary}
                                                                        className="data-[state=checked]:bg-emerald-500"
                                                                    />
                                                                </div>

                                                                {!isReadOnly && (
                                                                    <Button
                                                                        type="button"
                                                                        variant="ghost"
                                                                        size="icon"
                                                                        aria-label={t('common.delete') || 'Delete'}
                                                                        onClick={() => setBarcodeToDelete(barcodeRow)}
                                                                        className="h-10 w-10 rounded-full text-destructive hover:bg-destructive/10 hover:text-destructive"
                                                                    >
                                                                        <Trash2 className="h-4 w-4" />
                                                                    </Button>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <div className="rounded-2xl border border-dashed border-border/70 bg-muted/10 p-6 text-sm text-muted-foreground">
                                                {t('products.barcodes.empty') || 'No barcodes added yet.'}
                                            </div>
                                        )}

                                        {!isReadOnly && (
                                            <div className="rounded-2xl border border-border/60 bg-muted/20 p-4">
                                                <div className="grid gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_auto]">
                                                    <Input
                                                        ref={newBarcodeInputRef}
                                                        value={newBarcodeValue}
                                                        onChange={(event) => setNewBarcodeValue(normalizeBarcodeScannerText(event.target.value))}
                                                        onKeyDown={(event) => {
                                                            if (event.key === 'Enter') {
                                                                event.preventDefault()
                                                                void handleAddBarcode()
                                                            }
                                                        }}
                                                        placeholder="0123456789012"
                                                        className="h-11 rounded-lg border-border/40 bg-background/80 font-mono"
                                                    />
                                                    <Input
                                                        value={newBarcodeLabel}
                                                        onChange={(event) => setNewBarcodeLabel(event.target.value)}
                                                        onKeyDown={(event) => {
                                                            if (event.key === 'Enter') {
                                                                event.preventDefault()
                                                                void handleAddBarcode()
                                                            }
                                                        }}
                                                        placeholder={t('products.barcodes.label') || 'Label'}
                                                        className="h-11 rounded-lg border-border/40 bg-background/80"
                                                    />
                                                    <Button
                                                        type="button"
                                                        onClick={() => void handleAddBarcode()}
                                                        disabled={!newBarcodeValue.trim() || isSubmittingBarcode}
                                                        className="h-11 gap-2 rounded-xl px-5 font-black"
                                                    >
                                                        <Plus className="h-4 w-4" />
                                                        {t('products.barcodes.addBarcode') || 'Add Barcode'}
                                                    </Button>
                                                </div>
                                            </div>
                                        )}
                                    </>
                                ) : (
                                    <div className="rounded-2xl border border-dashed border-border/70 bg-muted/10 p-6">
                                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                            <div className="space-y-1">
                                                <div className="text-sm font-bold text-foreground">
                                                    {t('products.barcodes.saveFirst') || 'Save the product first'}
                                                </div>
                                                <p className="text-sm text-muted-foreground">
                                                    {t('products.barcodes.saveFirstDescription') || 'Create this product before attaching barcode records to it.'}
                                                </p>
                                            </div>
                                            <span className="rounded-full border border-border/60 bg-background/70 px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-muted-foreground">
                                                {mode === 'clone' ? (t('common.clone') || 'Clone') : (t('common.create') || 'Create')}
                                            </span>
                                        </div>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    )}

                    <Card className="overflow-hidden border-border/60 shadow-sm">
                        <CardHeader className="border-b border-border/50 bg-gradient-to-r from-primary/5 via-transparent to-transparent">
                            <CardTitle className="text-2xl font-black">
                                {t('products.form.pricing') || 'Pricing'}
                            </CardTitle>
                            <p className="text-sm text-muted-foreground">
                                {t('products.form.pricingDesc') || 'Set the selling price, cost basis, and active currency for this product.'}
                            </p>

                        </CardHeader>
                        <CardContent className="space-y-6 p-6 sm:p-8">
                            <div className="space-y-4">
                                <div className="grid gap-6 md:grid-cols-3">
                                    <div className="space-y-2">
                                        <Label htmlFor="product-price" className="flex items-center gap-2 font-bold">
                                            <DollarSign className="h-4 w-4 text-primary/60" />
                                            {t('products.table.price')}
                                        </Label>
                                        {isDynamicUnit(formData.unit) ? (
                                            <div className="flex items-start gap-1.5">
                                                <div className="relative flex-[2] min-w-0">
                                                    <Input
                                                        id="product-price"
                                                        data-tour-id="tutorial-product-price"
                                                        type="text"
                                                        inputMode="decimal"
                                                        value={formatNumericInput(formData.price)}
                                                        onChange={(event) => setFormData((current) => {
                                                            const raw = sanitizeNumericInput(event.target.value, { maxFractionDigits: 4 })
                                                            return { ...current, price: raw }
                                                        })}
                                                        placeholder="0"
                                                        readOnly={isReadOnly}
                                                        required
                                                        className="h-12 rounded-lg border-border/40 bg-background/50 pr-3 text-lg font-black text-primary"
                                                    />
                                                </div>
                                                <div className="flex items-center gap-1.5 pt-3 shrink-0">
                                                    <span className="text-[11px] font-medium text-muted-foreground whitespace-nowrap">{t('products.form.per') || 'per'}</span>
                                                    <Input
                                                        id="product-per-quantity"
                                                        type="text"
                                                        inputMode="decimal"
                                                        value={formData.perQuantity}
                                                        onChange={(event) => {
                                                            const val = event.target.value
                                                            if (/^\d*\.?\d*$/.test(val) || val === '') {
                                                                setFormData((current) => ({ ...current, perQuantity: val }))
                                                            }
                                                        }}
                                                        className="h-9 w-24 rounded-lg border-border/40 text-center text-sm font-medium tabular-nums"
                                                        placeholder="1"
                                                        readOnly={isReadOnly}
                                                    />
                                                    <span className="text-xs font-bold text-muted-foreground">{unitLabel}</span>
                                                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/40 ml-0.5">
                                                        {getCurrencySymbol(formData.currency, features.iqd_display_preference)}
                                                    </span>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="relative">
                                                <Input
                                                    id="product-price"
                                                    data-tour-id="tutorial-product-price"
                                                    type="text"
                                                    inputMode="decimal"
                                                    value={formatNumericInput(formData.price)}
                                                    onChange={(event) => setFormData((current) => {
                                                        const raw = sanitizeNumericInput(event.target.value, { maxFractionDigits: 4 })
                                                        return { ...current, price: raw }
                                                    })}
                                                    placeholder="0.000"
                                                    readOnly={isReadOnly}
                                                    required
                                                    className="h-12 rounded-lg border-border/40 bg-background/50 pr-16 text-lg font-black text-primary"
                                                />
                                                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold uppercase tracking-wider text-muted-foreground/60">
                                                    {getCurrencySymbol(formData.currency, features.iqd_display_preference)}
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                    <div className="space-y-2" data-tour-id="tutorial-product-currency">
                                        <CurrencySelector
                                            label={t('products.form.currency') || 'Currency'}
                                            value={formData.currency}
                                            onChange={(value) => setFormData((current) => ({ ...current, currency: value }))}
                                            iqdDisplayPreference={features.iqd_display_preference}
                                            disabled={isReadOnly}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="product-cost-price" className="flex items-center gap-2 font-bold">
                                            <Wallet className="h-4 w-4 text-primary/60" />
                                            {t('products.form.cost')}
                                        </Label>
                                        <div className="relative">
                                            <Input
                                                id="product-cost-price"
                                                data-tour-id="tutorial-product-cost-price"
                                                type="text"
                                                inputMode="decimal"
                                                value={formatNumericInput(formData.costPrice)}
                                                onChange={(event) => setFormData((current) => {
                                                    const raw = sanitizeNumericInput(event.target.value, { maxFractionDigits: 4 })
                                                    return {
                                                        ...current,
                                                        costPrice: raw
                                                    }
                                                })}
                                                placeholder="0.000"
                                                readOnly={isReadOnly}
                                                required
                                                className={cn(
                                                    "h-12 rounded-lg border-border/40 bg-background/50 font-bold",
                                                    isDynamicUnit(formData.unit) ? "pr-8" : "pr-16"
                                                )}
                                            />
                                            <span className={cn(
                                                "pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 font-bold uppercase tracking-wider text-muted-foreground/60",
                                                isDynamicUnit(formData.unit) ? "text-[10px]" : "text-xs"
                                            )}>
                                                {getCurrencySymbol(formData.currency, features.iqd_display_preference)}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                <div className="grid gap-3 sm:grid-cols-3">
                                    <div className="rounded-2xl border border-border/50 bg-background/80 p-4">
                                        <div className="text-[11px] font-black uppercase tracking-[0.18em] text-muted-foreground">{t('products.table.price')}</div>
                                        <div className="mt-1 text-base font-black text-primary">{pricePreview}</div>
                                    </div>
                                    <div className="rounded-2xl border border-border/50 bg-background/80 p-4">
                                        <div className="text-[11px] font-black uppercase tracking-[0.18em] text-muted-foreground">{t('products.form.cost')}</div>
                                        <div className="mt-1 text-base font-black text-foreground">{costPreview}</div>
                                    </div>
                                    <div className="rounded-2xl border border-border/50 bg-background/80 p-4">
                                        <div className="text-[11px] font-black uppercase tracking-[0.18em] text-muted-foreground">{t('products.form.margin') || 'Margin'}</div>
                                        <div className={cn('mt-1 text-base font-black', marginValue < 0 ? 'text-destructive' : 'text-emerald-600')}>
                                            {marginPreview}
                                        </div>
                                    </div>
                                </div>
                            </div>
                            {priceBooksEnabled ? (
                                isPriceBookCatalogReady ? (
                                    <ProductPriceBookItemsEditor
                                        priceBooks={priceBooks}
                                        rows={priceBookRows}
                                        onChange={setPriceBookRows}
                                        defaultCostPrice={String(effectiveCost)}
                                        defaultPrice={String(effectivePrice)}
                                        defaultCurrency={formData.currency}
                                        allowedCurrencies={features.allowed_currencies}
                                        iqdDisplayPreference={features.iqd_display_preference}
                                        disabled={isReadOnly}
                                    />
                                ) : (
                                    <div className="border-t border-border/60 pt-6">
                                        <div className={cn(
                                            'rounded-2xl border px-4 py-6 text-center text-sm',
                                            priceBookCatalogError
                                                ? 'border-destructive/40 bg-destructive/5 text-destructive'
                                                : 'border-dashed border-border/70 bg-muted/20 text-muted-foreground'
                                        )}>
                                            {priceBookCatalogError
                                                ? t('priceBooks.loadingError', {
                                                    defaultValue: 'Price Book prices could not be loaded. Retrying automatically...'
                                                })
                                                : t('priceBooks.loading', { defaultValue: 'Loading Price Book prices...' })}
                                        </div>
                                    </div>
                                )
                            ) : null}
                        </CardContent>
                    </Card>

                    <Card className="overflow-hidden border-border/60 shadow-sm">
                        <CardHeader className="border-b border-border/50 bg-muted/10">
                            <CardTitle className="text-2xl font-black">
                                {t('products.form.inventoryAndReturnsTitle') || 'Inventory & Returns'}
                            </CardTitle>
                            <p className="text-sm text-muted-foreground">
                                {t('products.form.inventoryAndReturnsDesc') || 'Track stock levels and define whether this product can be returned.'}
                            </p>
                        </CardHeader>
                        <CardContent className="space-y-6 p-6 sm:p-8">
                            <div className="space-y-4">
                                <div className="grid gap-6 md:grid-cols-2">
                                    <div className="space-y-2">
                                        <Label htmlFor="product-quantity" className="flex items-center gap-2 font-bold">
                                            <Boxes className="h-4 w-4 text-primary/60" />
                                            {t('products.form.stock')}
                                        </Label>
                                        <div className="relative">
                                            <Input
                                                id="product-quantity"
                                                data-tour-id="tutorial-product-initial-stock"
                                                type="number"
                                                inputMode="decimal"
                                                min="0"
                                                step={isDynamicUnit(formData.unit) ? '0.01' : '1'}
                                                value={formData.quantity}
                                                onChange={(event) => setFormData((current) => ({
                                                    ...current,
                                                    quantity: event.target.value === '' ? '' : Number(event.target.value)
                                                }))}
                                                placeholder="0"
                                                readOnly={isReadOnly || isEditing}
                                                required
                                                className="h-12 rounded-lg border-border/40 bg-muted/10 pr-16 font-black"
                                            />
                                            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold uppercase tracking-wider text-muted-foreground/60">
                                                {t(`products.units.${formData.unit}`, formData.unit)}
                                            </span>
                                        </div>
                                        {isEditing && (
                                            <div className="rounded-xl border border-sky-500/20 bg-sky-500/10 px-3 py-2 text-xs font-semibold text-sky-700">
                                                {t('products.form.stockAdjustmentHint') || 'Use Stock Adjustments to change stock quantities for existing products.'}
                                            </div>
                                        )}
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="product-min-stock" className="flex items-center gap-2 font-bold">
                                            <Info className="h-4 w-4 text-primary/60" />
                                            {t('products.form.minStock')}
                                        </Label>
                                        <div className="relative">
                                            <Input
                                                id="product-min-stock"
                                                type="number"
                                                inputMode="decimal"
                                                min="0"
                                                step={isDynamicUnit(formData.unit) ? '0.01' : '1'}
                                                value={formData.minStockLevel}
                                                onChange={(event) => setFormData((current) => ({
                                                    ...current,
                                                    minStockLevel: event.target.value === '' ? '' : Number(event.target.value)
                                                }))}
                                                readOnly={isReadOnly}
                                                required
                                                className="h-12 rounded-lg border-border/40 bg-muted/10 pr-16 font-bold"
                                            />
                                            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold uppercase tracking-wider text-muted-foreground/60">
                                                {t(`products.units.${formData.unit}`, formData.unit)}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                <div className={cn(
                                    'rounded-2xl border p-4 text-sm font-medium',
                                    lowStock
                                        ? 'border-amber-500/20 bg-amber-500/10 text-amber-700'
                                        : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700'
                                )}>
                                    {lowStock
                                        ? t('products.form.lowStockWarning', { defaultValue: 'Stock is at or below the minimum threshold of {{min}} {{unit}}.', min: minStockValue, unit: unitLabel })
                                        : (t('products.form.goodStockNotice') || 'Current stock is above the minimum threshold.')}
                                </div>

                                <div className="rounded-2xl border border-border/60 bg-muted/30 p-5" data-tour-id="tutorial-product-returnable">
                                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                                        <div className="space-y-1 text-start">
                                            <Label htmlFor="product-can-be-returned" className="flex cursor-pointer items-center gap-2 text-base font-black text-foreground/90">
                                                <div className={cn(
                                                    'flex h-8 w-8 items-center justify-center rounded-xl shadow-sm transition-colors',
                                                    formData.canBeReturned ? 'bg-emerald-500/10 text-emerald-600' : 'bg-muted text-muted-foreground'
                                                )}>
                                                    <ChevronRight className={cn('h-4 w-4 transition-transform', formData.canBeReturned && 'rotate-90')} />
                                                </div>
                                                {t('products.form.canBeReturned') || 'Can be Returned'}
                                            </Label>
                                            <p className="pl-10 text-sm font-medium leading-relaxed text-muted-foreground/80">
                                                {formData.canBeReturned
                                                    ? (t('products.form.canBeReturnedDesc') || 'Customers can return this product.')
                                                    : (t('products.form.cannotBeReturnedDesc') || 'This product is non-returnable.')}
                                            </p>
                                        </div>
                                        <div className="flex items-center">
                                            <Switch
                                                id="product-can-be-returned"
                                                checked={formData.canBeReturned}
                                                onCheckedChange={(checked) => setFormData((current) => ({ ...current, canBeReturned: checked }))}
                                                disabled={isReadOnly}
                                                className="data-[state=checked]:bg-emerald-500"
                                            />
                                        </div>
                                    </div>

                                    {formData.canBeReturned && (
                                        <div className="mt-5 rounded-2xl border border-border/50 bg-background/80 p-4">
                                            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                                                <div className="space-y-1">
                                                    <div className="text-[11px] font-black uppercase tracking-[0.18em] text-muted-foreground">
                                                        {t('products.form.returnRulesTitle') || 'Return Rules'}
                                                    </div>
                                                    <p className="text-sm leading-6 text-muted-foreground">
                                                        {returnRulesPreview}
                                                    </p>
                                                </div>
                                                {!isReadOnly && (
                                                    <Button
                                                        type="button"
                                                        variant="secondary"
                                                        size="sm"
                                                        onClick={() => setReturnRulesModalOpen(true)}
                                                        className="h-10 gap-2 rounded-xl border border-primary/10 px-5 font-bold"
                                                    >
                                                        <Settings className="h-4 w-4" />
                                                        {formData.returnRules.trim()
                                                            ? (t('products.form.editRules') || 'Edit rules')
                                                            : (t('products.form.addRules') || 'Add rules')}
                                                    </Button>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="overflow-hidden border-border/60 shadow-sm">
                        <CardHeader className="border-b border-border/50 bg-muted/10">
                            <CardTitle className="text-2xl font-black">
                                {t('products.form.visuals') || 'Visuals'}
                            </CardTitle>
                            <p className="text-sm text-muted-foreground">
                                {t('products.form.visualsDesc') || 'Upload or link a product image and keep the preview synced with the current record.'}
                            </p>

                        </CardHeader>
                        <CardContent className="space-y-6 p-6 sm:p-8">
                            <div className="space-y-4">

                                <div className="flex flex-col items-start gap-6 md:flex-row">
                                    <div className="relative aspect-square w-full shrink-0 overflow-hidden rounded-xl border-2 border-dashed border-primary/20 bg-muted/30 shadow-inner md:w-44">
                                        {!formData.imageUrl ? (
                                            <div className="flex h-full flex-col items-center justify-center gap-3">
                                                <ImagePlus className="h-8 w-8 text-primary" />
                                                <span className="text-[10px] font-black uppercase tracking-tighter text-primary/60">
                                                    {t('products.form.noImage') || 'No Preview'}
                                                </span>
                                            </div>
                                        ) : imageError ? (
                                            <div className="flex h-full flex-col items-center justify-center gap-2 px-2 text-center">
                                                <Package className="h-10 w-10 text-destructive/30" />
                                                <span className="text-[11px] font-bold uppercase text-destructive/60">
                                                    {t('products.form.imageError') || 'Image Error'}
                                                </span>
                                            </div>
                                        ) : (
                                            <>
                                                <img
                                                    src={getDisplayImageUrl(formData.imageUrl)}
                                                    alt={formData.name || 'Product preview'}
                                                    className="h-full w-full object-cover"
                                                    onError={() => setImageError(true)}
                                                />
                                                {!isReadOnly && (
                                                    <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity hover:opacity-100">
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="icon"
                                                            aria-label={t('common.delete') || 'Delete'}
                                                            onClick={handleRemoveImage}
                                                            className="h-12 w-12 rounded-full bg-destructive/90 text-white hover:bg-destructive"
                                                        >
                                                            <Trash2 className="h-6 w-6" />
                                                        </Button>
                                                    </div>
                                                )}
                                            </>
                                        )}
                                    </div>

                                    <div className="w-full flex-1 space-y-4">
                                        <div className="space-y-2">
                                            <Label htmlFor="product-image-url" className="flex items-center gap-2 font-bold">
                                                <Info className="h-4 w-4 text-primary/60" />
                                                {t('products.form.imageUrl') || 'Image Source'}
                                            </Label>
                                            <div className="flex flex-col gap-3 sm:flex-row">
                                                <Input
                                                    id="product-image-url"
                                                    value={formData.imageUrl}
                                                    onChange={(event) => {
                                                        setFormData((current) => ({ ...current, imageUrl: event.target.value }))
                                                        setImageError(false)
                                                    }}
                                                    placeholder={t('products.form.imageUrlPlaceholder') || 'Image URL or local path'}
                                                    readOnly={isReadOnly}
                                                    className="h-12 flex-1 rounded-lg border-border/40 bg-muted/10"
                                                />
                                                {!isReadOnly && (
                                                    <div className="flex gap-2">
                                                        <Button
                                                            type="button"
                                                            variant="outline"
                                                            onClick={handleImageUpload}
                                                            className="h-12 gap-2 rounded-lg border-primary/20 px-6 font-bold"
                                                        >
                                                            <ImagePlus className="h-4 w-4" />
                                                            {t('products.form.upload') || 'Upload'}
                                                        </Button>
                                                        <Button
                                                            type="button"
                                                            variant="outline"
                                                            aria-label={t('products.form.camera') || 'Camera'}
                                                            onClick={() => cameraInputRef.current?.click()}
                                                            className="h-12 gap-2 rounded-lg border-primary/20 px-4 font-bold text-primary sm:px-6"
                                                        >
                                                            <Camera className="h-4 w-4" />
                                                            <span className="hidden sm:inline">{t('products.form.camera') || 'Camera'}</span>
                                                        </Button>
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        <div className="flex items-start gap-3 rounded-xl border border-border/40 bg-muted/30 p-4">
                                            <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                                            <p className="text-[11px] font-medium leading-relaxed text-muted-foreground/80">
                                                {isDesktopShell
                                                    ? (t('products.form.localPathDesc') || 'Image will be stored locally on this device and synced to other devices in your workspace.')
                                                    : (t('products.form.webUploadDesc') || 'Image will be securely uploaded and synced via cloud storage.')}
                                            </p>
                                        </div>

                                        <input
                                            ref={cameraInputRef}
                                            type="file"
                                            className="hidden"
                                            accept="image/*"
                                            capture="environment"
                                            onChange={handleCameraCapture}
                                        />
                                        <input
                                            ref={imageUploadInputRef}
                                            type="file"
                                            className="hidden"
                                            accept="image/*"
                                            onChange={handleImageFileInputChange}
                                        />
                                    </div>
                                </div>
                            </div>
                        </CardContent>

                    </Card>
                </div>

                <div className="space-y-6">
                    <Card className="border-border/60 shadow-sm">
                        <CardHeader className="space-y-1">
                            <CardTitle className="text-xl">{t('products.summaryTitle') || 'Live Summary'}</CardTitle>
                            <p className="text-sm text-muted-foreground">
                                {t('products.summaryDescription') || 'A compact snapshot of price, stock, storage, and return behavior while you edit.'}
                            </p>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <div className="rounded-2xl border border-border/50 bg-muted/20 p-4">
                                <div className="text-[11px] font-black uppercase tracking-[0.18em] text-muted-foreground">{t('products.table.name')}</div>
                                <div className="mt-1 text-xl font-black text-foreground">{formData.name || (t('products.form.name') || 'Product name')}</div>
                                <div className="mt-1 text-sm font-medium text-muted-foreground">{formData.sku || '--'}</div>
                            </div>
                            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                                <div className="rounded-2xl border border-border/50 bg-background/70 p-4">
                                    <div className="text-[11px] font-black uppercase tracking-[0.18em] text-muted-foreground">{t('products.table.price')}</div>
                                    <div className="mt-1 text-base font-black text-primary">{pricePreview}</div>
                                </div>
                                <div className="rounded-2xl border border-border/50 bg-background/70 p-4">
                                    <div className="text-[11px] font-black uppercase tracking-[0.18em] text-muted-foreground">{t('products.form.cost')}</div>
                                    <div className="mt-1 text-base font-black text-foreground">{costPreview}</div>
                                </div>
                                <div className="rounded-2xl border border-border/50 bg-background/70 p-4">
                                    <div className="text-[11px] font-black uppercase tracking-[0.18em] text-muted-foreground">{t('products.form.stock')}</div>
                                    <div className={cn('mt-1 text-base font-black', lowStock ? 'text-amber-600' : 'text-foreground')}>
                                        {quantityValue} {unitLabel}
                                    </div>
                                </div>
                                <div className="rounded-2xl border border-border/50 bg-background/70 p-4">
                                    <div className="text-[11px] font-black uppercase tracking-[0.18em] text-muted-foreground">{t('storages.title') || 'Storage'}</div>
                                    <div className="mt-1 text-sm font-semibold text-foreground">{selectedStorageLabel}</div>
                                </div>
                            </div>
                            <div className="rounded-2xl border border-border/50 bg-background/70 p-4">
                                <div className="text-[11px] font-black uppercase tracking-[0.18em] text-muted-foreground">{t('products.form.canBeReturned') || 'Can be Returned'}</div>
                                <div className="mt-1 text-sm font-semibold text-foreground">
                                    {formData.canBeReturned ? (t('common.yes') || 'Yes') : (t('common.no') || 'No')}
                                </div>
                                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                                    {formData.canBeReturned
                                        ? returnRulesPreview
                                        : (t('products.form.cannotBeReturnedDesc') || 'This product is non-returnable.')}
                                </p>
                            </div>
                            <div className="rounded-2xl border border-border/50 bg-background/70 p-4">
                                <div className="text-[11px] font-black uppercase tracking-[0.18em] text-muted-foreground">{t('products.table.category')}</div>
                                <div className="mt-1 text-sm font-semibold text-foreground">{selectedCategoryLabel}</div>
                            </div>
                        </CardContent>
                    </Card>
                    <Card className="border-border/60 shadow-sm xl:sticky xl:top-24">
                        <CardHeader className="space-y-1">
                            <CardTitle className="text-xl">{isReadOnly ? (t('common.view') || 'View') : (t('common.actions') || 'Actions')}</CardTitle>
                            <p className="text-sm text-muted-foreground">
                                {isReadOnly
                                    ? (t('products.readOnlyActionsHint') || 'This product is open in read-only mode.')
                                    : (t('products.actionsHint') || 'Review your changes, then save or leave this page from here.')}
                            </p>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            {!isReadOnly && (
                                <Button
                                    type="submit"
                                    form="product-form-page"
                                    disabled={isSaving || (priceBooksEnabled && !isPriceBookCatalogReady)}
                                    className="h-12 w-full rounded-xl font-black"
                                    data-tour-id="tutorial-product-save"
                                >
                                    {isSaving
                                        ? (t('common.loading') || 'Loading...')
                                        : isClone
                                            ? (t('common.clone') || 'Clone')
                                            : isEditing
                                                ? (t('common.save') || 'Save')
                                                : (t('common.create') || 'Create')}
                                </Button>
                            )}
                            <Button type="button" variant="outline" allowViewer={true} onClick={goToProducts} className="h-12 w-full rounded-xl">
                                {isReadOnly ? (t('common.back') || 'Back') : (t('common.cancel') || 'Cancel')}
                            </Button>
                            {!isReadOnly && (
                                <div className="rounded-2xl border border-border/50 bg-muted/20 p-4 text-xs leading-5 text-muted-foreground">
                                    {isEditing
                                        ? (t('products.saveHintEdit') || 'Saving updates product details, image, pricing, and return settings. Stock changes happen in Stock Adjustments.')
                                        : (t('products.saveHint') || 'Saving applies the current details, image, stock, and return settings together.')}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </form>

            <Dialog open={returnRulesModalOpen} onOpenChange={setReturnRulesModalOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Settings className="h-5 w-5 text-primary" />
                            {t('products.form.returnRulesTitle') || 'Return Rules'}
                        </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <Label htmlFor="product-return-rules">
                                    {t('products.form.rulesLabel') || 'Specify return conditions'}
                                </Label>
                                <span className={cn(
                                    'text-[10px] font-mono',
                                    formData.returnRules.length >= 225 ? 'font-bold text-destructive' : 'text-muted-foreground'
                                )}>
                                    {formData.returnRules.length}/250
                                </span>
                            </div>
                            <Textarea
                                id="product-return-rules"
                                value={formData.returnRules}
                                onChange={(event) => setFormData((current) => ({
                                    ...current,
                                    returnRules: event.target.value.slice(0, 250)
                                }))}
                                placeholder={t('products.form.rulesPlaceholder') || 'e.g. Must be in original packaging, Only within 7 days...'}
                                rows={6}
                                maxLength={250}
                                readOnly={isReadOnly}
                                className="resize-none"
                            />
                        </div>
                        <p className="text-xs italic text-muted-foreground">
                            {t('products.form.rulesHint') || 'These rules will be shown to staff during the return process.'}
                        </p>
                    </div>
                    <DialogFooter>
                        <Button type="button" onClick={() => setReturnRulesModalOpen(false)}>
                            {t('common.done') || 'Done'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <DeleteConfirmationModal
                isOpen={!!barcodeToDelete}
                onClose={() => {
                    if (!isDeletingBarcode) {
                        setBarcodeToDelete(null)
                    }
                }}
                onConfirm={() => {
                    void handleConfirmDeleteBarcode()
                }}
                isLoading={isDeletingBarcode}
                title={t('products.barcodes.deleteConfirm') || 'Remove this barcode?'}
                description={t('products.barcodes.deleteConfirm') || 'Remove this barcode?'}
                itemName={barcodeToDelete?.barcode || ''}
            />

            {!isReadOnly && (
                <Dialog open={showGuard} onOpenChange={(open) => { if (!open) cancelNavigation() }}>
                    <DialogContent className="max-w-md rounded-3xl">
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-2">
                                <Info className="h-5 w-5 text-amber-500" />
                                {t('common.unsavedChanges.title') || 'Unsaved Changes'}
                            </DialogTitle>
                        </DialogHeader>
                        <p className="text-sm text-muted-foreground">
                            {t('common.unsavedChanges.message') || 'You have unsaved changes. Would you like to save your work before leaving?'}
                        </p>
                        <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-between">
                            <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => confirmNavigation(navigate)}>
                                {t('common.unsavedChanges.discard') || 'Discard Changes'}
                            </Button>
                            <div className="flex gap-2">
                                <Button variant="secondary" onClick={() => cancelNavigation()}>
                                    {t('common.unsavedChanges.continue') || 'Continue Editing'}
                                </Button>
                                <Button
                                    disabled={isSaving || (priceBooksEnabled && !isPriceBookCatalogReady)}
                                    onClick={async () => {
                                        const didSave = await persistProduct({ navigateAfterSave: false })
                                        if (didSave) {
                                            confirmNavigation(navigate)
                                        }
                                    }}
                                >
                                    {isSaving ? (t('common.loading') || 'Loading...') : (t('common.unsavedChanges.save') || 'Save Changes')}
                                </Button>
                            </div>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            )}
        </div>
    )
}

export function ProductCreatePage() {
    const { t } = useTranslation()
    const { user } = useAuth()
    const [, navigate] = useLocation()

    const storageCount = useLiveQuery(
        async () => {
            if (!user?.workspaceId) return 0
            return db.storages
                .where('workspaceId')
                .equals(user.workspaceId)
                .and((s) => !s.isDeleted)
                .count()
        },
        [user?.workspaceId]
    )

    if (storageCount === undefined) {
        return null
    }

    if (storageCount === 0) {
        return (
            <div className="flex h-full w-full items-center justify-center">
                <Dialog open={true} onOpenChange={() => navigate('/products')}>
                    <DialogContent
                        className="max-w-md rounded-2xl [&>button.absolute]:hidden"
                        onInteractOutside={(e) => e.preventDefault()}
                    >
                        <DialogHeader>
                            <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
                                <Warehouse className="h-7 w-7 text-amber-600 dark:text-amber-400" />
                            </div>
                            <DialogTitle className="text-center text-xl">
                                {t('products.noStorage.title') || 'No Storage Found'}
                            </DialogTitle>
                        </DialogHeader>
                        <div className="px-2 py-4 text-center text-sm text-muted-foreground">
                            {t('products.noStorage.description') || 'You need to create a storage location before adding products.'}
                        </div>
                        <DialogFooter className="gap-2">
                            <Button variant="outline" onClick={() => navigate('/products')}>
                                {t('common.goBack') || 'Go Back'}
                            </Button>
                            <Button onClick={() => navigate('/storages')}>
                                <Warehouse className="mr-2 h-4 w-4" />
                                {t('products.noStorage.goToStorage') || 'Go to Storage Settings'}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>
        )
    }

    return <ProductEditor mode="create" />
}

export function ProductEditPage() {
    const [, params] = useRoute('/products/:productId')
    return <ProductEditor mode="edit" productId={params?.productId} />
}

export function ProductClonePage() {
    const [, params] = useRoute('/products/:productId/clone')
    return <ProductEditor mode="clone" productId={params?.productId} />
}
