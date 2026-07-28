import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/auth'
import { supabase } from '@/auth/supabase'
import {
    addToOfflineMutations,
    adjustInventoryQuantity,
    calculateStockBatchUnitCost,
    commitStockBatchAllocations,
    createLoanFromPosSale,
    generateLocalSaleSequenceId,
    getStockBatchSalePlans,
    getPrimaryStorageFromList,
    refreshStockBatchesFromSupabase,
    useBatchAwareInventoryProducts,
    useActiveDiscountMap,
    useCategories,
    useWorkspaceProductBarcodes,
    useStorages,
    createActivityTransaction,
    updateActivityTransactionNotes,
    useActivityCatalog,
    toUISaleFromActivityTransaction,
    type BatchAwareInventoryProduct,
    type Category,
    type CurrencyCode,
    type InventoryProduct,
    type ActivityTransaction,
    type ActivityTransactionLine
} from '@/local-db'
import { db } from '@/local-db/database'
import { formatCurrency, generateId, cn } from '@/lib/utils'
import { CartItem } from '@/types'
import { useWorkspace, type WorkspaceFeatures } from '@/workspace'
import { useWorkspacePermissions } from '@/permissions'
import { useExchangeRate } from '@/context/ExchangeRateContext'
import {
    BARCODE_SCANNER_ACTIVE_FAST_KEY_COUNT,
    BARCODE_SCANNER_AUTO_COMMIT_DELAY_MS,
    BARCODE_SCANNER_MIN_SCAN_LENGTH,
    BARCODE_SCANNER_STALE_RESET_MS,
    classifyBarcodeScannerKeyTiming,
    createBarcodeScannerCodeIndex,
    getBarcodeScannerEventKey,
    hasBarcodeScannerKnownPrefix,
    isBarcodeScannerIgnoredKey,
    isBarcodeScannerTerminatorKey,
    normalizeBarcodeScannerText,
    shouldCommitBarcodeScannerValue
} from '@/lib/barcodeScanner'
import { ExchangeRateResult } from '@/lib/exchangeRate'
import { buildCheckoutRatesSnapshot, getPrimaryCheckoutRate } from '@/lib/currencyRates'
import { exchangeSnapshotsToPayloads } from '@/lib/salesExchange'
import { verifySale, createVerificationSale } from '@/lib/saleVerification'
import type { ResolvedActiveDiscount } from '@/lib/discounts'
import {
    Button,
    Input,
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
    DialogTrigger,
    DialogClose,
    useToast,
    Label,
    Switch,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/ui/components'
import { UiAccessGate } from '@/context/UiAccessContext'
import {
    Search,
    ShoppingCart,
    Plus,
    Minus,
    Zap,
    Loader2,
    Barcode,
    Camera,
    ScanBarcode,
    Trash2,
    TrendingUp,
    Menu,
    Pencil,
    Coins,
    RefreshCw,
    X,
    Archive,
    Ruler,
    Scale,
    ChevronRight,
    ChevronUp,
    ChevronDown,
    Warehouse,
    Check,
    Banknote
} from 'lucide-react'
import { isDesktop } from '@/lib/platform'
import { platformService } from '@/services/platformService'
import { ExchangeRateList } from '@/ui/components'
import { CheckoutSuccessModal, HeldSalesModal, type HeldSale, StorageSelector, CrossStorageWarningModal } from '@/ui/components'
import { BarcodeScannerModal } from '@/ui/components/pos/BarcodeScannerModal'
import type { StorageSelectorOption } from '@/ui/components/pos/StorageSelector'
import { CameraBarcodeScanner } from '@/ui/components/pos/CameraBarcodeScanner'
import { mapSaleToUniversal } from '@/lib/mappings'
import { LoanRegistrationModal, type LoanRegistrationData } from '@/ui/components/pos/LoanRegistrationModal'
import { SaveBorrowerAsPartnerDialog, usePendingSavePartnerPrompt } from '@/ui/components/loans/SaveBorrowerAsPartnerDialog'
import { getRetriableActionToast, isRetriableWebRequestError, normalizeSupabaseActionError, runSupabaseAction } from '@/lib/supabaseRequest'
import { isOnline } from '@/lib/network'
import { useWebHaptics } from 'web-haptics/react'
import { getLanguageDirection } from '@/lib/i18nRouting'
import { useDemoTutorial } from '@/demo'
import { ActivityReceiptPrintTemplate, createActivityReceiptLabels } from '@/ui/components/activities/ActivityReceiptPrintTemplate'
import { generateTemplatePdf } from '@/services/pdfGenerator'
import { PressAndHoldButton } from '@/ui/components/PressAndHoldButton'

const CART_IMAGE_VISIBILITY_THRESHOLD = 450
const DYNAMIC_UNITS = ['m²', 'Kg']

const ACTIVITIES_STORAGE_ID = '__atlas_activities__'
const ACTIVITY_POS_QUANTITY_LIMIT = Number.MAX_SAFE_INTEGER

type PosCatalogProduct = BatchAwareInventoryProduct & {
    isInfiniteActivity?: boolean
}

type CompletedActivityCheckout = {
    transaction: ActivityTransaction
    lines: ActivityTransactionLine[]
}

function isDynamicUnit(unit: string | undefined) {
    return DYNAMIC_UNITS.includes(unit ?? '')
}

function isLoanRegistrationData(value: unknown): value is LoanRegistrationData {
    if (!value || typeof value !== 'object') return false
    const payload = value as Partial<LoanRegistrationData>
    return (
        (payload.linkedPartyType === undefined ||
            payload.linkedPartyType === null ||
            payload.linkedPartyType === 'business_partner') &&
        (payload.linkedPartyId === undefined || payload.linkedPartyId === null || typeof payload.linkedPartyId === 'string') &&
        (payload.linkedPartyName === undefined || payload.linkedPartyName === null || typeof payload.linkedPartyName === 'string') &&
        typeof payload.borrowerName === 'string' &&
        typeof payload.borrowerPhone === 'string' &&
        typeof payload.borrowerAddress === 'string' &&
        typeof payload.borrowerNationalId === 'string' &&
        Number.isFinite(Number(payload.installmentCount)) &&
        (payload.installmentFrequency === 'weekly' ||
            payload.installmentFrequency === 'biweekly' ||
            payload.installmentFrequency === 'monthly') &&
        (payload.firstDueDate === null || typeof payload.firstDueDate === 'string')
    )
}

function buildCartItemKey(productId: string, storageId?: string | null) {
    return `${productId}:${storageId ?? ''}`
}

function addBarcodeLookupCode(map: Map<string, string>, code: string | undefined | null, productId: string, prefer = false) {
    const normalized = normalizeBarcodeScannerText(code ?? '')
    if (!normalized) {
        return
    }

    for (const key of new Set([normalized, normalized.toLowerCase()])) {
        if (prefer || !map.has(key)) {
            map.set(key, productId)
        }
    }
}

function getCartBasePrice(item: CartItem) {
    return item.discounted_price ?? item.price
}

function getCartEffectivePrice(item: CartItem) {
    return item.negotiated_price ?? getCartBasePrice(item)
}

function hasAutomaticDiscount(item: CartItem) {
    return typeof item.discounted_price === 'number' && item.discounted_price < item.price
}

function formatDiscountBadge(
    discount: { discountType: 'percentage' | 'fixed_amount'; discountValue: number },
    currency: CurrencyCode,
    iqdPreference: WorkspaceFeatures['iqd_display_preference']
) {
    if (discount.discountType === 'percentage') {
        return `-${Number(discount.discountValue)}%`
    }

    return `-${formatCurrency(discount.discountValue, currency, iqdPreference)}`
}

function getBatchExpiryStatus(expiryDate?: string | null) {
    if (!expiryDate) {
        return 'none' as const
    }

    const expiryTime = new Date(`${expiryDate}T00:00:00`).getTime()
    if (Number.isNaN(expiryTime)) {
        return 'none' as const
    }

    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const thirtyDaysFromNow = new Date(today)
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30)

    if (expiryTime < today.getTime()) {
        return 'expired' as const
    }

    if (expiryTime <= thirtyDaysFromNow.getTime()) {
        return 'soon' as const
    }

    return 'fresh' as const
}

function formatBatchExpiryDate(expiryDate?: string | null) {
    if (!expiryDate) {
        return 'No expiry'
    }

    const parsed = new Date(`${expiryDate}T00:00:00`)
    if (Number.isNaN(parsed.getTime())) {
        return expiryDate
    }

    return new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    }).format(parsed)
}

type EditableScanElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLElement

type EditableScanSnapshot = {
    element: EditableScanElement
    value?: string
    selectionStart?: number | null
    selectionEnd?: number | null
    textContent?: string | null
}

function getFocusedEditableScanElement(): EditableScanElement | null {
    const activeElement = document.activeElement

    if (activeElement instanceof HTMLInputElement) {
        return activeElement
    }

    if (activeElement instanceof HTMLTextAreaElement) {
        return activeElement
    }

    if (activeElement instanceof HTMLSelectElement) {
        return activeElement
    }

    if (activeElement instanceof HTMLElement && activeElement.isContentEditable) {
        return activeElement
    }

    return null
}

function createEditableScanSnapshot(element: EditableScanElement): EditableScanSnapshot {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        return {
            element,
            value: element.value,
            selectionStart: element.selectionStart,
            selectionEnd: element.selectionEnd
        }
    }

    if (element instanceof HTMLSelectElement) {
        return {
            element,
            value: element.value
        }
    }

    return {
        element,
        textContent: element.textContent
    }
}

function setNativeEditableValue(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
    const valueSetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')?.set

    if (valueSetter) {
        valueSetter.call(element, value)
    } else {
        element.value = value
    }
}

function restoreEditableScanSnapshot(snapshot: EditableScanSnapshot | null) {
    if (!snapshot) {
        return
    }

    const { element } = snapshot

    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        setNativeEditableValue(element, snapshot.value ?? '')
        element.dispatchEvent(new Event('input', { bubbles: true }))
        if (
            typeof snapshot.selectionStart === 'number'
            && typeof snapshot.selectionEnd === 'number'
            && typeof element.setSelectionRange === 'function'
        ) {
            element.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd)
        }
        element.blur()
        return
    }

    if (element instanceof HTMLSelectElement) {
        setNativeEditableValue(element, snapshot.value ?? '')
        element.dispatchEvent(new Event('change', { bubbles: true }))
        element.blur()
        return
    }

    element.textContent = snapshot.textContent ?? ''
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.blur()
}


const playCheckoutSound = () => {
    try {
        const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioContext) return;
        const ctx = new AudioContext();

        const playNote = (freq: number, startDelay: number, type: OscillatorType = 'sine', duration: number = 0.15) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(freq, ctx.currentTime + startDelay);
            gain.gain.setValueAtTime(0, ctx.currentTime + startDelay);
            gain.gain.linearRampToValueAtTime(0.06, ctx.currentTime + startDelay + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startDelay + duration);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(ctx.currentTime + startDelay);
            osc.stop(ctx.currentTime + startDelay + duration);
        };

        // A minimalist, modern dual-tone chime (elegant UI success pop)
        playNote(783.99, 0, 'sine', 0.1);     // G5 short
        playNote(1046.50, 0.08, 'sine', 0.3); // C6 slightly longer with fade
    } catch (e) {
        // Ignore gracefully
    }
};

export function POS() {
    const { trigger: hapticTrigger } = useWebHaptics({ debug: true })
    const { toast } = useToast()
    const { user } = useAuth()
    const demoTutorial = useDemoTutorial()
    const { t, i18n } = useTranslation()
    const { features, workspaceName, isLocalMode, isLoading: isWorkspaceLoading, refreshFeatures } = useWorkspace()
    const isRTL = getLanguageDirection(i18n.resolvedLanguage || i18n.language) === 'rtl'
    const { permissionKeys, hasPermission, isLoading: arePermissionsLoading } = useWorkspacePermissions()
    const canSellActivities = features.activities
        && hasPermission('activities.access')
        && hasPermission('activities.createTransaction')
    const storages = useStorages(user?.workspaceId)
    const [selectedStorageId, setSelectedStorageId] = useState<string>(() => {
        return localStorage.getItem('pos_selected_storage') || ''
    })
    const isActivitiesStorage = selectedStorageId === ACTIVITIES_STORAGE_ID
    const products = useBatchAwareInventoryProducts(user?.workspaceId, {
        enabled: !!selectedStorageId && !isActivitiesStorage,
        storageId: !isActivitiesStorage ? selectedStorageId || undefined : undefined
    })
    const activityCatalog = useActivityCatalog(canSellActivities ? user?.workspaceId : undefined)
    const infiniteActivityIds = useMemo(
        () => new Set(activityCatalog.filter((activity) => activity.isInfinite && !activity.isDeleted).map((activity) => activity.id)),
        [activityCatalog]
    )
    const productBarcodes = useWorkspaceProductBarcodes(user?.workspaceId, {
        syncProductCache: false
    })
    const activeDiscountMap = useActiveDiscountMap(user?.workspaceId, {
        products,
        inventoryRows: selectedStorageId && !isActivitiesStorage ? undefined : [],
        storageId: !isActivitiesStorage ? selectedStorageId || undefined : undefined,
        syncRemote: false
    })
    const [crossStorageWarning, setCrossStorageWarning] = useState<{
        product: PosCatalogProduct;
        foundStorageName: string;
    } | null>(null)
    const [search, setSearch] = useState('')
    const [cart, setCart] = useState<CartItem[]>([])
    const [dynamicUnitModal, setDynamicUnitModal] = useState<{ type: 'm²' | 'Kg'; itemKey: string } | null>(null)
    const [dynamicInputBuffer, setDynamicInputBuffer] = useState<Record<string, string>>({})
    const [isSkuModalOpen, setIsSkuModalOpen] = useState(false)
    const [selectedCategory, setSelectedCategory] = useState<string>(() => {
        return localStorage.getItem('pos_selected_category') || 'all'
    })
    const categories = useCategories(user?.workspaceId)
    const [skuInput, setSkuInput] = useState('')
    const [isLoading, setIsLoading] = useState(false)
    const [isBarcodeModalOpen, setIsBarcodeModalOpen] = useState(false)
    const [isCameraScannerAutoEnabled, setIsCameraScannerAutoEnabled] = useState(() => {
        return localStorage.getItem('scanner_auto_enabled') === 'true'
    })
    const [isDeviceScannerAutoEnabled, setIsDeviceScannerAutoEnabled] = useState(() => {
        return localStorage.getItem('scanner_device_auto_enabled') === 'true'
    })
    const [selectedCameraId, setSelectedCameraId] = useState(localStorage.getItem('scanner_camera_id') || '')
    const [cameras, setCameras] = useState<MediaDeviceInfo[]>([])
    const skuInputRef = useRef<HTMLInputElement>(null)
    const lastScannedCode = useRef<string | null>(null)
    const lastScannedTime = useRef<number>(0)
    const deviceScanBuffer = useRef('')
    const deviceScanTimeout = useRef<number | null>(null)
    const deviceScanLastTime = useRef(0)
    const deviceScanFastCount = useRef(0)
    const deviceScanActive = useRef(false)
    const deviceScanEditableSnapshot = useRef<EditableScanSnapshot | null>(null)
    const [scanDelay, setScanDelay] = useState(() => {
        return Number(localStorage.getItem('scanner_scan_delay')) || 500
    })
    const isScannerAutoActive = isCameraScannerAutoEnabled || isDeviceScannerAutoEnabled

    const updateCameraScannerAutoEnabled = (val: boolean) => {
        setIsCameraScannerAutoEnabled(val)
        localStorage.setItem('scanner_auto_enabled', String(val))
        if (val) {
            setIsDeviceScannerAutoEnabled(false)
            localStorage.setItem('scanner_device_auto_enabled', 'false')
        }
    }

    const updateDeviceScannerAutoEnabled = (val: boolean) => {
        setIsDeviceScannerAutoEnabled(val)
        localStorage.setItem('scanner_device_auto_enabled', String(val))
        if (val) {
            setIsCameraScannerAutoEnabled(false)
            localStorage.setItem('scanner_auto_enabled', 'false')
        }
    }

    const [isLayoutMobile, setIsLayoutMobile] = useState(window.innerWidth < 1024)
    useEffect(() => {
        if (isCameraScannerAutoEnabled && isDeviceScannerAutoEnabled) {
            setIsDeviceScannerAutoEnabled(false)
            localStorage.setItem('scanner_device_auto_enabled', 'false')
        }
    }, [])
    useEffect(() => {
        if (selectedStorageId) {
            localStorage.setItem('pos_selected_storage', selectedStorageId)
        }
    }, [selectedStorageId])

    const posStorages = useMemo<StorageSelectorOption[]>(() => {
        if (!canSellActivities) return storages
        return [
            ...storages,
            {
                id: ACTIVITIES_STORAGE_ID,
                name: t('activities.title', { defaultValue: 'Activities' }),
                isSystem: false,
                isVirtual: true
            }
        ]
    }, [canSellActivities, storages, t])

    const activityProducts = useMemo<PosCatalogProduct[]>(() => activityCatalog
        .filter((activity) => activity.isActive && !activity.isDeleted && activity.currency === features.default_currency)
        .map((activity) => {
            const availableQuantity = activity.isInfinite
                ? ACTIVITY_POS_QUANTITY_LIMIT
                : Math.max(0, Number(activity.availableQuantity ?? 0))

            return {
                id: activity.id,
                workspaceId: activity.workspaceId,
                sku: 'ACTIVITY',
                name: activity.name,
                description: '',
                categoryId: null,
                category: 'Activities',
                storageId: ACTIVITIES_STORAGE_ID,
                storageName: t('activities.title', { defaultValue: 'Activities' }),
                imageUrl: activity.imageUrl || undefined,
                price: activity.defaultUnitPrice,
                costPrice: 0,
                quantity: availableQuantity,
                minStockLevel: 0,
                // Activities are sold as activities, not as a product measurement.
                unit: 'activity',
                currency: activity.currency,
                canBeReturned: false,
                createdBy: activity.createdBy ?? null,
                createdAt: activity.createdAt,
                updatedAt: activity.updatedAt,
                version: activity.version,
                isDeleted: activity.isDeleted,
                syncStatus: activity.syncStatus,
                lastSyncedAt: activity.lastSyncedAt,
                inventoryId: `activity:${activity.id}`,
                inventoryQuantity: availableQuantity,
                hasBatches: false,
                batchCount: 0,
                nextBatchNumber: null,
                nextBatchExpiryDate: null,
                nextBatchQuantity: null,
                isInfiniteActivity: activity.isInfinite
            }
        }), [activityCatalog, features.default_currency, t])

    const sellableProducts: PosCatalogProduct[] = isActivitiesStorage ? activityProducts : products

    useEffect(() => {
        // Keep an explicitly selected Activities storage while workspace features
        // and permissions are still resolving. It is a virtual storage, so it is
        // not present in the physical-storage query during that short period.
        if (selectedStorageId === ACTIVITIES_STORAGE_ID) {
            if (isWorkspaceLoading || arePermissionsLoading || canSellActivities) return
        } else if (selectedStorageId && posStorages.some((storage) => storage.id === selectedStorageId)) {
            return
        }

        // A real storage is only chosen as a fallback after the physical list has
        // loaded, or when Activities is no longer available to this user.
        if (storages.length === 0) return

        const mainStorage = getPrimaryStorageFromList(storages)
        const fallbackStorage = mainStorage || storages[0]
        if (fallbackStorage && selectedStorageId !== fallbackStorage.id) {
            setSelectedStorageId(fallbackStorage.id)
        }
    }, [arePermissionsLoading, canSellActivities, isWorkspaceLoading, posStorages, selectedStorageId, storages])

    const handleStorageSelect = useCallback((storageId: string) => {
        if (cart.length > 0 && storageId !== selectedStorageId) {
            toast({
                variant: 'destructive',
                title: t('messages.error'),
                description: t('pos.switchStorageBlocked') || 'Finish or clear the current cart before changing storage.'
            })
            return
        }

        setSelectedStorageId(storageId)
    }, [cart.length, selectedStorageId, t, toast])

    const findStockProduct = useCallback((productId: string, storageId?: string) => {
        const resolvedStorageId = storageId || selectedStorageId
        if (resolvedStorageId) {
            return sellableProducts.find((product) => product.id === productId && product.storageId === resolvedStorageId)
        }

        const matches = sellableProducts.filter((product) => product.id === productId)
        return matches.length === 1 ? matches[0] : undefined
    }, [selectedStorageId, sellableProducts])

    const getCartItemKey = useCallback((item: Pick<CartItem, 'product_id' | 'storageId'>) => {
        return buildCartItemKey(item.product_id, item.storageId)
    }, [])

    const [mobileView, setMobileView] = useState<'grid' | 'cart'>(() => {
        return (localStorage.getItem('pos_mobile_view') as 'grid' | 'cart') || 'grid'
    })

    useEffect(() => {
        localStorage.setItem('pos_selected_category', selectedCategory)
    }, [selectedCategory])

    useEffect(() => {
        localStorage.setItem('pos_mobile_view', mobileView)
    }, [mobileView])

    useEffect(() => {
        const handleResize = () => setIsLayoutMobile(window.innerWidth < 1024)
        window.addEventListener('resize', handleResize)
        return () => window.removeEventListener('resize', handleResize)
    }, [])

    // Keyboard Navigation State (Electron Only)
    const [isElectron, setIsElectron] = useState(false)
    const [focusedSection, setFocusedSection] = useState<'grid' | 'cart'>('grid')
    const [focusedProductIndex, setFocusedProductIndex] = useState<number>(-1)
    const [focusedCartIndex, setFocusedCartIndex] = useState<number>(-1)
    const searchInputRef = useRef<HTMLInputElement>(null)
    const productRefs = useRef<(HTMLButtonElement | null)[]>([])
    const cartItemRefs = useRef<(HTMLDivElement | null)[]>([])
    const cartContainerRef = useRef<HTMLDivElement>(null)
    const sidebarRef = useRef<HTMLDivElement>(null)
    const lastEnterTime = useRef<number>(0)
    const isPosKeyboardSelectionEnabled = isElectron && !isDeviceScannerAutoEnabled

    useEffect(() => {
        setIsElectron(isDesktop());
        if (isDesktop()) setFocusedProductIndex(0);
    }, [])

    useEffect(() => {
        if (!isElectron) {
            return
        }

        if (isDeviceScannerAutoEnabled) {
            setFocusedSection('grid')
            setFocusedProductIndex(-1)
            setFocusedCartIndex(-1)
            lastEnterTime.current = 0
        } else if (focusedProductIndex < 0 && focusedCartIndex < 0) {
            setFocusedProductIndex(0)
        }
    }, [isDeviceScannerAutoEnabled, isElectron, focusedCartIndex, focusedProductIndex])

    const [productsPerRow, setProductsPerRow] = useState<number>(() => {
        const saved = localStorage.getItem('pos_products_per_row')
        return saved ? parseInt(saved, 10) : 4
    })

    useEffect(() => {
        localStorage.setItem('pos_products_per_row', productsPerRow.toString())
    }, [productsPerRow])

    // Calculate grid columns for ArrowUp/Down navigation
    const getGridColumns = () => {
        if (!isLayoutMobile) return productsPerRow
        const width = window.innerWidth
        if (width >= 1280) return 4 // xl
        if (width >= 1024) return 3 // lg
        return 2 // default/md
    }

    // Negotiated Price Edit State
    const [editingPriceItemKey, setEditingPriceItemKey] = useState<string | null>(null)
    const [negotiatedPriceInput, setNegotiatedPriceInput] = useState('')
    const isAdmin = user?.role === 'admin'
    const isModifyPriceHidden = !isAdmin && permissionKeys.includes('pos.hideModifyPriceButton' as any)
    const isPriceBelowCostHidden = !isAdmin && permissionKeys.includes('pos.hidePriceBelowCostIndicator' as any)

    const [paymentType, setPaymentType] = useState<'cash' | 'digital' | 'loan'>('cash')
    const isTutorialPosTask = demoTutorial.isCurrentTask('pos-sale')
    const [digitalProvider, setDigitalProvider] = useState<'fib' | 'qicard' | 'zaincash' | 'fastpay'>('fib')
    const [isLoanRegistrationModalOpen, setIsLoanRegistrationModalOpen] = useState(false)
    const [posLoanSavePartnerData, setPosLoanSavePartnerData] = usePendingSavePartnerPrompt()

    // Held Sales State
    const [heldSales, setHeldSales] = useState<HeldSale[]>(() => {
        const saved = localStorage.getItem('pos_held_sales')
        return saved ? JSON.parse(saved) : []
    })

    const [canScrollUp, setCanScrollUp] = useState(false)
    const [canScrollDown, setCanScrollDown] = useState(false)

    useEffect(() => {
        if (isTutorialPosTask && paymentType === 'loan') {
            setPaymentType('cash')
        }
    }, [isTutorialPosTask, paymentType])

    useEffect(() => {
        if (isActivitiesStorage) {
            setSelectedCategory('all')
            setShowExchangeTicker(false)
            if (paymentType === 'loan') setPaymentType('cash')
        }
    }, [isActivitiesStorage, paymentType])

    // Scroll Indicator Logic (Desktop)
    const checkScroll = useCallback(() => {
        if (!cartContainerRef.current) return
        const { scrollTop, scrollHeight, clientHeight } = cartContainerRef.current
        setCanScrollUp(scrollTop > 10)
        setCanScrollDown(scrollTop + clientHeight < scrollHeight - 10)
    }, [])

    useEffect(() => {
        const container = cartContainerRef.current
        if (!container) return

        const handleScroll = () => checkScroll()
        container.addEventListener('scroll', handleScroll)

        // Watch for content changes (adding/removing items)
        const observer = new ResizeObserver(() => checkScroll())
        observer.observe(container)

        // Also observe the inner items container if possible
        const innerItems = container.querySelector('.space-y-3')
        if (innerItems) observer.observe(innerItems)

        checkScroll() // Initial check

        return () => {
            container.removeEventListener('scroll', handleScroll)
            observer.disconnect()
        }
    }, [cart.length, checkScroll])
    const [isHeldSalesModalOpen, setIsHeldSalesModalOpen] = useState(false)
    const [restoredSale, setRestoredSale] = useState<HeldSale | null>(null)
    const [isSuccessModalOpen, setIsSuccessModalOpen] = useState(false)
    const [isCurrencyConversionDialogOpen, setIsCurrencyConversionDialogOpen] = useState(false)
    const [currencyConversionDraft, setCurrencyConversionDraft] = useState(true)
    const [isSavingCurrencyConversion, setIsSavingCurrencyConversion] = useState(false)
    const [completedSaleData, setCompletedSaleData] = useState<any>(null)
    const [completedActivityCheckout, setCompletedActivityCheckout] = useState<CompletedActivityCheckout | null>(null)
    const buildActivityCheckoutReceiptPdf = useCallback(async () => {
        if (!completedActivityCheckout) throw new Error('Activity transaction is not available.')

        const printLanguage = features.print_lang !== 'auto' ? features.print_lang : i18n.language
        return generateTemplatePdf({
            element: <ActivityReceiptPrintTemplate
                transaction={completedActivityCheckout.transaction}
                lines={completedActivityCheckout.lines}
                infiniteActivityIds={infiniteActivityIds}
                workspaceName={workspaceName || 'Atlas'}
                logoUrl={features.logo_url}
                iqdDisplayPreference={features.iqd_display_preference}
                labels={createActivityReceiptLabels(completedActivityCheckout.transaction, i18n.getFixedT(printLanguage))}
                locale={printLanguage}
            />,
            format: 'receipt',
            printLang: printLanguage
        })
    }, [completedActivityCheckout, features.iqd_display_preference, features.logo_url, features.print_lang, i18n, infiniteActivityIds, workspaceName])

    const saveCompletedActivityNote = useCallback(async (notes: string) => {
        if (!user || !completedActivityCheckout) return
        const transaction = await updateActivityTransactionNotes(user.workspaceId, completedActivityCheckout.transaction.id, notes)

        setCompletedActivityCheckout((current) => current?.transaction.id === transaction.id
            ? { ...current, transaction }
            : current)
        setCompletedSaleData((current: any) => current?.id === transaction.id
            ? { ...current, notes: transaction.notes, invoiceid: transaction.transactionNo }
            : current)
    }, [completedActivityCheckout, user])
    const [showExchangeTicker, setShowExchangeTicker] = useState(() => {
        const saved = localStorage.getItem('pos_show_exchange_ticker')
        if (saved !== null) return saved === 'true'
        // Default to ON only if we started in a mobile layout
        return window.innerWidth < 1024
    })

    useEffect(() => {
        localStorage.setItem('pos_show_exchange_ticker', String(showExchangeTicker))
    }, [showExchangeTicker])
    const [discountValue, setDiscountValue] = useState<string>('')
    const [discountType, setDiscountType] = useState<'percent' | 'amount'>('percent')

    useEffect(() => {
        localStorage.setItem('pos_held_sales', JSON.stringify(heldSales))
    }, [heldSales])

    // Cart resizing state
    const [cartWidth, setCartWidth] = useState<number>(() => {
        const saved = localStorage.getItem('pos_cart_width')
        return saved ? parseInt(saved, 10) : 502
    })
    const [isResizing, setIsResizing] = useState(false)

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault()
        setIsResizing(true)
        document.body.style.cursor = 'col-resize'
        document.body.style.userSelect = 'none'
    }, [])

    const handleMouseUp = useCallback(() => {
        setIsResizing(false)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''

        // Sync the temporary DOM width back to React state on release
        if (sidebarRef.current && !isLayoutMobile) {
            const finalWidth = sidebarRef.current.offsetWidth
            setCartWidth(finalWidth)
            localStorage.setItem('pos_cart_width', finalWidth.toString())
        }
    }, [isLayoutMobile])

    const handleMouseMove = useCallback((e: MouseEvent) => {
        if (!isResizing || isLayoutMobile) return
        const newWidth = isRTL ? e.clientX : window.innerWidth - e.clientX
        if (newWidth >= 384 && newWidth <= 800) {
            if (sidebarRef.current) {
                // Bypass React state for 60fps responsiveness during drag
                sidebarRef.current.style.width = `${newWidth}px`
            }
        }
    }, [isResizing, isRTL, isLayoutMobile])

    useEffect(() => {
        if (isResizing) {
            window.addEventListener('mousemove', handleMouseMove)
            window.addEventListener('mouseup', handleMouseUp)
        } else {
            window.removeEventListener('mousemove', handleMouseMove)
            window.removeEventListener('mouseup', handleMouseUp)
            localStorage.setItem('pos_cart_width', cartWidth.toString())
        }
        return () => {
            window.removeEventListener('mousemove', handleMouseMove)
            window.removeEventListener('mouseup', handleMouseUp)
        }
    }, [isResizing, handleMouseMove, handleMouseUp, cartWidth])

    // Filter products
    const filteredProducts = useMemo(() => {
        const normalizedSearch = search.trim().toLowerCase()

        return sellableProducts.filter((p) => {
            const matchesSearch = !normalizedSearch ||
                (p.name || '').toLowerCase().includes(normalizedSearch) ||
                (p.sku || '').toLowerCase().includes(normalizedSearch)

            // Storage Filter
            if (selectedStorageId && p.storageId !== selectedStorageId) {
                return false
            }

            if (selectedCategory !== 'all') {
                if (selectedCategory === 'none') {
                    return matchesSearch && !p.categoryId
                }
                return matchesSearch && p.categoryId === selectedCategory
            }
            return matchesSearch
        })
    }, [search, selectedCategory, selectedStorageId, sellableProducts])

    const barcodeMap = useMemo(() => {
        const map = new Map<string, string>()
        for (const barcodeRow of productBarcodes) {
            addBarcodeLookupCode(map, barcodeRow.barcode, barcodeRow.productId, barcodeRow.isPrimary)
        }
        for (const product of products) {
            addBarcodeLookupCode(map, product.barcode, product.id)
            for (const barcode of product.barcodes ?? []) {
                addBarcodeLookupCode(map, barcode, product.id)
            }
        }
        return map
    }, [productBarcodes, products])

    const knownScannerCodeIndex = useMemo(() => {
        const codes: string[] = []

        for (const barcodeRow of productBarcodes) {
            codes.push(barcodeRow.barcode)
        }

        for (const product of products) {
            codes.push(product.sku, product.barcode ?? '')
            codes.push(...(product.barcodes ?? []))
        }

        return createBarcodeScannerCodeIndex(codes)
    }, [productBarcodes, products])

    const getDisplayImageUrl = (url?: string) => {
        if (!url) return '';
        if (url.startsWith('http')) return url;
        if (url.startsWith('data:')) return url;

        return platformService.convertFileSrc(url);
    }


    // Exchange Rate for advisory display and calculations
    const { exchangeData: globalExchangeData, eurRates: globalEurRates, tryRates: globalTryRates, status, currencyStatus, refresh: refreshExchangeRate } = useExchangeRate()

    // Use restored rates if available (historical persistence), otherwise use global live rates
    const exchangeData = restoredSale ? {
        rate: restoredSale.rates.usd_iqd * 100,
        source: restoredSale.rates.sources.usd_iqd,
        timestamp: restoredSale.timestamp,
        isFallback: false
    } as ExchangeRateResult : globalExchangeData

    const eurRates = restoredSale ? {
        usd_eur: { rate: restoredSale.rates.usd_eur * 100, source: restoredSale.rates.sources.usd_eur, timestamp: restoredSale.timestamp, isFallback: false },
        eur_iqd: { rate: restoredSale.rates.eur_iqd * 100, source: restoredSale.rates.sources.eur_iqd, timestamp: restoredSale.timestamp, isFallback: false }
    } : globalEurRates

    const tryRates = restoredSale ? {
        usd_try: globalTryRates.usd_try, // Fallback to live or null for irrelevant pairs
        try_iqd: { rate: restoredSale.rates.try_iqd * 100, source: restoredSale.rates.sources.try_iqd, timestamp: restoredSale.timestamp, isFallback: false }
    } : globalTryRates

    const currencyConversionEnabled = features.pos_convert_to_workspace_currency
    const cartCurrencies = useMemo(() => Array.from(new Set(
        cart.map((item) => (findStockProduct(item.product_id, item.storageId)?.currency || 'usd') as CurrencyCode)
    )), [cart, findStockProduct])
    const hasMixedCartCurrencies = cartCurrencies.length > 1
    const settlementCurrency = (currencyConversionEnabled || cartCurrencies.length === 0
        ? features.default_currency || 'usd'
        : cartCurrencies[0]) as CurrencyCode

    const openCurrencyConversionSettings = useCallback(() => {
        if (!isAdmin || isActivitiesStorage) return
        setCurrencyConversionDraft(features.pos_convert_to_workspace_currency)
        setIsCurrencyConversionDialogOpen(true)
    }, [features.pos_convert_to_workspace_currency, isActivitiesStorage, isAdmin])

    const saveCurrencyConversionSettings = useCallback(async () => {
        if (!isAdmin || !user) return

        if (typeof navigator !== 'undefined' && !navigator.onLine) {
            toast({
                variant: 'destructive',
                title: t('messages.error'),
                description: t('pos.currencyConversionOnlineRequired', 'Connect to the internet to update this workspace-wide setting.')
            })
            return
        }

        setIsSavingCurrencyConversion(true)
        try {
            const { data, error } = await runSupabaseAction(
                'pos.updateCurrencyConversionPolicy',
                () => supabase
                    .from('workspaces')
                    .update({ pos_convert_to_workspace_currency: currencyConversionDraft })
                    .eq('id', user.workspaceId)
                    .select('pos_convert_to_workspace_currency')
                    .maybeSingle()
            )

            if (error) throw normalizeSupabaseActionError(error)
            if (!data) throw new Error('Workspace currency conversion setting could not be saved.')

            await refreshFeatures()
            setIsCurrencyConversionDialogOpen(false)
            toast({
                title: t('messages.success'),
                description: currencyConversionDraft
                    ? t('pos.currencyConversionEnabled', 'POS sales will be converted to the workspace currency.')
                    : t('pos.currencyConversionDisabled', 'POS sales will be recorded in the product currency without conversion.')
            })
        } catch (error) {
            const normalized = normalizeSupabaseActionError(error)
            toast({
                variant: 'destructive',
                title: t('messages.error'),
                description: normalized.message || t('pos.currencyConversionSaveFailed', 'Could not update the POS currency conversion setting.')
            })
        } finally {
            setIsSavingCurrencyConversion(false)
        }
    }, [currencyConversionDraft, isAdmin, refreshFeatures, t, toast, user])

    const convertPrice = useCallback((amount: number, from: CurrencyCode, to: CurrencyCode) => {
        if (from === to) return amount

        // Helper to get raw rate (amount per 1 USD/EUR)
        const getRate = (pair: 'usd_iqd' | 'usd_eur' | 'eur_iqd') => {
            if (pair === 'usd_iqd') return exchangeData ? exchangeData.rate / 100 : null
            if (pair === 'usd_eur') return eurRates.usd_eur ? eurRates.usd_eur.rate / 100 : null
            if (pair === 'eur_iqd') return eurRates.eur_iqd ? eurRates.eur_iqd.rate / 100 : null
            return null
        }

        let converted = amount

        // PATH LOGIC
        if (from === 'usd' && to === 'iqd') {
            const r = getRate('usd_iqd'); if (!r) return amount; converted = amount * r
        } else if (from === 'iqd' && to === 'usd') {
            const r = getRate('usd_iqd'); if (!r) return amount; converted = amount / r
        } else if (from === 'usd' && to === 'eur') {
            const r = getRate('usd_eur'); if (!r) return amount; converted = amount * r
        } else if (from === 'eur' && to === 'usd') {
            const r = getRate('usd_eur'); if (!r) return amount; converted = amount / r
        } else if (from === 'eur' && to === 'iqd') {
            const r = getRate('eur_iqd'); if (!r) return amount; converted = amount * r
        } else if (from === 'iqd' && to === 'eur') {
            const r = getRate('eur_iqd'); if (!r) return amount; converted = amount / r
        } else if (from === 'try' && to === 'iqd') {
            // Use TRY/IQD directly
            if (tryRates.try_iqd) converted = amount * (tryRates.try_iqd.rate / 100);
        } else if (from === 'iqd' && to === 'try') {
            if (tryRates.try_iqd) converted = amount / (tryRates.try_iqd.rate / 100);
        } else if (from === 'usd' && to === 'try') {
            if (tryRates.usd_try) converted = amount * (tryRates.usd_try.rate / 100);
        } else if (from === 'try' && to === 'usd') {
            if (tryRates.usd_try) converted = amount / (tryRates.usd_try.rate / 100);
        }
        // TRY <-> EUR: Chain through IQD
        else if (from === 'try' && to === 'eur') {
            // TRY -> IQD -> EUR
            const tryIqdRate = tryRates.try_iqd ? tryRates.try_iqd.rate / 100 : null;
            const eurIqdRate = eurRates.eur_iqd ? eurRates.eur_iqd.rate / 100 : null;
            if (tryIqdRate && eurIqdRate) {
                const inIqd = amount * tryIqdRate;
                converted = inIqd / eurIqdRate;
            }
        } else if (from === 'eur' && to === 'try') {
            // EUR -> IQD -> TRY
            const eurIqdRate = eurRates.eur_iqd ? eurRates.eur_iqd.rate / 100 : null;
            const tryIqdRate = tryRates.try_iqd ? tryRates.try_iqd.rate / 100 : null;
            if (eurIqdRate && tryIqdRate) {
                const inIqd = amount * eurIqdRate;
                converted = inIqd / tryIqdRate;
            }
        }
        // CHAINED PATHS (If needed based on default_currency)
        else if (from === 'iqd' && to === 'eur') {
            const r1 = getRate('usd_iqd'); const r2 = getRate('usd_eur')
            if (r1 && r2) converted = (amount / r1) * r2
        }

        // Rounding rules
        if (to === 'iqd') return Math.round(converted)
        return Math.round(converted * 100) / 100
    }, [exchangeData, eurRates, tryRates])

    // Calculate totals
    const totalAmount = cart.reduce((sum, item) => {
        const itemCurrency = findStockProduct(item.product_id, item.storageId)?.currency || 'usd'
        const basePrice = getCartEffectivePrice(item)
        const converted = convertPrice(basePrice, itemCurrency, settlementCurrency)
        return sum + (converted * item.quantity)
    }, 0)
    const originalSubtotal = cart.reduce((sum, item) => {
        const itemCurrency = findStockProduct(item.product_id, item.storageId)?.currency || 'usd'
        const converted = convertPrice(getCartBasePrice(item), itemCurrency, settlementCurrency)
        return sum + (converted * item.quantity)
    }, 0)
    const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0)

    // Check if any cart item requires a missing exchange rate
    // hasTrulyMissingRates: no rate at all (red alert, blocks checkout)
    // hasLoadingRates: rate cached but context is refreshing (yellow alert, allows checkout)
    const rateCheck = (() => {
        if (cart.length === 0) return { hasTrulyMissingRates: false, hasLoadingRates: false }

        let trulyMissing = false
        let loading = false

        for (const item of cart) {
            const itemCurrency = (findStockProduct(item.product_id, item.storageId)?.currency || 'usd') as CurrencyCode
            if (itemCurrency === settlementCurrency) continue

            const checkPair = (rateExists: boolean) => {
                if (!rateExists) {
                    if (status === 'loading') loading = true
                    else trulyMissing = true
                } else if (status === 'loading') {
                    loading = true
                }
            }

            if ((itemCurrency === 'usd' && settlementCurrency === 'iqd') || (itemCurrency === 'iqd' && settlementCurrency === 'usd')) {
                checkPair(!!exchangeData)
            } else if ((itemCurrency === 'eur' && settlementCurrency === 'iqd') || (itemCurrency === 'iqd' && settlementCurrency === 'eur')) {
                checkPair(!!eurRates.eur_iqd)
            } else if ((itemCurrency === 'usd' && settlementCurrency === 'eur') || (itemCurrency === 'eur' && settlementCurrency === 'usd')) {
                checkPair(!!eurRates.usd_eur)
            } else if ((itemCurrency === 'try' && settlementCurrency === 'iqd') || (itemCurrency === 'iqd' && settlementCurrency === 'try')) {
                checkPair(!!tryRates.try_iqd)
            } else if ((itemCurrency === 'usd' && settlementCurrency === 'try') || (itemCurrency === 'try' && settlementCurrency === 'usd')) {
                checkPair(!!tryRates.usd_try)
            } else if ((itemCurrency === 'try' && settlementCurrency === 'eur') || (itemCurrency === 'eur' && settlementCurrency === 'try')) {
                checkPair(!!tryRates.try_iqd && !!eurRates.eur_iqd)
            }
        }

        return { hasTrulyMissingRates: trulyMissing, hasLoadingRates: loading }
    })()

    const { hasTrulyMissingRates, hasLoadingRates } = rateCheck

    // Track originalSubtotal in a ref so the bulk discount effect doesn't
    // re-run (and wipe per-item negotiated prices) when the cart changes.
    const originalSubtotalRef = useRef(originalSubtotal)
    useEffect(() => { originalSubtotalRef.current = originalSubtotal }, [originalSubtotal])

    // Bulk Discount Effect — only runs when the user changes discountValue/discountType
    useEffect(() => {
        const numValue = parseFloat(discountValue)

        // If empty or 0, clear only bulk-discount negotiated prices (reset to original)
        if (isNaN(numValue) || numValue <= 0) {
            setCart(prev => prev.map(item => {
                if (item.negotiated_price === undefined) return item
                const { negotiated_price, ...rest } = item
                return rest as CartItem
            }))
            return
        }

        let percentToApply = 0
        if (discountType === 'percent') {
            percentToApply = numValue
        } else {
            const subtotal = originalSubtotalRef.current
            if (subtotal > 0) {
                percentToApply = (numValue / subtotal) * 100
            }
        }

        // Apply to all items by updating negotiated_price
        setCart(prev => prev.map(item => {
            const newPrice = getCartBasePrice(item) * (1 - Math.min(percentToApply, 100) / 100)
            // Only update if significantly different to avoid state churn
            if (item.negotiated_price !== undefined && Math.abs(item.negotiated_price - newPrice) < 0.001) return item
            return { ...item, negotiated_price: newPrice }
        }))
    }, [discountValue, discountType])

    // Keyboard Navigation Effect
    useEffect(() => {
        if (!isPosKeyboardSelectionEnabled) return

        const handleNavigation = (e: KeyboardEvent) => {
            // Disable if modals are open
            if (isSkuModalOpen || isBarcodeModalOpen || editingPriceItemKey) return

            // If search is focused, only handle Escape and Enter
            if (document.activeElement === searchInputRef.current) {
                if (e.key === 'Escape') {
                    searchInputRef.current?.blur()
                    setFocusedSection('grid')
                    setFocusedProductIndex(0)
                    e.preventDefault()
                } else if (e.key === 'Enter') {
                    searchInputRef.current?.blur()
                    setFocusedSection('grid')
                    setFocusedProductIndex(0)
                    e.preventDefault()
                }
                return
            }


            const cols = getGridColumns()

            // CART SECTION NAVIGATION
            if (focusedSection === 'cart') {
                switch (e.key) {
                    case 'ArrowUp':
                        e.preventDefault()
                        setFocusedCartIndex(prev => Math.max(0, prev - 1))
                        break
                    case 'ArrowDown':
                        e.preventDefault()
                        setFocusedCartIndex(prev => Math.min(cart.length - 1, prev + 1))
                        break
                    case 'ArrowRight':
                        e.preventDefault()
                        if (focusedCartIndex >= 0 && focusedCartIndex < cart.length) {
                            updateQuantity(getCartItemKey(cart[focusedCartIndex]), 1)
                        }
                        break
                    case 'ArrowLeft':
                        e.preventDefault()
                        if (focusedCartIndex >= 0 && focusedCartIndex < cart.length) {
                            updateQuantity(getCartItemKey(cart[focusedCartIndex]), -1)
                        }
                        break
                    case 'Escape':
                        e.preventDefault()
                        if (focusedCartIndex >= 0 && focusedCartIndex < cart.length) {
                            removeFromCart(getCartItemKey(cart[focusedCartIndex]))
                            // Adjust index if needed
                            if (focusedCartIndex >= cart.length - 1) {
                                setFocusedCartIndex(Math.max(0, cart.length - 2))
                            }
                        }
                        break
                    case 'Enter':
                        e.preventDefault()
                        const now = Date.now()
                        if (now - lastEnterTime.current < 500) {
                            // Double Enter - checkout
                            handleCheckout()
                            lastEnterTime.current = 0
                        } else {
                            lastEnterTime.current = now
                        }
                        break
                    case 'Tab':
                        e.preventDefault()
                        setFocusedSection('grid')
                        setFocusedCartIndex(-1)
                        if (focusedProductIndex < 0) setFocusedProductIndex(0)
                        break
                }
                // Scroll cart item into view
                if (focusedCartIndex >= 0 && cartItemRefs.current[focusedCartIndex]) {
                    cartItemRefs.current[focusedCartIndex]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
                }
                return
            }

            // GRID SECTION NAVIGATION
            let newIndex = focusedProductIndex

            switch (e.key) {
                case 'ArrowRight':
                    newIndex = Math.min(filteredProducts.length - 1, focusedProductIndex + 1)
                    e.preventDefault()
                    break
                case 'ArrowLeft':
                    newIndex = Math.max(0, focusedProductIndex - 1)
                    e.preventDefault()
                    break
                case 'ArrowDown':
                    newIndex = Math.min(filteredProducts.length - 1, focusedProductIndex + cols)
                    e.preventDefault()
                    break
                case 'ArrowUp':
                    newIndex = Math.max(0, focusedProductIndex - cols)
                    e.preventDefault()
                    break
                case ' ': // Space to Add
                case 'Enter':
                    if (focusedProductIndex >= 0 && focusedProductIndex < filteredProducts.length) {
                        addToCart(filteredProducts[focusedProductIndex])
                        e.preventDefault()

                        // Visual feedback animation on the button
                        const btn = productRefs.current[focusedProductIndex]
                        if (btn) {
                            btn.classList.add('ring-4', 'ring-primary/50', 'scale-95')
                            setTimeout(() => btn.classList.remove('ring-4', 'ring-primary/50', 'scale-95'), 150)
                        }
                    }
                    break
                case 'Tab':
                    e.preventDefault()
                    // Switch to cart section
                    if (cart.length > 0) {
                        setFocusedSection('cart')
                        setFocusedCartIndex(0)
                        setFocusedProductIndex(-1)
                    }
                    break
                case 'Escape':
                    // Clear search if any
                    if (search) {
                        setSearch('')
                        e.preventDefault()
                    }
                    break
            }

            if (newIndex !== focusedProductIndex) {
                setFocusedProductIndex(newIndex)
                // Scroll into view
                const el = productRefs.current[newIndex]
                if (el) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
                }
            }
        }

        window.addEventListener('keydown', handleNavigation)
        return () => window.removeEventListener('keydown', handleNavigation)
    }, [isPosKeyboardSelectionEnabled, isSkuModalOpen, isBarcodeModalOpen, editingPriceItemKey, focusedProductIndex, focusedSection, focusedCartIndex, filteredProducts, cart, search, getCartItemKey])

    // Hotkey listener
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Automatic keyboard-wedge scanning must classify the opening
            // characters before they are allowed to trigger POS shortcuts.
            if (isDeviceScannerAutoEnabled) return

            const skuHotkey = localStorage.getItem('pos_hotkey') || ''
            const barcodeHotkey = localStorage.getItem('barcode_hotkey') || ''

            if (e.key.toLowerCase() === skuHotkey.toLowerCase() && !isSkuModalOpen && !isBarcodeModalOpen) {
                e.preventDefault()
                setIsSkuModalOpen(true)
            }
            if (e.key.toLowerCase() === barcodeHotkey.toLowerCase() && !isBarcodeModalOpen && !isSkuModalOpen) {
                e.preventDefault()
                setIsBarcodeModalOpen(true)
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [isSkuModalOpen, isBarcodeModalOpen, isDeviceScannerAutoEnabled])

    // Fetch cameras
    useEffect(() => {
        if (isBarcodeModalOpen) {
            navigator.mediaDevices.enumerateDevices().then(devices => {
                const videoDevices = devices.filter(d => d.kind === 'videoinput')
                setCameras(videoDevices)
                if (!selectedCameraId && videoDevices.length > 0) {
                    setSelectedCameraId(videoDevices[0].deviceId)
                }
            }).catch(err => {
                console.error('Error listing cameras:', err)
            })
        }
    }, [isBarcodeModalOpen, selectedCameraId])

    // Focus SKU input when modal opens
    useEffect(() => {
        if (isSkuModalOpen && skuInputRef.current) {
            setTimeout(() => skuInputRef.current?.focus(), 100)
        }
    }, [isSkuModalOpen])

    // Auto-scroll cart to bottom on desktop when items are added
    useEffect(() => {
        if (!isLayoutMobile && cart.length > 0 && cartContainerRef.current) {
            cartContainerRef.current.scrollTo({
                top: cartContainerRef.current.scrollHeight,
                behavior: 'smooth'
            });
        }
    }, [cart.length, isLayoutMobile])

    const addToCart = useCallback((product: PosCatalogProduct) => {
        const isInfiniteActivity = product.isInfiniteActivity === true
        if (!isInfiniteActivity && product.inventoryQuantity <= 0) return // Out of stock
        const activeDiscount = activeDiscountMap.get(product.id)

        if (!currencyConversionEnabled && !isInfiniteActivity) {
            const cartCurrency = cartCurrencies[0]
            if (cartCurrency && cartCurrency !== product.currency) {
                toast({
                    variant: 'destructive',
                    title: t('messages.error'),
                    description: t('pos.currencyConversionSingleCurrencyCart', 'Currency conversion is disabled. A sale can contain products in only one currency.')
                })
                return
            }
        }

        // Check EUR support
        if (product.currency === 'eur' && !features.allowed_currencies.includes('eur')) {
            toast({
                variant: 'destructive',
                title: t('messages.error'),
                description: t('pos.eurDisabled') || 'Euro products represent a currency that is currently disabled in settings.',
            })
            return
        }

        if (product.currency === 'try' && !features.allowed_currencies.includes('try')) {
            toast({
                variant: 'destructive',
                title: t('messages.error'),
                description: t('pos.tryDisabled') || 'TRY conversion is disabled.',
            })
            return
        }

        setCart((prev) => {
            const itemKey = buildCartItemKey(product.id, product.storageId)
            const existing = prev.find((item) => buildCartItemKey(item.product_id, item.storageId) === itemKey)
            if (existing) {
                // Check stock limit
                if (!isInfiniteActivity && existing.quantity >= product.inventoryQuantity) return prev

                return prev.map((item) =>
                    buildCartItemKey(item.product_id, item.storageId) === itemKey
                        ? {
                            ...item,
                            quantity: item.quantity + 1,
                            max_stock: isInfiniteActivity ? ACTIVITY_POS_QUANTITY_LIMIT : product.inventoryQuantity
                        }
                        : item
                )
            }
            return [
                ...prev,
                {
                    product_id: product.id,
                    storageId: product.storageId,
                    sku: product.sku,
                    name: product.name,
                    price: product.price,
                    discounted_price: activeDiscount?.discountPrice,
                    discount_type: activeDiscount?.discountType,
                    discount_value: activeDiscount?.discountValue,
                    discount_source: activeDiscount?.source,
                    discount_ends_at: activeDiscount?.endsAt,
                    quantity: 1,
                    max_stock: isInfiniteActivity ? ACTIVITY_POS_QUANTITY_LIMIT : product.inventoryQuantity,
                    imageUrl: product.imageUrl,
                    unit: product.unit
                }
            ]
        })
        hapticTrigger('selection')
    }, [activeDiscountMap, cartCurrencies, currencyConversionEnabled, features, t, toast, hapticTrigger])

    const removeFromCart = (itemKey: string) => {
        setCart((prev) => prev.filter((item) => getCartItemKey(item) !== itemKey))
        hapticTrigger('warning')
    }

    const updateQuantity = (itemKey: string, delta: number) => {
        setCart((prev) => {
            const updatedCart = prev.map((item) => {
                if (getCartItemKey(item) === itemKey) {
                    const newQty = item.quantity + delta
                    if (newQty <= 0) return null // Mark for removal
                    const product = findStockProduct(item.product_id, item.storageId)
                    const maxStock = product?.inventoryQuantity ?? item.max_stock
                    if (newQty > maxStock) return { ...item, max_stock: maxStock }
                    return { ...item, quantity: newQty, max_stock: maxStock }
                }
                return item
            }).filter((item): item is CartItem => item !== null) // Filter out nulls (removed items)
            return updatedCart
        })
        hapticTrigger('selection')
    }

    const setExactQuantity = (itemKey: string, quantity: number) => {
        if (quantity <= 0) {
            removeFromCart(itemKey)
            return
        }
        setCart((prev) =>
            prev.map((item) => {
                if (getCartItemKey(item) === itemKey) {
                    const product = findStockProduct(item.product_id, item.storageId)
                    const maxStock = product?.inventoryQuantity ?? item.max_stock
                    return { ...item, quantity: Math.min(quantity, maxStock), max_stock: maxStock }
                }
                return item
            })
        )
    }

    const setNegotiatedPrice = (itemKey: string, price: number | undefined) => {
        setCart((prev) =>
            prev.map((item) =>
                getCartItemKey(item) === itemKey
                    ? { ...item, negotiated_price: price }
                    : item
            )
        )
    }

    const formatNumberWithCommas = (value: string) => {
        const stripped = value.replace(/,/g, '')
        if (stripped === '' || stripped === '.') return stripped
        const parts = stripped.split('.')
        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',')
        return parts.join('.')
    }

    const parseFormattedNumber = (value: string) => {
        return parseFloat(value.replace(/,/g, ''))
    }

    const openPriceEdit = (item: CartItem) => {
        setEditingPriceItemKey(getCartItemKey(item))
        setNegotiatedPriceInput(formatNumberWithCommas(getCartEffectivePrice(item).toString()))
    }

    const savePriceEdit = () => {
        if (editingPriceItemKey) {
            const newPrice = parseFormattedNumber(negotiatedPriceInput)
            if (!isNaN(newPrice) && newPrice >= 0) {
                setNegotiatedPrice(editingPriceItemKey, newPrice)
            }
            setEditingPriceItemKey(null)
            setNegotiatedPriceInput('')
        }
    }

    const cancelPriceEdit = () => {
        setEditingPriceItemKey(null)
        setNegotiatedPriceInput('')
    }

    const clearNegotiatedPrice = (item: CartItem) => {
        setNegotiatedPrice(getCartItemKey(item), undefined)
    }

    const handleSkuSubmit = (e: React.FormEvent) => {
        e.preventDefault()
        const normalizedInput = normalizeBarcodeScannerText(skuInput)
        const term = normalizedInput.toLowerCase()
        if (!normalizedInput) {
            return
        }

        const barcodeProductId = barcodeMap.get(normalizedInput) ?? barcodeMap.get(term)
        const candidates = barcodeProductId
            ? products.filter((product) => product.id === barcodeProductId)
            : products.filter((product) => product.sku.toLowerCase() === term)

        const exactMatch = candidates.find(p => p.storageId === selectedStorageId)
        const otherMatch = candidates.find(p => p.storageId !== selectedStorageId)

        if (exactMatch) {
            addToCart(exactMatch)
            setSkuInput('')
            setIsSkuModalOpen(false)
            toast({
                title: t('messages.success'),
                description: `${exactMatch.name} ${t('common.added')}`,
                duration: 2000,
            })
        } else if (otherMatch) {
            // Found in another storage
            const storageName = storages.find(s => s.id === otherMatch.storageId)?.name || 'Unknown'
            setCrossStorageWarning({ product: otherMatch, foundStorageName: storageName })
            setSkuInput('')
            setIsSkuModalOpen(false)
        } else {
            toast({
                variant: 'destructive',
                title: t('messages.error'),
                description: `${t('pos.skuNotFound')}: ${normalizedInput}`,
                duration: 2000,
            })
            hapticTrigger('error')
        }
    }

    const handleBarcodeDetected = useCallback((barcodes: any[], source: 'camera' | 'device') => {
        const isEnabled = source === 'camera' ? isCameraScannerAutoEnabled : isDeviceScannerAutoEnabled
        if (!isEnabled || barcodes.length === 0) return
        const text = normalizeBarcodeScannerText(String(barcodes[0].rawValue ?? ''))
        if (!text) return

        // Simple debounce/cooldown logic
        const now = Date.now()
        if (text === lastScannedCode.current && (now - lastScannedTime.current) < scanDelay) {
            return
        }

        lastScannedCode.current = text
        lastScannedTime.current = now

        const term = text.toLowerCase()
        const barcodeProductId = barcodeMap.get(text) ?? barcodeMap.get(term)
        const candidates = barcodeProductId
            ? products.filter((product) => product.id === barcodeProductId)
            : products.filter((product) => product.sku.toLowerCase() === term)

        const exactMatch = candidates.find(p => p.storageId === selectedStorageId)
        const otherMatch = candidates.find(p => p.storageId !== selectedStorageId)

        if (exactMatch) {
            addToCart(exactMatch)
            toast({
                title: t('messages.success'),
                description: `${exactMatch.name} ${t('common.added')}`,
                duration: 2000,
            })
        } else if (otherMatch) {
            const storageName = storages.find(s => s.id === otherMatch.storageId)?.name || 'Unknown'
            setCrossStorageWarning({ product: otherMatch, foundStorageName: storageName })
        } else {
            toast({
                variant: 'destructive',
                title: t('messages.error'),
                description: `${t('pos.skuNotFound')}: ${text}`,
                duration: 2000,
            })
            hapticTrigger('error')
        }
    }, [isCameraScannerAutoEnabled, isDeviceScannerAutoEnabled, scanDelay, barcodeMap, products, addToCart, t, toast, selectedStorageId, storages, hapticTrigger])

    useEffect(() => {
        const clearDeviceScanTimeout = () => {
            if (deviceScanTimeout.current) {
                window.clearTimeout(deviceScanTimeout.current)
                deviceScanTimeout.current = null
            }
        }

        const resetDeviceScanState = () => {
            clearDeviceScanTimeout()
            deviceScanBuffer.current = ''
            deviceScanActive.current = false
            deviceScanFastCount.current = 0
            deviceScanLastTime.current = 0
            deviceScanEditableSnapshot.current = null
        }

        if (
            !isDeviceScannerAutoEnabled
            || isSkuModalOpen
            || isLoanRegistrationModalOpen
            || editingPriceItemKey
        ) {
            resetDeviceScanState()
            return
        }

        const scheduleDeviceScanReset = () => {
            clearDeviceScanTimeout()
            deviceScanTimeout.current = window.setTimeout(resetDeviceScanState, BARCODE_SCANNER_STALE_RESET_MS)
        }

        const activateDeviceScannerCapture = () => {
            if (deviceScanActive.current) {
                return
            }

            deviceScanActive.current = true
            restoreEditableScanSnapshot(deviceScanEditableSnapshot.current)
        }

        const commitDeviceScan = (hasTerminator = false) => {
            if (!deviceScanBuffer.current) return
            const payload = normalizeBarcodeScannerText(deviceScanBuffer.current)
            if (!payload) {
                resetDeviceScanState()
                return
            }

            // Only reject scans that are still a known prefix of a longer code and
            // have not been terminated yet, so we keep waiting for the rest of it.
            // Any other complete scan is committed, matching the focused-input
            // (BarcodeScannerModal) behaviour which never whitelist-validates.
            if (!hasTerminator && hasBarcodeScannerKnownPrefix(payload, knownScannerCodeIndex)) {
                const isComplete = shouldCommitBarcodeScannerValue(payload, knownScannerCodeIndex, {
                    hasTerminator: false,
                    allowUnknown: false
                })
                if (!isComplete) {
                    scheduleDeviceScanReset()
                    return
                }
            }

            resetDeviceScanState()
            handleBarcodeDetected([{ rawValue: payload }], 'device')
        }

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.ctrlKey || event.metaKey || event.altKey) return
            if (isBarcodeScannerIgnoredKey(event.key)) return

            // The modal's dedicated Scanner Input owns its complete sequence.
            // Global capture stays active for every other place in the modal.
            const eventTarget = event.target
            if (
                eventTarget instanceof Element
                && eventTarget.closest('[data-pos-barcode-scanner-input]')
            ) return

            if (isBarcodeScannerTerminatorKey(event.key)) {
                const isLikelyScan = deviceScanActive.current
                    || normalizeBarcodeScannerText(deviceScanBuffer.current).length >= BARCODE_SCANNER_MIN_SCAN_LENGTH

                if (deviceScanBuffer.current && isLikelyScan) {
                    event.preventDefault()
                    event.stopPropagation()
                    restoreEditableScanSnapshot(deviceScanEditableSnapshot.current)
                    commitDeviceScan(true)
                }
                return
            }

            const normalizedKey = getBarcodeScannerEventKey(event)
            if (normalizedKey.length !== 1) return

            const timestamp = event.timeStamp
            const wasActive = deviceScanActive.current
            const timing = classifyBarcodeScannerKeyTiming(timestamp, deviceScanLastTime.current, {
                hasBufferedValue: Boolean(deviceScanBuffer.current),
                isActive: wasActive
            })

            if (timing.shouldReset) {
                clearDeviceScanTimeout()
                const focusedEditableElement = getFocusedEditableScanElement()
                deviceScanBuffer.current = ''
                deviceScanActive.current = false
                deviceScanFastCount.current = 0
                deviceScanEditableSnapshot.current = focusedEditableElement
                    ? createEditableScanSnapshot(focusedEditableElement)
                    : null
            }

            deviceScanLastTime.current = timestamp

            if (timing.isFast) {
                deviceScanFastCount.current += 1
            } else if (!wasActive) {
                deviceScanFastCount.current = 0
            }

            deviceScanBuffer.current += normalizedKey

            if (deviceScanFastCount.current >= BARCODE_SCANNER_ACTIVE_FAST_KEY_COUNT) {
                activateDeviceScannerCapture()
            }

            if (deviceScanActive.current) {
                event.preventDefault()
                event.stopPropagation()
                clearDeviceScanTimeout()
                deviceScanTimeout.current = window.setTimeout(() => {
                    commitDeviceScan(false)
                }, BARCODE_SCANNER_AUTO_COMMIT_DELAY_MS)
            }
        }

        window.addEventListener('keydown', onKeyDown, true)
        return () => {
            window.removeEventListener('keydown', onKeyDown, true)
            clearDeviceScanTimeout()
        }
    }, [
        editingPriceItemKey,
        handleBarcodeDetected,
        isDeviceScannerAutoEnabled,
        isLoanRegistrationModalOpen,
        isSkuModalOpen,
        knownScannerCodeIndex
    ])

    const handleHoldSale = () => {
        if (cart.length === 0) return

        const newHeldSale: HeldSale = {
            id: generateId(),
            items: [...cart],
            rates: {
                usd_iqd: exchangeData ? exchangeData.rate / 100 : 0,
                eur_iqd: eurRates.eur_iqd ? eurRates.eur_iqd.rate / 100 : 0,
                usd_eur: eurRates.usd_eur ? eurRates.usd_eur.rate / 100 : 0,
                try_iqd: tryRates.try_iqd ? tryRates.try_iqd.rate / 100 : 0,
                sources: {
                    usd_iqd: exchangeData?.source || 'unknown',
                    eur_iqd: eurRates.eur_iqd?.source || 'unknown',
                    usd_eur: eurRates.usd_eur?.source || 'unknown',
                    try_iqd: tryRates.try_iqd?.source || 'unknown',
                }
            },
            settlementCurrency,
            paymentType,
            digitalProvider: paymentType === 'digital' ? digitalProvider : undefined,
            timestamp: new Date().toISOString(),
            total: totalAmount
        }

        setHeldSales(prev => [...prev, newHeldSale])
        setCart([])
        setRestoredSale(null)
        setPaymentType('cash')

        toast({
            title: t('pos.saleHeld', 'Sale Held'),
            description: t('pos.saleHeldDesc', 'Current sale has been put on hold.'),
            duration: 3000
        })
        hapticTrigger('success')
    }

    const handleRestoreSale = (sale: HeldSale) => {
        if (cart.length > 0) {
            // Confirm with user if they want to override current cart
            if (!window.confirm(t('pos.confirmRestore', 'Restoring this sale will overwrite the current cart. Continue?'))) {
                return
            }
        }

        const normalizedItems = sale.items.map((item) => {
            const storageId = item.storageId || selectedStorageId
            const product = findStockProduct(item.product_id, storageId)

            return {
                ...item,
                storageId,
                max_stock: product?.inventoryQuantity ?? item.max_stock
            }
        })
        const restoredStorageIds = Array.from(new Set(normalizedItems.map((item) => item.storageId).filter(Boolean)))
        if (restoredStorageIds.length === 1) {
            setSelectedStorageId(restoredStorageIds[0])
        }

        setCart(normalizedItems)
        setRestoredSale(sale)
        // Settlement currency is handled by features.default_currency, which we already use.
        // If we needed to force it, we'd need more state, but for now we assume it matches.
        setPaymentType((sale.paymentType as any) || 'cash')
        if (sale.paymentType === 'digital') {
            setDigitalProvider((sale.digitalProvider as any) || 'fib')
        }
        setHeldSales(prev => prev.filter(s => s.id !== sale.id))
        setIsHeldSalesModalOpen(false)

        toast({
            title: t('pos.saleRestored', 'Sale Restored'),
            description: t('pos.saleRestoredDesc', 'Held sale has been restored with its original rates.'),
            duration: 3000
        })
        hapticTrigger('success')
    }

    const handleDeleteHeldSale = (id: string) => {
        setHeldSales(prev => prev.filter(s => s.id !== id))
    }

    const handleActivitiesCheckout = async () => {
        if (cart.length === 0 || !user || !canSellActivities) return

        if (paymentType === 'loan') {
            setPaymentType('cash')
            return
        }

        for (const item of cart) {
            const activity = findStockProduct(item.product_id, item.storageId)
            if (!activity || activity.storageId !== ACTIVITIES_STORAGE_ID) {
                toast({
                    variant: 'destructive',
                    title: t('messages.error'),
                    description: t('activities.messages.activityUnavailable', { defaultValue: 'One or more activities are no longer available.' })
                })
                return
            }

            if (!activity.isInfiniteActivity && item.quantity > activity.inventoryQuantity) {
                toast({
                    variant: 'destructive',
                    title: t('messages.error'),
                    description: t('activities.errors.availabilityInsufficient', { defaultValue: 'This activity no longer has enough availability.' })
                })
                return
            }
        }

        setIsLoading(true)
        try {
            const result = await createActivityTransaction(user.workspaceId, {
                name: t('activities.posSaleName', { defaultValue: 'POS activity sale' }),
                customerName: null,
                occurredAt: new Date().toISOString(),
                currency: settlementCurrency as CurrencyCode,
                paymentMethod: paymentType === 'digital' ? digitalProvider : 'cash',
                notes: null,
                lines: cart.map((item) => ({
                    activityId: item.product_id,
                    quantity: item.quantity,
                    unitPrice: getCartEffectivePrice(item)
                })),
                createdBy: user.id
            })

            setCart([])
            setDiscountValue('')
            setCompletedActivityCheckout(result)
            setCompletedSaleData(toUISaleFromActivityTransaction(result.transaction, result.lines))
            setIsSuccessModalOpen(true)
            hapticTrigger('success')
            playCheckoutSound()
            toast({
                title: t('activities.messages.transactionSaved', { defaultValue: 'Activity transaction saved' }),
                description: result.transaction.transactionNo
            })
        } catch (error) {
            const normalizedError = normalizeSupabaseActionError(error)
            toast({
                variant: 'destructive',
                title: t('messages.error'),
                description: normalizedError.message || t('activities.messages.saveTransactionFailed', { defaultValue: 'Could not save activity transaction' })
            })
        } finally {
            setIsLoading(false)
        }
    }

    const handleCheckout = async (loanRegistrationData?: LoanRegistrationData) => {
        if (cart.length === 0 || !user) return

        if (isActivitiesStorage) {
            await handleActivitiesCheckout()
            return
        }

        // The workspace policy can be changed from another POS terminal. Check
        // the authoritative value before building a checkout payload so a stale
        // feature cache cannot submit conversion snapshots against a disabled
        // policy.
        if (!isLocalMode && isOnline(user.workspaceId)) {
            const { data: currencyPolicy, error: currencyPolicyError } = await runSupabaseAction(
                'pos.getCurrencyConversionPolicy',
                () => supabase
                    .from('workspaces')
                    .select('pos_convert_to_workspace_currency')
                    .eq('id', user.workspaceId)
                    .maybeSingle()
            )

            if (currencyPolicyError || !currencyPolicy) {
                const normalized = normalizeSupabaseActionError(
                    currencyPolicyError || new Error('Workspace currency conversion policy could not be loaded.')
                )
                toast({
                    variant: 'destructive',
                    title: t('messages.error'),
                    description: normalized.message
                })
                return
            }

            const authoritativeCurrencyConversionEnabled = currencyPolicy.pos_convert_to_workspace_currency !== false
            if (authoritativeCurrencyConversionEnabled !== currencyConversionEnabled) {
                await refreshFeatures()
                toast({
                    title: t('pos.currencyConversionPolicyUpdated', 'POS setting updated'),
                    description: t('pos.currencyConversionPolicyUpdatedDescription', 'Currency conversion changed for this workspace. Review the cart and checkout again.')
                })
                return
            }
        }

        if (!currencyConversionEnabled && hasMixedCartCurrencies) {
            toast({
                variant: 'destructive',
                title: t('messages.error'),
                description: t('pos.currencyConversionSingleCurrencyCart', 'Currency conversion is disabled. A sale can contain products in only one currency.')
            })
            return
        }

        const validLoanRegistrationData = isLoanRegistrationData(loanRegistrationData)
            ? loanRegistrationData
            : undefined

        if (paymentType === 'loan' && !validLoanRegistrationData) {
            setIsLoanRegistrationModalOpen(true)
            return
        }

        if (paymentType === 'loan' && validLoanRegistrationData) {
            setIsLoanRegistrationModalOpen(false)
        }

        const isMixedCurrency = cart.some(item => {
            const product = findStockProduct(item.product_id, item.storageId)
            return product && product.currency !== settlementCurrency
        })

        if (isMixedCurrency && !exchangeData) {
            toast({
                variant: 'destructive',
                title: t('messages.error'),
                description: t('pos.exchangeRateError') || 'Exchange rate unavailable. Mixed-currency checkout blocked.',
            })
            return
        }

        for (const item of cart) {
            const product = findStockProduct(item.product_id, item.storageId)
            const storageId = item.storageId || selectedStorageId

            if (!product || !storageId) {
                toast({
                    variant: 'destructive',
                    title: t('messages.error'),
                    description: t('pos.stockMismatch') || 'One or more cart items no longer match an inventory row.'
                })
                return
            }

            if (item.quantity > product.inventoryQuantity) {
                const storageName = storages.find((storage) => storage.id === storageId)?.name || 'Unknown'
                toast({
                    variant: 'destructive',
                    title: t('messages.error'),
                    description: `${product.name} ${t('pos.insufficientStock') || 'does not have enough stock in'} ${storageName}.`
                })
                return
            }
        }

        setIsLoading(true)

        const saleId = generateId()

        // Collect actually used exchange rates for this specific checkout
        const usedCurrencies = new Set(cart.map(item => findStockProduct(item.product_id, item.storageId)?.currency || 'usd' as CurrencyCode))

        const knownRates = {
            usdIqd: exchangeData ? { rate: exchangeData.rate, source: exchangeData.source, timestamp: exchangeData.timestamp || new Date().toISOString() } : null,
            eurIqd: eurRates.eur_iqd ? { rate: eurRates.eur_iqd.rate, source: eurRates.eur_iqd.source, timestamp: eurRates.eur_iqd.timestamp } : null,
            tryIqd: tryRates.try_iqd ? { rate: tryRates.try_iqd.rate, source: tryRates.try_iqd.source, timestamp: tryRates.try_iqd.timestamp } : null,
            usdEur: eurRates.usd_eur ? { rate: eurRates.usd_eur.rate, source: eurRates.usd_eur.source, timestamp: eurRates.usd_eur.timestamp } : null,
            usdTry: tryRates.usd_try ? { rate: tryRates.usd_try.rate, source: tryRates.usd_try.source, timestamp: tryRates.usd_try.timestamp } : null,
        }

        // Conversion-disabled sales stay in their product currency. Do not let
        // the snapshot helper's IQD fallback create an exchange record for an
        // otherwise single-currency checkout.
        const exchangeRatesSnapshot = currencyConversionEnabled
            ? buildCheckoutRatesSnapshot(usedCurrencies, settlementCurrency, knownRates)
            : []
        const primary = currencyConversionEnabled
            ? getPrimaryCheckoutRate(usedCurrencies, settlementCurrency, knownRates)
            : null

        const snapshotRate = primary?.rate || 0
        const snapshotSource = primary?.source || 'none'
        const snapshotTimestamp = primary?.timestamp || new Date().toISOString()
        const hasExchangeSnapshot = exchangeRatesSnapshot.length > 0
        const exchangeRatesPayload = hasExchangeSnapshot ? exchangeRatesSnapshot : null
        const salesExchangePayload = exchangeSnapshotsToPayloads(exchangeRatesPayload)

        let batchSalePlans: Awaited<ReturnType<typeof getStockBatchSalePlans>>
        try {
            batchSalePlans = await getStockBatchSalePlans(cart.map((item) => {
                const storageId = item.storageId || selectedStorageId
                if (!storageId) {
                    throw new Error('Storage is required for batched sale items')
                }

                return {
                    productId: item.product_id,
                    storageId,
                    quantity: item.quantity
                }
            }))
        } catch (error) {
            const normalized = normalizeSupabaseActionError(error)
            toast({
                variant: 'destructive',
                title: t('messages.error'),
                description: normalized.message || (t('pos.stockMismatch') || 'Unable to allocate stock batches for one or more items.')
            })
            setIsLoading(false)
            return
        }

        const itemsWithMetadata = cart.map((item, index) => {
            const product = findStockProduct(item.product_id, item.storageId)
            const originalCurrency = product?.currency || 'usd'
            const effectivePrice = getCartEffectivePrice(item)
            const convertedUnitPrice = convertPrice(effectivePrice, originalCurrency, settlementCurrency)
            const batchPlan = batchSalePlans[index]
            const costPrice = calculateStockBatchUnitCost(
                batchPlan.allocations,
                product?.costPrice || 0,
                originalCurrency,
                convertPrice,
                batchPlan.requestedQuantity
            )
            const convertedCostPrice = calculateStockBatchUnitCost(
                batchPlan.allocations,
                convertPrice(product?.costPrice || 0, originalCurrency, settlementCurrency),
                settlementCurrency,
                convertPrice,
                batchPlan.requestedQuantity
            )

            return {
                product_id: item.product_id,
                storage_id: item.storageId || selectedStorageId || null,
                product_name: product?.name || 'Unknown',
                product_sku: product?.sku || '',
                quantity: item.quantity,
                unit_price: effectivePrice, // negotiated or original
                total_price: effectivePrice * item.quantity,
                cost_price: costPrice,
                converted_cost_price: convertedCostPrice,
                original_currency: originalCurrency,
                original_unit_price: item.price, // always store original list price
                converted_unit_price: convertedUnitPrice,
                settlement_currency: settlementCurrency,
                negotiated_price: item.negotiated_price, // store if negotiated
                total: convertedUnitPrice * item.quantity,
                // Immutable inventory snapshot at checkout time
                inventory_snapshot: product?.inventoryQuantity ?? 0,
                batch_allocations: batchPlan.allocations.length > 0
                    ? batchPlan.allocations.map((allocation) => ({
                        batch_id: allocation.batchId,
                        batch_number: allocation.batchNumber,
                        quantity: allocation.quantity,
                        price: allocation.price ?? null,
                        cost_price: allocation.costPrice ?? null,
                        currency: allocation.currency ?? null,
                        expiry_date: allocation.expiryDate ?? null,
                        manufacturing_date: allocation.manufacturingDate ?? null
                    }))
                    : null
            }
        })

        const checkoutPayload = {
            id: saleId,
            workspace_id: user.workspaceId,
            items: itemsWithMetadata,
            total_amount: totalAmount,
            settlement_currency: settlementCurrency,
            currency_conversion_applied: currencyConversionEnabled,
            sales_exchange: salesExchangePayload,
            origin: 'pos',
            payment_method: (paymentType === 'cash'
                ? 'cash'
                : paymentType === 'loan'
                    ? 'loan'
                    : digitalProvider) as 'cash' | 'fib' | 'qicard' | 'zaincash' | 'fastpay' | 'loan'
        }

        try {
            if (isLocalMode || !isOnline(user.workspaceId)) {
                throw new Error(isLocalMode ? 'local_workspace_sale' : 'offline_workspace_sale')
            }

            // Attempt online checkout
            const { data, error } = await runSupabaseAction('pos.completeSale', () =>
                supabase.rpc('complete_sale', {
                    payload: checkoutPayload
                })
            )

            if (error) {
                throw normalizeSupabaseActionError(error)
            }

            // Capture sequence_id and result from server
            const serverResult = data as any
            const sequenceId = serverResult?.sequence_id
            const formattedInvoiceId = sequenceId ? `#${String(sequenceId).padStart(5, '0')}` : `#${saleId.slice(0, 8)}`

            // 1. Update local inventory
            await Promise.all(cart.map(async (item) => {
                const storageId = item.storageId || selectedStorageId
                if (!storageId) return

                await adjustInventoryQuantity({
                    workspaceId: user.workspaceId,
                    productId: item.product_id,
                    storageId,
                    quantityDelta: -item.quantity,
                    timestamp: snapshotTimestamp,
                    syncSource: 'remote',
                    skipRemoteSync: true
                })
            }))

            await Promise.all(batchSalePlans.map((plan) =>
                commitStockBatchAllocations(
                    user.workspaceId,
                    plan.productId,
                    plan.storageId,
                    plan.allocations,
                    {
                        timestamp: snapshotTimestamp,
                        syncSource: 'remote',
                        skipRemoteSync: true
                    }
                )
            ))
            await refreshStockBatchesFromSupabase(user.workspaceId)

            const saleData = mapSaleToUniversal({
                ...checkoutPayload,
                sequenceId: sequenceId,
                created_at: snapshotTimestamp,
                workspace_id: user?.workspaceId || '',
                cashier_id: user?.id || '',
                cashier_name: user?.name || ''
            } as any)

            await db.invoices.add({
                id: saleId,
                invoiceid: formattedInvoiceId,
                sequenceId: sequenceId,
                workspaceId: user?.workspaceId || '',
                customerId: '', // POS sales are guest by default
                status: 'paid',
                totalAmount: totalAmount,
                settlementCurrency: settlementCurrency,
                origin: 'pos',
                cashierName: user?.name || 'System',
                createdByName: user?.name || 'System',
                createdAt: snapshotTimestamp,
                updatedAt: snapshotTimestamp,
                syncStatus: 'synced',
                lastSyncedAt: new Date().toISOString(),
                version: 1,
                isDeleted: false
            })

            if (paymentType === 'loan' && validLoanRegistrationData) {
                try {
                    const loanResult = await createLoanFromPosSale(user.workspaceId, {
                        saleId,
                        linkedPartyType: validLoanRegistrationData.linkedPartyType || null,
                        linkedPartyId: validLoanRegistrationData.linkedPartyId || null,
                        linkedPartyName: validLoanRegistrationData.linkedPartyName || null,
                        borrowerName: validLoanRegistrationData.borrowerName,
                        borrowerPhone: validLoanRegistrationData.borrowerPhone,
                        borrowerAddress: validLoanRegistrationData.borrowerAddress,
                        borrowerNationalId: validLoanRegistrationData.borrowerNationalId,
                        principalAmount: totalAmount,
                        settlementCurrency: settlementCurrency as CurrencyCode,
                        exchangeRateSnapshot: exchangeRatesPayload,
                        installmentCount: validLoanRegistrationData.installmentCount,
                        installmentFrequency: validLoanRegistrationData.installmentFrequency,
                        firstDueDate: validLoanRegistrationData.firstDueDate,
                        notes: validLoanRegistrationData.notes,
                        createdBy: user.id
                    })

                    if (!validLoanRegistrationData.linkedPartyType && validLoanRegistrationData.borrowerName.trim()) {
                        setPosLoanSavePartnerData({
                            loanId: loanResult.loan.id,
                            borrowerName: validLoanRegistrationData.borrowerName.trim(),
                            borrowerPhone: validLoanRegistrationData.borrowerPhone.trim(),
                            borrowerAddress: validLoanRegistrationData.borrowerAddress.trim(),
                            settlementCurrency: settlementCurrency as CurrencyCode
                        })
                    }
                } catch (loanErr) {
                    console.error('[POS] Loan registration failed after checkout:', loanErr)
                    toast({
                        variant: 'destructive',
                        title: t('messages.error'),
                        description: t('loans.messages.loanCreateFailed') || 'Loan registration failed. Sale was completed.'
                    })
                }
            }

            setCart([])
            setDiscountValue('')
            setIsLoanRegistrationModalOpen(false)
            setCompletedActivityCheckout(null)
            setCompletedSaleData(saleData)
            demoTutorial.recordPosSaleCreated(saleId)
            setIsSuccessModalOpen(true)
            hapticTrigger('success')
            playCheckoutSound()

            // Refresh exchange rate for the next sale
            refreshExchangeRate()
        } catch (err: any) {
            console.error('Checkout failed, attempting offline save:', err)
            const normalizedError = normalizeSupabaseActionError(err)

            if (isLocalMode || !isOnline(user.workspaceId) || isRetriableWebRequestError(normalizedError)) {
                try {
                    // Run local verification FIRST (before save, but using the data we're about to save)
                    const verificationSale = createVerificationSale(
                        totalAmount,
                        settlementCurrency,
                        hasExchangeSnapshot ? snapshotRate : null,
                        hasExchangeSnapshot ? snapshotSource : null,
                        itemsWithMetadata,
                        exchangeRatesPayload
                    )
                    const verificationResult = verifySale(verificationSale, {
                        maxDiscountPercent: features.max_discount_percent
                    })

                    // 1. Save Sale locally (with verification fields)
                    const localSequenceId = await generateLocalSaleSequenceId(user.workspaceId)
                    await db.sales.add({
                        id: saleId,
                        workspaceId: user.workspaceId,
                        cashierId: user.id,
                        totalAmount: totalAmount,
                        originalTotalAmount: totalAmount,
                        returnedAmount: 0,
                        returnStatus: 'none',
                        settlementCurrency: settlementCurrency,
                        currencyConversionApplied: currencyConversionEnabled,
                        origin: 'pos',
                        payment_method: checkoutPayload.payment_method,
                        sequenceId: localSequenceId,
                        createdAt: snapshotTimestamp,
                        updatedAt: snapshotTimestamp,
                        syncStatus: 'pending',
                        lastSyncedAt: null,
                        version: 1,
                        isDeleted: false,
                        // System Verification (immutable)
                        systemVerified: verificationResult.verified,
                        systemReviewStatus: verificationResult.status,
                        systemReviewReason: verificationResult.reason
                    })

                    if (salesExchangePayload.length > 0) {
                        await db.sales_exchange.bulkAdd(
                            salesExchangePayload.map((row) => ({
                                id: generateId(),
                                saleId,
                                workspaceId: user.workspaceId,
                                baseCurrency: row.base_currency,
                                quoteCurrency: row.quote_currency,
                                baseAmount: row.base_amount,
                                quoteAmount: row.quote_amount,
                                source: row.source,
                                capturedAt: row.captured_at,
                                rateSide: row.rate_side,
                                sourcePriceId: row.source_price_id,
                                sourcePriceUpdatedAt: row.source_price_updated_at,
                                createdAt: snapshotTimestamp
                            }))
                        )
                    }

                    // 2. Save Sale Items locally (with inventory snapshot)
                    await Promise.all(itemsWithMetadata.map(item =>
                        db.sale_items.add({
                            id: generateId(),
                            saleId: saleId,
                            productId: item.product_id,
                            storageId: item.storage_id,
                            quantity: item.quantity,
                            unitPrice: item.unit_price,
                            totalPrice: item.total_price,
                            costPrice: item.cost_price,
                            convertedCostPrice: item.converted_cost_price,
                            originalCurrency: item.original_currency,
                            originalUnitPrice: item.original_unit_price,
                            convertedUnitPrice: item.converted_unit_price,
                            settlementCurrency: item.settlement_currency,
                            negotiatedPrice: item.negotiated_price,
                            inventorySnapshot: item.inventory_snapshot,
                            batchAllocations: item.batch_allocations?.map((allocation) => ({
                                batchId: allocation.batch_id,
                                batchNumber: allocation.batch_number,
                                quantity: allocation.quantity,
                                price: allocation.price ?? null,
                                costPrice: allocation.cost_price ?? null,
                                currency: allocation.currency ?? null,
                                expiryDate: allocation.expiry_date ?? null,
                                manufacturingDate: allocation.manufacturing_date ?? null
                            })),
                            originalBatchAllocations: item.batch_allocations?.map((allocation) => ({
                                batchId: allocation.batch_id,
                                batchNumber: allocation.batch_number,
                                quantity: allocation.quantity,
                                price: allocation.price ?? null,
                                costPrice: allocation.cost_price ?? null,
                                currency: allocation.currency ?? null,
                                expiryDate: allocation.expiry_date ?? null,
                                manufacturingDate: allocation.manufacturing_date ?? null
                            }))
                        })
                    ))

                    // 3. Update Local Inventory
                    await Promise.all(cart.map(async (item) => {
                        const storageId = item.storageId || selectedStorageId
                        if (!storageId) return

                        await adjustInventoryQuantity({
                            workspaceId: user.workspaceId,
                            productId: item.product_id,
                            storageId,
                            quantityDelta: -item.quantity,
                            timestamp: snapshotTimestamp
                        })
                    }))

                    await Promise.all(batchSalePlans.map((plan) =>
                        commitStockBatchAllocations(
                            user.workspaceId,
                            plan.productId,
                            plan.storageId,
                            plan.allocations,
                            { timestamp: snapshotTimestamp }
                        )
                    ))

                    const localFormattedInvoiceId = `#${String(localSequenceId).padStart(5, '0')}`
                    const saleDataOffline = mapSaleToUniversal({
                        ...checkoutPayload,
                        sequenceId: localSequenceId,
                        invoiceid: localFormattedInvoiceId,
                        created_at: snapshotTimestamp,
                        workspace_id: user?.workspaceId || '',
                        cashier_id: user?.id || '',
                        cashier_name: user?.name || ''
                    } as any)

                    if (!isLocalMode) {
                        await db.invoices.add({
                            id: saleId,
                            invoiceid: `#${String(localSequenceId).padStart(5, '0')}`,
                            sequenceId: localSequenceId,
                            workspaceId: user?.workspaceId || '',
                            customerId: '',
                            status: 'paid',
                            totalAmount: totalAmount,
                            settlementCurrency: settlementCurrency,
                            origin: 'pos',
                            cashierName: user?.name || 'System',
                            createdByName: user?.name || 'System',
                            createdAt: snapshotTimestamp,
                            updatedAt: snapshotTimestamp,
                            syncStatus: 'pending',
                            lastSyncedAt: null,
                            version: 1,
                            isDeleted: false
                        })
                    }

                    // 5. Add to Sync Queue (server will compute authoritative review fields)
                    await addToOfflineMutations('sales', saleId, 'create', checkoutPayload, user.workspaceId)

                    if (paymentType === 'loan' && validLoanRegistrationData) {
                        try {
                            const loanResult = await createLoanFromPosSale(user.workspaceId, {
                                saleId,
                                linkedPartyType: validLoanRegistrationData.linkedPartyType || null,
                                linkedPartyId: validLoanRegistrationData.linkedPartyId || null,
                                linkedPartyName: validLoanRegistrationData.linkedPartyName || null,
                                borrowerName: validLoanRegistrationData.borrowerName,
                                borrowerPhone: validLoanRegistrationData.borrowerPhone,
                                borrowerAddress: validLoanRegistrationData.borrowerAddress,
                                borrowerNationalId: validLoanRegistrationData.borrowerNationalId,
                                principalAmount: totalAmount,
                                settlementCurrency: settlementCurrency as CurrencyCode,
                                exchangeRateSnapshot: exchangeRatesPayload,
                                installmentCount: validLoanRegistrationData.installmentCount,
                                installmentFrequency: validLoanRegistrationData.installmentFrequency,
                                firstDueDate: validLoanRegistrationData.firstDueDate,
                                notes: validLoanRegistrationData.notes,
                                createdBy: user.id
                            })

                            if (!validLoanRegistrationData.linkedPartyType && validLoanRegistrationData.borrowerName.trim()) {
                                setPosLoanSavePartnerData({
                                    loanId: loanResult.loan.id,
                                    borrowerName: validLoanRegistrationData.borrowerName.trim(),
                                    borrowerPhone: validLoanRegistrationData.borrowerPhone.trim(),
                                    borrowerAddress: validLoanRegistrationData.borrowerAddress.trim(),
                                    settlementCurrency: settlementCurrency as CurrencyCode
                                })
                            }
                        } catch (loanErr) {
                            console.error('[POS] Offline loan registration failed:', loanErr)
                            toast({
                                variant: 'destructive',
                                title: t('messages.error'),
                                description: t('loans.messages.loanCreateFailed') || 'Loan registration failed. Sale was completed.'
                            })
                        }
                    }

                    setCart([])
                    setDiscountValue('')
                    setIsLoanRegistrationModalOpen(false)
                    setCompletedActivityCheckout(null)
                    setCompletedSaleData(saleDataOffline)
                    demoTutorial.recordPosSaleCreated(saleId)
                    setIsSuccessModalOpen(true)
                    hapticTrigger('success')
                    playCheckoutSound()
                    return
                } catch (saveErr: any) {
                    console.error('Offline save failed:', saveErr)
                }
            }

            if (!isLocalMode && isRetriableWebRequestError(normalizedError)) {
                const message = getRetriableActionToast(normalizedError)
                toast({
                    variant: 'destructive',
                    title: message.title,
                    description: message.description,
                })
                return
            }

            toast({
                variant: 'destructive',
                title: t('messages.error'),
                description: t('messages.checkoutFailed') + ': ' + normalizedError.message,
            })
        } finally {
            setIsLoading(false)
        }
    }





    return (
        <div className="h-full flex flex-col lg:flex-row gap-4 overflow-hidden lg:m-0">
            {isLayoutMobile ? (
                <div className="flex-1 flex flex-col bg-background relative overflow-hidden">
                    <MobileHeader
                        mobileView={mobileView}
                        setMobileView={setMobileView}
                        totalItems={totalItems}
                        storages={posStorages}
                        selectedStorageId={selectedStorageId}
                        setSelectedStorageId={handleStorageSelect}
                        refreshExchangeRate={refreshExchangeRate}
                        exchangeData={exchangeData}
                        heldSalesCount={heldSales.length}
                        onOpenHeldSales={() => setIsHeldSalesModalOpen(true)}
                        t={t}
                        toast={toast}
                        showExchangeTicker={!isActivitiesStorage && showExchangeTicker}
                        setShowExchangeTicker={setShowExchangeTicker}
                        showExchangeTools={!isActivitiesStorage}
                    />
                    <div className={cn(
                        "flex-1 relative no-scrollbar",
                        mobileView === 'grid' ? "overflow-y-auto" : "overflow-hidden"
                    )}>
                        {!isActivitiesStorage && showExchangeTicker && (
                            <div
                                className="cursor-pointer active:bg-primary/5 transition-colors border-b border-border/50 bg-background"
                                onClick={() => setShowExchangeTicker(false)}
                            >
                                <ExchangeTicker
                                    exchangeData={exchangeData}
                                    eurRates={eurRates}
                                    tryRates={tryRates}
                                    status={status}
                                    currencyStatus={currencyStatus}
                                    features={features}
                                    t={t}
                                />
                            </div>
                        )}
                        {mobileView === 'grid' ? (
                            <MobileGrid
                                t={t}
                                search={search}
                                setSearch={setSearch}
                                setIsSkuModalOpen={setIsSkuModalOpen}
                                setIsBarcodeModalOpen={setIsBarcodeModalOpen}
                                isDeviceScannerAutoEnabled={isDeviceScannerAutoEnabled}
                                filteredProducts={filteredProducts}
                                cart={cart}
                                addToCart={addToCart}
                                updateQuantity={updateQuantity}
                                features={features}
                                getDisplayImageUrl={getDisplayImageUrl}
                                categories={isActivitiesStorage ? [] : categories}
                                selectedCategory={selectedCategory}
                                setSelectedCategory={setSelectedCategory}
                                activeDiscountMap={activeDiscountMap}
                                tutorialProductId={demoTutorial.state?.productId}
                            />
                        ) : (
                            <MobileCart
                                cart={cart}
                                removeFromCart={removeFromCart}
                                updateQuantity={updateQuantity}
                                features={features}
                                totalAmount={totalAmount}
                                settlementCurrency={settlementCurrency}
                                paymentType={paymentType}
                                setPaymentType={setPaymentType}
                                isTutorialPosTask={isTutorialPosTask}
                                tutorialProductId={demoTutorial.state?.productId}
                                digitalProvider={digitalProvider}
                                setDigitalProvider={setDigitalProvider}
                                handleCheckout={handleCheckout}
                                handleHoldSale={handleHoldSale}
                                isLoading={isLoading}
                                getDisplayImageUrl={getDisplayImageUrl}
                                products={sellableProducts}
                                convertPrice={convertPrice}
                                openPriceEdit={openPriceEdit}
                                isAdmin={isAdmin}
                                clearNegotiatedPrice={clearNegotiatedPrice}
                                discountValue={discountValue}
                                setDiscountValue={setDiscountValue}
                                discountType={discountType}
                                setDiscountType={setDiscountType}
                                hasTrulyMissingRates={hasTrulyMissingRates}
                                hasLoadingRates={hasLoadingRates}
                                t={t}
                                setDynamicUnitModal={setDynamicUnitModal}
                                setExactQuantity={setExactQuantity}
                                isActivitiesStorage={isActivitiesStorage}
                            />
                        )}
                    </div>
                </div>
            ) : (
                <>
                    {/* Desktop ... (rest of existing code) */}
                    {/* Products Grid */}
                    <div className="flex-1 flex flex-col gap-4">
                        <div className="flex items-center gap-4 bg-card p-4 rounded-xl border border-border shadow-sm">
                            <StorageSelector
                                storages={posStorages}
                                selectedStorageId={selectedStorageId}
                                onSelect={handleStorageSelect}
                            />

                            <UiAccessGate>
                                <div className="flex items-center gap-2 animate-in fade-in zoom-in duration-300">
                                    <Select
                                        value={productsPerRow.toString()}
                                        onValueChange={(val) => setProductsPerRow(parseInt(val, 10))}
                                    >
                                        <SelectTrigger className="h-12 w-[140px] rounded-xl border-dashed border-primary/50 bg-primary/5 font-bold">
                                            <div className="flex items-center gap-2">
                                                <Menu className="w-4 h-4 text-primary" />
                                                <SelectValue placeholder="Columns" />
                                            </div>
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="2">2 Columns</SelectItem>
                                            <SelectItem value="3">3 Columns</SelectItem>
                                            <SelectItem value="4">4 Columns</SelectItem>
                                            <SelectItem value="5">5 Columns</SelectItem>
                                            <SelectItem value="6">6 Columns</SelectItem>
                                            <SelectItem value="7">7 Columns</SelectItem>
                                            <SelectItem value="8">8 Columns</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </UiAccessGate>
                            <div className="relative flex-1">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                <Input
                                    placeholder={t('pos.searchPlaceholder') || "Search products..."}
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    ref={searchInputRef}
                                    className="pl-10 h-12 text-lg"
                                    tabIndex={isPosKeyboardSelectionEnabled ? -1 : 0}
                                />
                            </div>
                            <div className="flex gap-2">
                                <Button
                                    variant="outline"
                                    className="h-12 w-12 rounded-xl relative overflow-hidden"
                                    onClick={() => setIsSkuModalOpen(true)}
                                    title="Scan SKU (Hotkey: P)"
                                    tabIndex={isPosKeyboardSelectionEnabled ? -1 : 0}
                                >
                                    <Barcode className="w-5 h-5" />
                                </Button>
                                <Button
                                    variant="outline"
                                    className="h-12 px-4 rounded-xl relative flex items-center gap-2"
                                    onClick={() => setIsBarcodeModalOpen(true)}
                                    title="Barcode Scanner (Hotkey: K)"
                                    tabIndex={isPosKeyboardSelectionEnabled ? -1 : 0}
                                >
                                    {isDeviceScannerAutoEnabled ? (
                                        <ScanBarcode className="w-5 h-5" />
                                    ) : (
                                        <Camera className="w-5 h-5" />
                                    )}
                                    <div className={`w-2.5 h-2.5 rounded-full ${isScannerAutoActive ? 'bg-emerald-500' : 'bg-red-500'} border border-background shadow-sm`} />
                                </Button>
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto pr-2">
                            <div
                                className="grid gap-4"
                                style={{
                                    gridTemplateColumns: isLayoutMobile
                                        ? undefined
                                        : `repeat(${productsPerRow}, minmax(0, 1fr))`
                                }}
                            >
                                {filteredProducts.map((product, index) => {
                                    const cartItem = cart.find((item) => getCartItemKey(item) === buildCartItemKey(product.id, product.storageId))
                                    const inCartQuantity = cartItem?.quantity || 0
                                    const isInfiniteActivity = product.isInfiniteActivity === true
                                    const remainingQuantity = isInfiniteActivity ? ACTIVITY_POS_QUANTITY_LIMIT : product.quantity - inCartQuantity
                                    const minStock = product.minStockLevel || 5
                                    const isLowStock = remainingQuantity <= minStock
                                    const isCriticalStock = remainingQuantity <= (minStock / 2)
                                    const activeDiscount = activeDiscountMap.get(product.id)
                                    const displayPrice = activeDiscount?.discountPrice ?? product.price

                                    return (
                                        <button
                                            key={product.id}
                                            ref={el => productRefs.current[index] = el}
                                            data-tour-id={demoTutorial.state?.productId === product.id ? 'tutorial-pos-product-card' : undefined}
                                            onClick={() => addToCart(product)}
                                            disabled={!isInfiniteActivity && remainingQuantity <= 0}
                                            className={cn(
                                                "group relative bg-card hover:bg-accent/5 rounded-[1.5rem] border border-border/50 p-4 transition-all duration-300 hover:shadow-2xl hover:shadow-primary/5 hover:-translate-y-1 flex flex-col gap-4 overflow-hidden text-left outline-none",
                                                product.hasBatches && "border-sky-300/70 bg-gradient-to-br from-sky-50/70 via-card to-card shadow-[0_10px_30px_rgba(14,165,233,0.08)] dark:border-sky-500/25 dark:from-sky-500/10",
                                                !isInfiniteActivity && remainingQuantity <= 0 ? 'opacity-60 cursor-not-allowed' : '',
                                                // Keyboard focus highlight (Electron only)
                                                (isPosKeyboardSelectionEnabled && focusedSection === 'grid' && focusedProductIndex === index) ? "ring-2 ring-primary ring-offset-2 ring-offset-background scale-[1.02] shadow-lg z-10 box-shadow-[0_0_0_2px_hsl(var(--primary))]" : ""
                                            )}
                                        >
                                            {/* Product Image Wrapper */}
                                            <div className="relative aspect-square rounded-2xl bg-muted/30 border border-border/20 overflow-hidden flex items-center justify-center">
                                                <ProductImage
                                                    url={product.imageUrl}
                                                    name={product.name}
                                                    getDisplayImageUrl={getDisplayImageUrl}
                                                    className="w-full h-full group-hover:scale-110"
                                                    fallbackIcon={<Zap className="w-10 h-10 opacity-10 text-muted-foreground group-hover:scale-110 transition-transform duration-500" />}
                                                />

                                                {/* POS Indicators (Cart & Stock) */}
                                                {inCartQuantity > 0 && (
                                                    <div className="absolute top-2 left-2 bg-emerald-500 text-white px-2.5 py-1.5 rounded-2xl text-[12px] font-black animate-pop-in border border-emerald-400 shadow-md z-10">
                                                        +{inCartQuantity}
                                                    </div>
                                                )}

                                                {!isInfiniteActivity && <div className={cn(
                                                    "absolute top-2 right-2 px-2.5 py-1.5 rounded-2xl text-[12px] font-black uppercase tracking-tighter shadow-md z-10",
                                                    remainingQuantity <= 0
                                                        ? "bg-destructive text-destructive-foreground"
                                                        : isLowStock
                                                            ? isCriticalStock
                                                                ? "bg-red-500 text-white shadow-[0_0_8px_rgba(239,68,68,0.4)]"
                                                                : "bg-amber-400 text-amber-950"
                                                            : "bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 backdrop-blur-md"
                                                )}>
                                                    {remainingQuantity} <span className="text-[10px] opacity-70 ml-0.5">{t(`products.units.${product.unit}`, product.unit).toUpperCase()}</span>
                                                </div>}

                                                {product.hasBatches && product.nextBatchQuantity !== null && (
                                                    <div className="absolute bottom-2 left-2 bg-sky-500/10 text-sky-700 dark:text-sky-300 border border-sky-500/20 backdrop-blur-md px-2.5 py-1.5 rounded-2xl text-[12px] font-black uppercase tracking-tighter shadow-md z-10">
                                                        {product.nextBatchQuantity} <span className="text-[10px] opacity-70 ml-0.5">{t(`products.units.${product.unit}`, product.unit).toUpperCase()}</span>
                                                    </div>
                                                )}

                                                {activeDiscount && (
                                                    <div className={cn(
                                                        "absolute left-2 rounded-2xl bg-emerald-500 px-2.5 py-1 text-[11px] font-black text-white shadow-md z-10",
                                                        product.hasBatches && product.nextBatchQuantity !== null ? "bottom-12" : "bottom-2"
                                                    )}>
                                                        {formatDiscountBadge(activeDiscount, product.currency, features.iqd_display_preference)}
                                                    </div>
                                                )}

                                                {product.hasBatches && product.nextBatchNumber && (
                                                    <div className={cn(
                                                        "absolute bottom-2 right-2 rounded-2xl px-2.5 py-1 text-[9px] font-black shadow-md z-10 backdrop-blur-md truncate",
                                                        getBatchExpiryStatus(product.nextBatchExpiryDate) === 'expired'
                                                            ? "bg-rose-500/90 text-white border border-rose-400/50"
                                                            : getBatchExpiryStatus(product.nextBatchExpiryDate) === 'soon'
                                                                ? "bg-amber-400/90 text-amber-950 border border-amber-300/50"
                                                                : "bg-background/80 text-sky-700 dark:text-sky-300 border border-border/50"
                                                    )}>
                                                        EXP {formatBatchExpiryDate(product.nextBatchExpiryDate)}
                                                    </div>
                                                )}
                                            </div>

                                            {/* Product Info */}
                                            <div className="flex-1 space-y-2 flex flex-col">
                                                <div className="flex items-center justify-between text-[10px] font-mono font-bold text-muted-foreground uppercase tracking-widest opacity-60 gap-2">
                                                    <span className="truncate">{product.sku}</span>
                                                    {product.hasBatches && product.nextBatchNumber && (
                                                        <span className="text-secondary-foreground/80 shrink-0">
                                                            BATCH {product.nextBatchNumber}
                                                        </span>
                                                    )}
                                                </div>
                                                <h3 className="font-bold text-foreground text-sm line-clamp-2 leading-snug group-hover:text-primary transition-colors">
                                                    {product.name}
                                                </h3>
                                            </div>

                                            {/* Pricing */}
                                            <div className="pt-2 border-t border-border/40">
                                                {activeDiscount ? (
                                                    <div className="space-y-0.5">
                                                        <div className="text-xs font-semibold text-muted-foreground line-through">
                                                            {formatCurrency(product.price, product.currency, features.iqd_display_preference)}
                                                        </div>
                                                        <div className="text-lg font-black text-emerald-600">
                                                            {formatCurrency(displayPrice, product.currency, features.iqd_display_preference)}
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div className="text-lg font-black text-primary">
                                                        {formatCurrency(product.price, product.currency, features.iqd_display_preference)}
                                                    </div>
                                                )}
                                            </div>
                                        </button>
                                    )
                                })}
                            </div>
                        </div>
                    </div>

                    {/* Cart Sidebar */}
                    <div
                        ref={sidebarRef}
                        data-tour-id="tutorial-pos-cart"
                        className={cn(
                            "bg-card border border-border rounded-xl flex flex-col shadow-xl relative",
                            isResizing ? "transition-none will-change-[width]" : "transition-all duration-300"
                        )}
                        style={{ width: isLayoutMobile ? '100%' : `${cartWidth}px` }}
                    >
                        {/* Resize Handle - Desktop Only */}
                        {!isLayoutMobile && (
                            <div
                                className={cn(
                                    "absolute top-0 bottom-0 w-2 cursor-col-resize z-[60] flex items-center justify-center group",
                                    isRTL ? "right-0 translate-x-1/2" : "left-0 -translate-x-1/2"
                                )}
                                onMouseDown={handleMouseDown}
                                onDoubleClick={() => setCartWidth(502)}
                                title={t('pos.resetWidth') || "Double click to reset width"}
                            >
                                <div className="w-0.5 h-8 rounded-full bg-border group-hover:bg-primary/50 transition-colors" />
                            </div>
                        )}
                        <div className="p-4 border-b border-border bg-muted/5">
                            <div className="flex items-center justify-between">
                                <h2 className="text-xl font-bold flex items-center gap-2">
                                    <ShoppingCart className="w-5 h-5" />
                                    {isAdmin && !isActivitiesStorage ? (
                                        <PressAndHoldButton
                                            variant="ghost"
                                            size="sm"
                                            onComplete={openCurrencyConversionSettings}
                                            idleLabel={t('pos.currentSale') || 'Current Sale'}
                                            holdingLabel={t('pos.openingCurrencySettings', 'Keep holding…')}
                                            loadingLabel={t('common.loading', 'Loading…')}
                                            showProgress={false}
                                            className="h-auto min-h-0 px-0 py-0 text-xl font-bold hover:bg-transparent hover:text-foreground"
                                        />
                                    ) : (
                                        <span>{t('pos.currentSale') || 'Current Sale'}</span>
                                    )}
                                </h2>
                                {heldSales.length > 0 && (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setIsHeldSalesModalOpen(true)}
                                        className="h-8 rounded-lg bg-primary/5 border-primary/20 text-primary font-bold flex items-center gap-2 hover:bg-primary/10 transition-all border-2"
                                    >
                                        <Archive className="w-3.5 h-3.5" />
                                        <span>{heldSales.length}</span>
                                    </Button>
                                )}
                            </div>
                            <div className="text-xs text-muted-foreground mt-1">
                                {totalItems} {totalItems === 1 ? t('common.item') : t('common.items')}
                            </div>
                        </div>

                        <div className="flex-1 min-h-0 relative flex flex-col">
                            {/* Scroll Indicators */}
                            {canScrollUp && (
                                <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 bg-background/80 backdrop-blur-sm p-1.5 rounded-full border border-border shadow-sm animate-bounce pointer-events-none">
                                    <ChevronUp className="w-4 h-4 text-primary" />
                                </div>
                            )}
                            {canScrollDown && (
                                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10 bg-background/80 backdrop-blur-sm p-1.5 rounded-full border border-border shadow-sm animate-bounce pointer-events-none">
                                    <ChevronDown className="w-4 h-4 text-primary" />
                                </div>
                            )}

                            <div className="flex-1 p-4 overflow-y-auto relative contents-container" ref={cartContainerRef}>
                                <div className="space-y-3">
                                    {cart.length === 0 ? (
                                        <div className="h-full flex flex-col items-center justify-center text-muted-foreground opacity-50 space-y-2 py-12">
                                            <ShoppingCart className="w-12 h-12" />
                                            <p>Cart is empty</p>
                                        </div>
                                    ) : (
                                        cart.map((item, index) => {
                                            const productCurrency = findStockProduct(item.product_id, item.storageId)?.currency || 'usd'
                                            const effectivePrice = getCartEffectivePrice(item)
                                            const basePrice = getCartBasePrice(item)
                                            const convertedPrice = convertPrice(effectivePrice, productCurrency, settlementCurrency)
                                            const isConverted = productCurrency !== settlementCurrency
                                            const hasNegotiated = item.negotiated_price !== undefined
                                            const hasDiscount = hasAutomaticDiscount(item)
                                            const itemKey = getCartItemKey(item)

                                            return (
                                                <div
                                                    key={itemKey}
                                                    ref={el => cartItemRefs.current[index] = el}
                                                    data-tour-id={demoTutorial.state?.productId === item.product_id ? 'tutorial-pos-cart-quantity' : undefined}
                                                    className={cn(
                                                        "bg-background border border-border p-3 rounded-lg flex gap-3 group transition-all duration-200 scroll-m-2",
                                                        (isPosKeyboardSelectionEnabled && focusedSection === 'cart' && focusedCartIndex === index) ? "ring-2 ring-primary ring-offset-2 ring-offset-background border-primary/50 shadow-md transform scale-[1.01]" : ""
                                                    )}
                                                >
                                                    {/* Product Image - Responsive Visibility */}
                                                    {cartWidth > CART_IMAGE_VISIBILITY_THRESHOLD && (
                                                        <div className="w-12 h-12 bg-muted/30 rounded-lg overflow-hidden shrink-0 border border-border/50 shadow-sm transition-all animate-in zoom-in-95 duration-300">
                                                            <ProductImage
                                                                url={item.imageUrl}
                                                                name={item.name}
                                                                getDisplayImageUrl={getDisplayImageUrl}
                                                                className="w-full h-full"
                                                                fallbackIcon={<Zap className="w-6 h-6 opacity-10" />}
                                                            />
                                                        </div>
                                                    )}

                                                    <div className="flex-1 min-w-0">
                                                        <div className="font-medium truncate">{item.name}</div>
                                                        <div className="flex flex-col gap-0.5">
                                                            {/* Show original price (grayed out if discounted or negotiated) */}
                                                            <div className={cn(
                                                                "text-xs",
                                                                hasNegotiated || hasDiscount ? "text-muted-foreground/50 line-through" : "text-muted-foreground"
                                                            )}>
                                                                {formatCurrency(item.price, productCurrency, features.iqd_display_preference)} x {item.quantity} {t(`products.units.${item.unit}`, { defaultValue: item.unit ?? '' }).toUpperCase()}
                                                            </div>
                                                            {(hasDiscount || hasNegotiated) && (
                                                                <div className="text-xs text-emerald-600 font-medium flex items-center gap-1">
                                                                    <span>{formatCurrency(effectivePrice, productCurrency, features.iqd_display_preference)} x {item.quantity} {t(`products.units.${item.unit}`, { defaultValue: item.unit ?? '' }).toUpperCase()}</span>
                                                                    {isAdmin && (
                                                                        <button
                                                                            onClick={() => clearNegotiatedPrice(item)}
                                                                            className="text-[10px] text-destructive hover:underline"
                                                                            title={t('pos.clearNegotiatedPrice') || 'Clear'}
                                                                        >
                                                                            ✕
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            )}
                                                            {isConverted && (
                                                                <div className="text-[10px] text-primary/60 font-medium">
                                                                    ≈ {formatCurrency(convertedPrice, settlementCurrency, features.iqd_display_preference)} {t('common.each')}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <div className="flex flex-col items-end gap-1">
                                                        <div className="font-bold flex items-center gap-1">
                                                            <span>{formatCurrency(convertedPrice * item.quantity, settlementCurrency, features.iqd_display_preference)}</span>
                                                            {/* Admin-only Pencil icon */}
                                                            {!isModifyPriceHidden && (
                                                                <button
                                                                    onClick={() => openPriceEdit(item)}
                                                                    className="transition-opacity p-1 hover:bg-muted rounded bg-muted/30 border border-border/50"
                                                                    title={t('pos.modifyPrice') || 'Modify Price'}
                                                                >
                                                                    <Pencil className="w-3.5 h-3.5 text-primary" />
                                                                </button>
                                                            )}
                                                            {isDynamicUnit(item.unit) && (
                                                                <button
                                                                    onClick={() => setDynamicUnitModal({ type: item.unit as 'm²' | 'Kg', itemKey })}
                                                                    className="transition-opacity p-1 hover:bg-muted rounded bg-muted/30 border border-border/50"
                                                                    title={item.unit === 'm²' ? (t('pos.adjustM2') || 'Adjust m²') : (t('pos.adjustKg') || 'Adjust Kg')}
                                                                >
                                                                    {item.unit === 'm²' ? <Ruler className="w-3.5 h-3.5 text-primary" /> : <Scale className="w-3.5 h-3.5 text-primary" />}
                                                                </button>
                                                            )}
                                                        </div>
                                                        {isConverted && !hasNegotiated && (
                                                            <span className={cn(
                                                                "text-[10px] text-muted-foreground",
                                                                !hasDiscount && "line-through opacity-50"
                                                            )}>
                                                                {formatCurrency(basePrice * item.quantity, productCurrency, features.iqd_display_preference)}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="flex items-center gap-1">
                                                        {isDynamicUnit(item.unit) ? (
                                                            <>
                                                                <div className="flex items-center gap-1 bg-muted/30 rounded-md border border-border/50 px-1.5">
                                                                    <Input
                                                                        type="text"
                                                                        inputMode="decimal"
                                                                        value={dynamicInputBuffer[itemKey] ?? String(item.quantity)}
                                                                        onChange={(e) => {
                                                                            const raw = e.target.value
                                                                            setDynamicInputBuffer((prev) => ({ ...prev, [itemKey]: raw }))
                                                                            const parsed = parseFloat(raw)
                                                                            if (!isNaN(parsed) && parsed >= 0) {
                                                                                setExactQuantity(itemKey, parsed)
                                                                            }
                                                                        }}
                                                                        onBlur={() => setDynamicInputBuffer((prev) => {
                                                                            const { [itemKey]: _, ...rest } = prev
                                                                            return rest
                                                                        })}
                                                                        className="h-7 w-14 text-xs text-center border-0 bg-transparent p-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                                                    />
                                                                    <span className="text-[8px] font-bold opacity-50 uppercase tracking-tighter">{t(`products.units.${item.unit}`, { defaultValue: item.unit ?? '' })}</span>
                                                                </div>
                                                                <Button
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    className="h-7 w-7 rounded-md text-destructive transition-opacity ml-1 bg-destructive/10 border border-destructive/20"
                                                                    onClick={() => removeFromCart(itemKey)}
                                                                >
                                                                    <Trash2 className="w-3.5 h-3.5" />
                                                                </Button>
                                                            </>
                                                        ) : (
                                                            <>
                                                                <Button
                                                                    variant="outline"
                                                                    size="icon"
                                                                    className="h-6 w-6 rounded-md"
                                                                    onClick={() => updateQuantity(itemKey, -1)}
                                                                >
                                                                    <Minus className="w-3 h-3" />
                                                                </Button>
                                                                <span className="flex flex-col items-center justify-center min-w-[2.5rem] leading-none py-1">
                                                                    <span className="text-sm font-black">{item.quantity}</span>
                                                                    <span className="text-[8px] font-bold opacity-50 uppercase tracking-tighter">{t(`products.units.${item.unit}`, { defaultValue: item.unit ?? '' })}</span>
                                                                </span>
                                                                <Button
                                                                    variant="outline"
                                                                    size="icon"
                                                                    className="h-6 w-6 rounded-md"
                                                                    onClick={() => updateQuantity(itemKey, 1)}
                                                                    disabled={item.quantity >= item.max_stock}
                                                                >
                                                                    <Plus className="w-3 h-3" />
                                                                </Button>
                                                                <Button
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    className="h-7 w-7 rounded-md text-destructive transition-opacity ml-1 bg-destructive/10 border border-destructive/20"
                                                                    onClick={() => removeFromCart(itemKey)}
                                                                >
                                                                    <Trash2 className="w-3.5 h-3.5" />
                                                                </Button>
                                                            </>
                                                        )}
                                                    </div>
                                                </div>
                                            )
                                        })
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="p-4 border-t border-border bg-muted/10 space-y-3">
                            {/* Exchange Rate Info */}
                            {/* Exchange Rate Info */}
                            {!isActivitiesStorage && (exchangeData || (features.allowed_currencies.includes('eur') && eurRates.eur_iqd)) && (
                                <div
                                    className="bg-primary/5 rounded-lg border border-primary/10 overflow-hidden cursor-pointer transition-all hover:bg-primary/[0.07] active:scale-[0.98]"
                                    onClick={() => setShowExchangeTicker(!showExchangeTicker)}
                                >
                                    {showExchangeTicker ? (
                                        <ExchangeTicker
                                            exchangeData={exchangeData}
                                            eurRates={eurRates}
                                            tryRates={tryRates}
                                            status={status}
                                            currencyStatus={currencyStatus}
                                            features={features}
                                            t={t}
                                        />
                                    ) : (
                                        <div className="p-2.5 space-y-2">
                                            {/* USD Rate */}
                                            {exchangeData && (
                                                <div className="flex justify-between items-center text-[11px]">
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-bold text-primary/80 uppercase">USD/IQD</span>
                                                        <span className="opacity-50 text-[10px] uppercase">{exchangeData.source}</span>
                                                        {currencyStatus.usd === 'loading' && (
                                                            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" title="Refreshing..." />
                                                        )}
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <span className="opacity-60">100 USD =</span>
                                                        <span className={cn("font-bold", status === 'error' && !exchangeData ? "text-destructive" : "text-primary")}>
                                                            {status === 'error' && !exchangeData ? t('common.offline') || 'Offline' : formatCurrency(exchangeData.rate, 'iqd', features.iqd_display_preference)}
                                                        </span>
                                                    </div>
                                                </div>
                                            )}

                                            {/* EUR Rate (Conditional) */}
                                            {features.allowed_currencies.includes('eur') && eurRates.eur_iqd && (
                                                <div className={cn(
                                                    "flex justify-between items-center text-[11px]",
                                                    exchangeData && "pt-1.5 border-t border-primary/5"
                                                )}>
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-bold text-primary/80 uppercase">EUR/IQD</span>
                                                        <span className="opacity-50 text-[10px] uppercase leading-none">{eurRates.eur_iqd.source}</span>
                                                        {currencyStatus.eur === 'loading' && (
                                                            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" title="Refreshing..." />
                                                        )}
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <span className="opacity-60">100 EUR =</span>
                                                        <span className={cn("font-bold", status === 'error' && !eurRates.eur_iqd ? "text-destructive" : "text-primary")}>
                                                            {status === 'error' && !eurRates.eur_iqd ? t('common.offline') || 'Offline' : formatCurrency(eurRates.eur_iqd.rate, 'iqd', features.iqd_display_preference)}
                                                        </span>
                                                    </div>
                                                </div>
                                            )}

                                            {/* TRY Rate (Conditional) */}
                                            {features.allowed_currencies.includes('try') && tryRates.try_iqd && (
                                                <div className={cn(
                                                    "flex justify-between items-center text-[11px]",
                                                    (exchangeData || (features.allowed_currencies.includes('eur') && eurRates.eur_iqd)) && "pt-1.5 border-t border-primary/5"
                                                )}>
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-bold text-primary/80 uppercase">TRY/IQD</span>
                                                        <span className="opacity-50 text-[10px] uppercase leading-none">{tryRates.try_iqd.source}</span>
                                                        {currencyStatus.try === 'loading' && (
                                                            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" title="Refreshing..." />
                                                        )}
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <span className="opacity-60">1000 TRY =</span>
                                                        <span className={cn("font-bold", status === 'error' && !tryRates.try_iqd ? "text-destructive" : "text-primary")}>
                                                            {status === 'error' && !tryRates.try_iqd ? t('common.offline') || 'Offline' : formatCurrency(tryRates.try_iqd.rate, 'iqd', features.iqd_display_preference)}
                                                        </span>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Total Discount Input 1:1 Design */}
                            <div className="flex items-center gap-2 bg-white dark:bg-black/20 p-1 rounded-xl border border-border/80 shadow-sm transition-all hover:border-primary/30">
                                <div className="flex-1 relative">
                                    <Input
                                        type="number"
                                        value={discountValue}
                                        onChange={(e) => setDiscountValue(e.target.value)}
                                        onFocus={(e) => e.target.select()}
                                        className="h-8 bg-transparent border-none shadow-none focus-visible:ring-0 text-xs font-medium placeholder:text-muted-foreground/60 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                        placeholder={t('pos.totalDiscount') || 'Total Discount'}
                                    />
                                </div>
                                <div className="flex bg-muted/40 dark:bg-white/5 p-1 rounded-lg gap-1 border border-border/10">
                                    <button
                                        onClick={() => setDiscountType('percent')}
                                        className={cn(
                                            "w-9 h-7 rounded-md flex items-center justify-center text-xs font-bold transition-all duration-200",
                                            discountType === 'percent'
                                                ? "bg-white text-slate-900 shadow-sm ring-1 ring-black/5"
                                                : "text-muted-foreground/50 hover:text-muted-foreground"
                                        )}
                                    >
                                        %
                                    </button>
                                    <button
                                        onClick={() => setDiscountType('amount')}
                                        className={cn(
                                            "w-9 h-7 rounded-md flex items-center justify-center text-xs font-bold transition-all duration-200",
                                            discountType === 'amount'
                                                ? "bg-white text-slate-900 shadow-sm ring-1 ring-black/5"
                                                : "text-muted-foreground/50 hover:text-muted-foreground"
                                        )}
                                    >
                                        $
                                    </button>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <span className="text-muted-foreground text-sm">{t('pos.subtotal')}</span>
                                    <span className="font-semibold">
                                        {formatCurrency(totalAmount, settlementCurrency, features.iqd_display_preference)}
                                    </span>
                                </div>
                                <div className="flex items-center justify-between text-xl font-bold text-primary pt-1 border-t border-border/50">
                                    <span>{t('pos.total')}</span>
                                    <div className="flex flex-col items-end leading-tight">
                                        <div className="flex items-center gap-2">
                                            {originalSubtotal > totalAmount && (
                                                <span className="text-sm font-normal text-muted-foreground line-through opacity-50">
                                                    {formatCurrency(originalSubtotal, settlementCurrency, features.iqd_display_preference)}
                                                </span>
                                            )}
                                            <span>{formatCurrency(totalAmount, settlementCurrency, features.iqd_display_preference)}</span>
                                        </div>
                                        <span className="text-[10px] uppercase opacity-50 tracking-tighter">{settlementCurrency}</span>
                                    </div>
                                </div>
                            </div>

                            {/* Payment Method Toggle */}
                            <div className="space-y-2" data-tour-id="tutorial-pos-payment-area">
                                <div className="flex items-center justify-between">
                                    <span className="text-xs text-muted-foreground font-medium">{t('pos.paymentMethod') || 'Payment Method'}</span>
                                    <div className="flex bg-muted rounded-lg p-0.5 gap-0.5">
                                        <button
                                            data-tour-id="tutorial-pos-payment-cash"
                                            onClick={() => setPaymentType('cash')}
                                            className={cn(
                                                "px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 border transition-all",
                                                paymentType === 'cash'
                                                    ? "bg-emerald-100 text-emerald-900 shadow-sm border-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-300 dark:border-emerald-800"
                                                    : "bg-emerald-50/30 text-emerald-700 border-emerald-100/30 hover:bg-emerald-100/50 dark:bg-emerald-500/5 dark:text-emerald-400 dark:border-emerald-500/10 dark:hover:bg-emerald-500/10"
                                            )}
                                        >
                                            <Banknote className={cn("w-3 h-3 transition-colors", paymentType === 'cash' ? "text-emerald-600 dark:text-emerald-400" : "text-emerald-600/80")} />
                                            {t('pos.cash') || 'Cash'}
                                        </button>
                                        <button
                                            data-tour-id="tutorial-pos-payment-digital"
                                            onClick={() => setPaymentType('digital')}
                                            className={cn(
                                                "px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 border transition-all",
                                                paymentType === 'digital'
                                                    ? "bg-blue-100 text-blue-900 shadow-sm border-blue-200 dark:bg-blue-900/40 dark:text-blue-300 dark:border-blue-800"
                                                    : "bg-blue-50/30 text-blue-700 border-blue-100/30 hover:bg-blue-100/50 dark:bg-blue-500/5 dark:text-blue-400 dark:border-blue-500/10 dark:hover:bg-blue-500/10"
                                            )}
                                        >
                                            <Zap className={cn("w-3 h-3 transition-colors", paymentType === 'digital' ? "text-blue-600 dark:text-blue-400" : "text-blue-600/80")} />
                                            {t('pos.digital') || 'Digital'}
                                        </button>
                                        {!isActivitiesStorage && <button
                                            data-tour-id="tutorial-pos-payment-loan"
                                            onClick={() => {
                                                if (!isTutorialPosTask) setPaymentType('loan')
                                            }}
                                            disabled={isTutorialPosTask}
                                            className={cn(
                                                "px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 border transition-all",
                                                isTutorialPosTask
                                                    ? "cursor-not-allowed border-border bg-muted text-muted-foreground opacity-80"
                                                    : paymentType === 'loan'
                                                    ? "bg-rose-100 text-rose-900 shadow-sm border-rose-200 dark:bg-rose-900/40 dark:text-rose-300 dark:border-rose-800"
                                                    : "bg-rose-50/30 text-rose-700 border-rose-100/30 hover:bg-rose-100/50 dark:bg-rose-500/5 dark:text-rose-400 dark:border-rose-500/10 dark:hover:bg-rose-500/10"
                                            )}
                                        >
                                            <Coins className={cn("w-3 h-3 transition-colors", isTutorialPosTask ? "text-muted-foreground" : paymentType === 'loan' ? "text-rose-600 dark:text-rose-400" : "text-rose-600/80")} />
                                            {t('pos.loan') || 'Loan'}
                                        </button>}
                                    </div>
                                </div>

                                {/* Digital Provider Sub-toggle */}
                                {paymentType === 'digital' && (
                                    <div className="flex justify-end" data-tour-id="tutorial-pos-digital-provider">
                                        <div className="flex bg-muted/50 rounded-lg p-0.5 gap-1">
                                            <button
                                                onClick={() => setDigitalProvider('fib')}
                                                className={cn(
                                                    "p-1.5 rounded-md transition-colors flex items-center gap-1",
                                                    digitalProvider === 'fib'
                                                        ? "bg-background shadow-sm ring-1 ring-primary/30"
                                                        : "hover:bg-background/50 opacity-60"
                                                )}
                                                title="FIB"
                                            >
                                                <img
                                                    src="./icons/fib.svg"
                                                    alt="FIB"
                                                    className="w-6 h-6 rounded"
                                                />
                                            </button>
                                            <button
                                                onClick={() => setDigitalProvider('qicard')}
                                                className={cn(
                                                    "p-1.5 rounded-md transition-colors flex items-center gap-1",
                                                    digitalProvider === 'qicard'
                                                        ? "bg-background shadow-sm ring-1 ring-primary/30"
                                                        : "hover:bg-background/50 opacity-60"
                                                )}
                                                title="QiCard"
                                            >
                                                <img
                                                    src="./icons/qi.svg"
                                                    alt="QiCard"
                                                    className="w-6 h-6 rounded"
                                                />
                                            </button>

                                            <button
                                                onClick={() => setDigitalProvider('zaincash')}
                                                className={cn(
                                                    "p-1.5 rounded-md transition-colors flex items-center gap-1",
                                                    digitalProvider === 'zaincash'
                                                        ? "bg-background shadow-sm ring-1 ring-primary/30"
                                                        : "hover:bg-background/50 opacity-60"
                                                )}
                                                title="ZainCash"
                                            >
                                                <img
                                                    src="./icons/zain.svg"
                                                    alt="ZainCash"
                                                    className="w-6 h-6 rounded"
                                                />
                                            </button>

                                            <button
                                                onClick={() => setDigitalProvider('fastpay')}
                                                className={cn(
                                                    "p-1.5 rounded-md transition-colors flex items-center gap-1",
                                                    digitalProvider === 'fastpay'
                                                        ? "bg-background shadow-sm ring-1 ring-primary/30"
                                                        : "hover:bg-background/50 opacity-60"
                                                )}
                                                title="FastPay"
                                            >
                                                <img
                                                    src="./icons/fastpay.svg"
                                                    alt="FastPay"
                                                    className="w-6 h-6 rounded"
                                                />
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {hasTrulyMissingRates ? (
                                <div className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-xl px-3 py-2 flex items-center gap-2 animate-in fade-in duration-300">
                                    <RefreshCw className="w-3.5 h-3.5 flex-shrink-0" />
                                    <span>Exchange rate unavailable for some currencies in cart. Set a manual rate or wait for live rates.</span>
                                </div>
                            ) : hasLoadingRates && (
                                <div className="text-xs text-amber-500 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2 flex items-center gap-2 animate-in fade-in duration-300">
                                    <RefreshCw className="w-3.5 h-3.5 flex-shrink-0 animate-spin" />
                                    <span>Refreshing exchange rates... You can still checkout.</span>
                                </div>
                            )}

                            <div className="flex gap-2">
                                <Button
                                    size="lg"
                                    data-tour-id="tutorial-pos-checkout"
                                    className="flex-[3] h-14 text-xl shadow-lg shadow-primary/20 rounded-2xl"
                                    onClick={() => handleCheckout()}
                                    disabled={cart.length === 0 || isLoading || hasTrulyMissingRates}
                                >
                                    {isLoading ? (
                                        <Loader2 className="w-6 h-6 animate-spin mr-2" />
                                    ) : (
                                        paymentType === 'digital' ? (
                                            <Zap className="w-6 h-6 mr-2" />
                                        ) : paymentType === 'loan' ? (
                                            <Coins className="w-6 h-6 mr-2" />
                                        ) : (
                                            <Banknote className="w-6 h-6 mr-2" />
                                        )
                                    )}
                                    {paymentType === 'digital'
                                        ? t('pos.digitalCheckout') || 'Digital Checkout'
                                        : paymentType === 'loan'
                                            ? t('pos.processLoan') || 'Process Loan'
                                            : t('pos.checkout') || 'Checkout'}
                                </Button>
                                <Button
                                    variant="outline"
                                    size="lg"
                                    className="w-14 h-14 rounded-2xl border-2 hover:bg-primary/5 hover:text-primary transition-all group flex-none px-0"
                                    onClick={handleHoldSale}
                                    disabled={cart.length === 0 || isLoading}
                                    title={t('pos.holdDescription', 'Put current sale on hold')}
                                >
                                    <Archive className="w-6 h-6 group-hover:scale-110 transition-transform" />
                                </Button>
                            </div>
                        </div>
                    </div>
                </>
            )
            }

            {/* --- Shared Modals (Available in both Mobile & Desktop) --- */}
            {isCameraScannerAutoEnabled && !isBarcodeModalOpen && (
                <div className="fixed left-2 top-2 h-2 w-2 opacity-0 pointer-events-none">
                    <CameraBarcodeScanner
                        selectedCameraId={selectedCameraId}
                        onCapture={(barcodes) => handleBarcodeDetected(barcodes, 'camera')}
                    />
                </div>
            )}
            {/* Barcode Scanner Modal */}
            <BarcodeScannerModal
                open={isBarcodeModalOpen}
                onOpenChange={setIsBarcodeModalOpen}
                isCameraScannerAutoEnabled={isCameraScannerAutoEnabled}
                setIsCameraScannerAutoEnabled={updateCameraScannerAutoEnabled}
                isDeviceScannerAutoEnabled={isDeviceScannerAutoEnabled}
                setIsDeviceScannerAutoEnabled={updateDeviceScannerAutoEnabled}
                handleBarcodeDetected={handleBarcodeDetected}
                selectedCameraId={selectedCameraId}
                setSelectedCameraId={setSelectedCameraId}
                scanDelay={scanDelay}
                setScanDelay={setScanDelay}
                cameras={cameras}
            />

            <Dialog
                open={isCurrencyConversionDialogOpen}
                onOpenChange={(open) => {
                    if (!isSavingCurrencyConversion) setIsCurrencyConversionDialogOpen(open)
                }}
            >
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>{t('pos.currencyConversionSettings', 'POS currency conversion')}</DialogTitle>
                        <DialogDescription>
                            {t('pos.currencyConversionSettingsDescription', 'This workspace-wide setting applies to every POS terminal. Only workspace admins can change it.')}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/30 p-4">
                        <div className="space-y-1">
                            <Label htmlFor="pos-convert-to-workspace-currency" className="font-semibold">
                                {t('pos.convertToWorkspaceCurrency', 'Convert to workspace currency')}
                            </Label>
                            <p className="text-xs text-muted-foreground">
                                {currencyConversionDraft
                                    ? t('pos.convertToWorkspaceCurrencyEnabledDescription', 'Apply exchange rates and record a rate snapshot for different-currency products.')
                                    : t('pos.convertToWorkspaceCurrencyDisabledDescription', 'Record POS sales in the product currency. Each sale can contain products in only one currency.')}
                            </p>
                        </div>
                        <Switch
                            id="pos-convert-to-workspace-currency"
                            checked={currencyConversionDraft}
                            disabled={isSavingCurrencyConversion}
                            onCheckedChange={setCurrencyConversionDraft}
                        />
                    </div>
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            disabled={isSavingCurrencyConversion}
                            onClick={() => setIsCurrencyConversionDialogOpen(false)}
                        >
                            {t('common.cancel')}
                        </Button>
                        <Button
                            type="button"
                            disabled={isSavingCurrencyConversion}
                            onClick={() => void saveCurrencyConversionSettings()}
                        >
                            {isSavingCurrencyConversion ? t('common.saving', 'Saving…') : t('common.save')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* SKU Modal */}
            <Dialog open={isSkuModalOpen} onOpenChange={setIsSkuModalOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t('pos.enterSku') || 'Enter SKU'}</DialogTitle>
                    </DialogHeader>
                    <form onSubmit={handleSkuSubmit} className="space-y-4">
                        <Input
                            ref={skuInputRef}
                            placeholder="Scan or type SKU..."
                            value={skuInput}
                            onChange={(e) => setSkuInput(e.target.value)}
                            className="text-lg py-6 font-mono"
                        />
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => setIsSkuModalOpen(false)}>
                                {t('common.cancel')}
                            </Button>
                            <Button type="submit">
                                {t('common.add')}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            {/* Negotiated Price Edit Dialog */}
            <Dialog open={editingPriceItemKey !== null} onOpenChange={() => cancelPriceEdit()}>
                <DialogContent className="max-w-sm">
                    <DialogHeader>
                        <DialogTitle>{t('pos.modifyPrice') || 'Modify Price'}</DialogTitle>
                    </DialogHeader>
                    {(() => {
                        const editingItem = cart.find((item) => getCartItemKey(item) === editingPriceItemKey)
                        const editingProduct = editingItem ? findStockProduct(editingItem.product_id, editingItem.storageId) : undefined
                        if (!editingItem) return null

                        return (
                            <div className="space-y-4">
                                {/* Product Name */}
                                <div className="text-sm font-medium text-center p-2 bg-muted/30 rounded">
                                    {editingItem.name}
                                </div>

                                {/* Original Price - Readonly */}
                                <div>
                                    <Label className="text-muted-foreground">{t('pos.originalPriceLabel') || 'Original Price'}</Label>
                                    <div className="text-lg font-mono font-bold mt-1 p-3 bg-muted/50 rounded border border-border">
                                        {formatCurrency(editingItem.price, editingProduct?.currency || 'usd', features.iqd_display_preference)}
                                    </div>
                                </div>

                                {/* Negotiated Price - Editable */}
                                <div>
                                    <Label>{t('pos.negotiatedPrice') || 'Negotiated Price'}</Label>
                                    <div className="relative mt-1">
                                        <Input
                                            type="text"
                                            inputMode="decimal"
                                            value={negotiatedPriceInput}
                                            onChange={(e) => {
                                                const raw = e.target.value.replace(/[^0-9.,]/g, '')
                                                setNegotiatedPriceInput(formatNumberWithCommas(raw))
                                            }}
                                            placeholder="0.00"
                                            className="text-lg py-5 font-mono pr-14"
                                            autoFocus
                                        />
                                        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold uppercase tracking-wider text-muted-foreground/60">
                                            {editingProduct?.currency === 'iqd' ? features.iqd_display_preference : editingProduct?.currency === 'usd' ? '$' : (editingProduct?.currency || '').toUpperCase()}
                                        </span>
                                    </div>
                                    {/* Live Conversion Display */}
                                    {editingProduct && editingProduct.currency !== features.default_currency && negotiatedPriceInput && !isNaN(parseFormattedNumber(negotiatedPriceInput)) && (
                                        <div className="mt-2 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 animate-in fade-in slide-in-from-top-1 duration-200">
                                            <div className="flex items-center justify-between">
                                                <span className="text-xs font-medium text-emerald-600/80 uppercase tracking-wider">
                                                    {t('pos.convertedValue') || 'Converted Value'}
                                                </span>
                                                <div className="flex items-center gap-1.5 text-xs text-emerald-600/70 font-mono">
                                                    <TrendingUp className="w-3 h-3" />
                                                    <span>1 {editingProduct.currency.toUpperCase()} = {formatCurrency(convertPrice(1, editingProduct.currency as any, features.default_currency as any), features.default_currency, features.iqd_display_preference)}</span>
                                                </div>
                                            </div>
                                            <div className="text-xl font-mono font-black text-emerald-500 mt-0.5">
                                                {formatCurrency(convertPrice(parseFormattedNumber(negotiatedPriceInput), editingProduct.currency as any, features.default_currency as any), features.default_currency, features.iqd_display_preference)}
                                            </div>
                                        </div>
                                    )}
                                    <p className="text-xs text-muted-foreground mt-1">
                                        {t('pos.originalPriceDesc') || 'Original price will be preserved in records.'}
                                    </p>
                                    {!isPriceBelowCostHidden && (() => {
                                        const parsedPrice = parseFormattedNumber(negotiatedPriceInput)
                                        const costPrice = editingProduct?.costPrice
                                        if (costPrice != null && costPrice > 0 && !isNaN(parsedPrice) && parsedPrice < costPrice) {
                                            return (
                                                <div className="mt-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 animate-in fade-in slide-in-from-top-1 duration-200">
                                                    <div className="flex items-center gap-2 text-red-600">
                                                        <span className="text-sm font-semibold">
                                                            {t('pos.priceBelowCost') || '⚠️ Price is below cost!'}
                                                        </span>
                                                    </div>
                                                    <div className="text-xs text-red-500/80 mt-0.5">
                                                        {formatCurrency(costPrice, editingProduct?.currency || 'usd', features.iqd_display_preference)}
                                                    </div>
                                                </div>
                                            )
                                        }
                                        return null
                                    })()}
                                </div>

                                <DialogFooter>
                                    <Button type="button" variant="outline" onClick={cancelPriceEdit}>
                                        {t('common.cancel')}
                                    </Button>
                                    <Button type="button" onClick={savePriceEdit}>
                                        {t('common.save')}
                                    </Button>
                                </DialogFooter>
                            </div>
                        )
                    })()}
                </DialogContent>
            </Dialog>

            {/* Dynamic Unit Slider Modal */}
            <Dialog open={dynamicUnitModal !== null} onOpenChange={(open) => { if (!open) setDynamicUnitModal(null) }}>
                <DialogContent className="max-w-sm">
                    {dynamicUnitModal && (() => {
                        const item = cart.find((i) => getCartItemKey(i) === dynamicUnitModal.itemKey)
                        const product = item ? findStockProduct(item.product_id, item.storageId) : undefined
                        if (!item) return null
                        const isM2 = dynamicUnitModal.type === 'm²'
                        const unitLabel = isM2 ? 'm²' : 'Kg'
                        const effectivePrice = getCartEffectivePrice(item)
                        const currency = (product?.currency || 'usd') as CurrencyCode
                        const sliderMax = item.max_stock || 1000
                        const sliderStep = 0.01

                        return (
                            <div className="space-y-6 py-4">
                                <DialogHeader>
                                    <DialogTitle className="flex items-center gap-2">
                                        {isM2 ? <Ruler className="w-5 h-5 text-primary" /> : <Scale className="w-5 h-5 text-primary" />}
                                        {isM2 ? (t('pos.adjustM2') || 'Adjust m²') : (t('pos.adjustKg') || 'Adjust Kg')}
                                    </DialogTitle>
                                </DialogHeader>

                                <div className="text-sm font-medium text-center p-3 bg-muted/30 rounded-lg">
                                    {item.name}
                                </div>

                                <div className="space-y-4">
                                    <div className="text-center">
                                        <span className="text-4xl font-black text-primary">{item.quantity}</span>
                                        <span className="text-lg font-bold text-muted-foreground ml-1">{unitLabel}</span>
                                    </div>

                                    <div className="px-1">
                                        <input
                                            type="range"
                                            min="0.01"
                                            max={sliderMax}
                                            step={sliderStep}
                                            value={Math.min(item.quantity, sliderMax)}
                                            onChange={(e) => {
                                                const val = parseFloat(e.target.value)
                                                if (!isNaN(val)) setExactQuantity(dynamicUnitModal.itemKey, val)
                                            }}
                                            className="w-full h-2 bg-muted rounded-full appearance-none cursor-pointer accent-primary [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-background"
                                        />
                                    </div>

                                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                                        <span>0.01 {unitLabel}</span>
                                        <span>{sliderMax} {unitLabel}</span>
                                    </div>

                                    <div className="text-center p-4 bg-primary/5 rounded-xl border border-primary/10">
                                        <div className="text-xs text-muted-foreground mb-1">{t('pos.total') || 'Total'}</div>
                                        <div className="text-2xl font-black text-primary">
                                            {formatCurrency(effectivePrice * item.quantity, currency, features.iqd_display_preference)}
                                        </div>
                                        <div className="text-xs text-muted-foreground mt-1">
                                            {formatCurrency(effectivePrice, currency, features.iqd_display_preference)} / {unitLabel}
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-2 bg-muted/30 rounded-lg p-2">
                                        <span className="text-xs text-muted-foreground">{t('pos.quantity') || 'Quantity'}:</span>
                                        <Input
                                            type="text"
                                            inputMode="decimal"
                                            value={dynamicInputBuffer[dynamicUnitModal.itemKey] ?? String(item.quantity)}
                                            onChange={(e) => {
                                                const raw = e.target.value
                                                setDynamicInputBuffer((prev) => ({ ...prev, [dynamicUnitModal.itemKey]: raw }))
                                                const parsed = parseFloat(raw)
                                                if (!isNaN(parsed) && parsed >= 0) {
                                                    setExactQuantity(dynamicUnitModal.itemKey, parsed)
                                                }
                                            }}
                                            onBlur={() => setDynamicInputBuffer((prev) => {
                                                const { [dynamicUnitModal.itemKey]: _, ...rest } = prev
                                                return rest
                                            })}
                                            className="h-8 w-20 text-xs text-center"
                                        />
                                        <span className="text-xs font-bold opacity-50 uppercase">{unitLabel}</span>
                                    </div>
                                </div>
                            </div>
                        )
                    })()}
                </DialogContent>
            </Dialog>

            <HeldSalesModal
                isOpen={isHeldSalesModalOpen}
                onOpenChange={setIsHeldSalesModalOpen}
                heldSales={heldSales}
                onRestore={handleRestoreSale}
                onDelete={handleDeleteHeldSale}
                iqdPreference={features.iqd_display_preference}
            />

            <LoanRegistrationModal
                isOpen={isLoanRegistrationModalOpen}
                onOpenChange={setIsLoanRegistrationModalOpen}
                workspaceId={user?.workspaceId ?? ''}
                settlementCurrency={settlementCurrency as CurrencyCode}
                principalAmount={totalAmount}
                isSubmitting={isLoading}
                onSubmit={(data) => handleCheckout(data)}
            />

            <CheckoutSuccessModal
                isOpen={isSuccessModalOpen}
                onClose={() => {
                    demoTutorial.completePosSuccessModal()
                    setIsSuccessModalOpen(false)
                    setCompletedSaleData(null)
                    setCompletedActivityCheckout(null)
                    // Reset POS focus if needed
                    if (isPosKeyboardSelectionEnabled) searchInputRef.current?.focus()
                }}
                saleData={completedSaleData}
                features={features}
                tutorialDisablePrint={isTutorialPosTask}
                receiptPdfBuilder={completedActivityCheckout ? buildActivityCheckoutReceiptPdf : undefined}
                onSaveNote={completedActivityCheckout ? saveCompletedActivityNote : undefined}
            />

            <SaveBorrowerAsPartnerDialog
                isOpen={posLoanSavePartnerData !== null && !isSuccessModalOpen}
                onOpenChange={(open) => { if (!open) setPosLoanSavePartnerData(null) }}
                workspaceId={user?.workspaceId ?? ''}
                data={posLoanSavePartnerData}
                onComplete={() => setPosLoanSavePartnerData(null)}
            />

            <CrossStorageWarningModal
                isOpen={!!crossStorageWarning}
                onOpenChange={(open: boolean) => !open && setCrossStorageWarning(null)}
                productName={crossStorageWarning?.product.name || ''}
                currentStorageName={posStorages.find(s => s.id === selectedStorageId)?.name || 'Current'}
                foundInStorageName={crossStorageWarning?.foundStorageName || 'Unknown'}
                onConfirm={() => {
                    if (crossStorageWarning) {
                        addToCart(crossStorageWarning.product)
                        setCrossStorageWarning(null)
                    }
                }}
            />
        </div>
    )
}

// --- Shared Components ---

const ExchangeTicker = ({
    exchangeData,
    eurRates,
    tryRates,
    status,
    currencyStatus,
    features,
    t
}: any) => {
    return (
        <div
            className="h-9 flex items-center bg-background/50 backdrop-blur-sm border-y border-primary/5 overflow-hidden"
            style={{ '--duration': '7s' } as React.CSSProperties}
        >
            <div className="flex animate-marquee whitespace-nowrap min-w-full items-center py-1">
                {[...Array(4)].map((_, groupIdx) => (
                    <div key={groupIdx} className="flex items-center">
                        {/* USD */}
                        {exchangeData && (
                            <div className="flex items-center gap-2 px-6">
                                <div className={cn(
                                    "w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]",
                                    currencyStatus?.usd === 'loading' && "animate-pulse"
                                )} />
                                <span className="text-[11px] font-bold text-primary/80 uppercase tracking-tight">USD/IQD:</span>
                                <span className="text-[11px] font-black text-primary">
                                    {status === 'error' && !exchangeData ? t('common.offline') || 'Offline' : formatCurrency(exchangeData.rate, 'iqd', features.iqd_display_preference)}
                                </span>
                            </div>
                        )}
                        {/* EUR */}
                        {features.allowed_currencies.includes('eur') && eurRates.eur_iqd && (
                            <div className="flex items-center gap-2 px-6 border-l border-primary/10">
                                <div className={cn(
                                    "w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]",
                                    currencyStatus?.eur === 'loading' && "animate-pulse"
                                )} />
                                <span className="text-[11px] font-bold text-primary/80 uppercase tracking-tight">EUR/IQD:</span>
                                <span className="text-[11px] font-black text-primary">
                                    {status === 'error' && !eurRates.eur_iqd ? t('common.offline') || 'Offline' : formatCurrency(eurRates.eur_iqd.rate, 'iqd', features.iqd_display_preference)}
                                </span>
                            </div>
                        )}
                        {/* TRY */}
                        {features.allowed_currencies.includes('try') && tryRates.try_iqd && (
                            <div className="flex items-center gap-2 px-6 border-l border-primary/10">
                                <div className={cn(
                                    "w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]",
                                    currencyStatus?.try === 'loading' && "animate-pulse"
                                )} />
                                <span className="text-[11px] font-bold text-primary/80 uppercase tracking-tight">TRY/IQD:</span>
                                <span className="text-[11px] font-black text-primary">
                                    {status === 'error' && !tryRates.try_iqd ? t('common.offline') || 'Offline' : formatCurrency(tryRates.try_iqd.rate, 'iqd', features.iqd_display_preference)}
                                </span>
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    )
}

interface ProductImageProps {
    url?: string
    name: string
    getDisplayImageUrl: (url?: string) => string
    className?: string
    fallbackIcon?: React.ReactNode
}

const ProductImage = ({ url, name, getDisplayImageUrl, className, fallbackIcon }: ProductImageProps) => {
    const [error, setError] = useState(false)
    const [isLoaded, setIsLoaded] = useState(false)

    // Reset state when URL changes
    useEffect(() => {
        setError(false)
        setIsLoaded(false)
    }, [url])

    if (!url) {
        return <div className={cn("flex items-center justify-center bg-muted/30", className)}>
            {fallbackIcon || <Zap className="w-10 h-10 opacity-10 text-muted-foreground" />}
        </div>
    }

    if (error) {
        return <div className={cn("flex flex-col items-center justify-center bg-muted/50 p-2 text-center gap-1", className)}>
            <Zap className="w-6 h-6 opacity-20 text-destructive" />
            <span className="text-[10px] font-bold text-destructive/60 line-clamp-2 leading-tight uppercase font-mono">{name}</span>
        </div>
    }

    return (
        <div className={cn("relative overflow-hidden transition-all ease-in-out", className)}>
            <img
                src={getDisplayImageUrl(url)}
                alt={name}
                loading="lazy"
                decoding="async"
                className={cn(
                    "object-cover transition-all w-full h-full",
                    isLoaded ? "opacity-100 scale-100 blur-0" : "opacity-0 scale-105 blur-sm"
                )}
                onLoad={() => setIsLoaded(true)}
                onError={() => setError(true)}
            />
            {!isLoaded && (
                <div className="absolute inset-0 flex items-center justify-center bg-muted/10 animate-pulse">
                    {fallbackIcon || <Zap className="w-6 h-6 opacity-5" />}
                </div>
            )}
        </div>
    )
}


// --- Mobile UI Components ---

interface MobileHeaderProps {
    mobileView: 'grid' | 'cart'
    setMobileView: (view: 'grid' | 'cart') => void
    totalItems: number
    storages: StorageSelectorOption[]
    selectedStorageId: string
    setSelectedStorageId: (storageId: string) => void
    refreshExchangeRate: () => void
    exchangeData: ExchangeRateResult | null
    heldSalesCount: number
    onOpenHeldSales: () => void
    t: any
    toast: any
    showExchangeTicker: boolean
    setShowExchangeTicker: (s: boolean) => void
    showExchangeTools: boolean
}

function MobileHeader({
    mobileView,
    setMobileView,
    totalItems,
    storages,
    selectedStorageId,
    setSelectedStorageId,
    refreshExchangeRate,
    exchangeData,
    heldSalesCount,
    onOpenHeldSales,
    t,
    toast,
    showExchangeTicker,
    setShowExchangeTicker,
    showExchangeTools
}: MobileHeaderProps) {
    return (
        <div className="lg:hidden sticky top-0 z-50">
            <div className="border-b border-border bg-card">
                <div className={cn(
                    "flex items-center justify-between px-2.5 min-[380px]:px-4 py-2.5 min-[380px]:py-3 gap-1",
                    "pt-[calc(0.625rem+var(--safe-area-top))] min-[380px]:pt-[calc(0.75rem+var(--safe-area-top))]"
                )}>
                    {/* Left Group */}
                    <div className="flex-1 flex items-center justify-start gap-1">
                        <button
                            className="p-2 rounded-xl hover:bg-secondary transition-colors shrink-0"
                            onClick={() => window.dispatchEvent(new CustomEvent('open-mobile-sidebar'))}
                        >
                            <Menu className="w-6 h-6 text-muted-foreground" />
                        </button>

                        <Dialog>
                            <DialogTrigger asChild>
                                <button className="p-2 rounded-xl hover:bg-secondary transition-colors cursor-pointer text-muted-foreground relative" title={t('storages.selectStorage') || "Select Storage"}>
                                    <Warehouse className="w-6 h-6" />
                                </button>
                            </DialogTrigger>
                            <DialogContent className="max-w-[calc(100vw-2rem)] rounded-2xl p-0 overflow-hidden border-border z-[60]">
                                <DialogHeader className="p-6 border-b bg-muted/5 items-start rtl:items-start text-start rtl:text-start">
                                    <DialogTitle className="flex items-center gap-2">
                                        <Warehouse className="w-5 h-5 text-primary" />
                                        {t('storages.selectStorage') || 'Select Storage'}
                                    </DialogTitle>
                                </DialogHeader>
                                <div className="p-4 space-y-2 max-h-[60vh] overflow-y-auto">
                                    {storages.map(storage => (
                                        <DialogClose asChild key={storage.id}>
                                            <button
                                                onClick={() => setSelectedStorageId(storage.id)}
                                                className={cn(
                                                    "w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left",
                                                    selectedStorageId === storage.id
                                                        ? "bg-primary/10 border-primary/30 text-primary"
                                                        : "bg-card border-border hover:bg-secondary/50"
                                                )}
                                            >
                                                <Warehouse className={cn("w-5 h-5", selectedStorageId === storage.id ? "text-primary" : "text-muted-foreground")} />
                                                <span className="font-medium flex-1 truncate">
                                                    {storage.isSystem ? (t(`storages.${storage.name.toLowerCase()}`) || storage.name) : storage.name}
                                                    {storage.isSystem && (
                                                        <span className="text-[10px] text-muted-foreground ml-2">({t('storages.system') || 'System'})</span>
                                                    )}
                                                </span>
                                                {selectedStorageId === storage.id && (
                                                    <Check className="w-4 h-4 text-primary shrink-0" />
                                                )}
                                            </button>
                                        </DialogClose>
                                    ))}
                                </div>
                            </DialogContent>
                        </Dialog>
                    </div>

                    <button
                        className="bg-secondary/80 backdrop-blur-md px-3 min-[380px]:px-5 py-2 min-[380px]:py-2.5 rounded-full flex items-center gap-1.5 min-[380px]:gap-2 shadow-sm border border-border/50 relative active:scale-95 transition-all shrink-0"
                        onClick={() => setMobileView(mobileView === 'grid' ? 'cart' : 'grid')}
                    >
                        <ShoppingCart className="w-5 h-5" />
                        <span className="font-bold text-sm tracking-tight hidden min-[380px]:inline">{mobileView === 'grid' ? 'Cart' : 'Catalog'}</span>
                        {totalItems > 0 && (
                            <span className="absolute -top-1.5 -right-1.5 bg-emerald-500 text-white text-[10px] w-5 h-5 flex items-center justify-center rounded-full border-2 border-background font-bold shadow-lg animate-in zoom-in">
                                {totalItems}
                            </span>
                        )}
                    </button>

                    {/* Actions Area - Right Group */}
                    <div className="flex-1 flex items-center justify-end gap-1">
                        {/* Held Sales Button (Mobile) */}
                        {heldSalesCount > 0 && (
                            <button
                                className="p-2 rounded-xl hover:bg-secondary transition-colors relative"
                                onClick={onOpenHeldSales}
                            >
                                <Archive className="w-5 h-5 text-primary" />
                                <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-primary rounded-full border border-background shadow-sm" />
                            </button>
                        )}

                        {/* Live Rate Modal (Mobile) */}
                        {showExchangeTools && <Dialog>
                            <DialogTrigger asChild>
                                <button className="p-2 rounded-xl hover:bg-secondary transition-colors cursor-pointer text-muted-foreground">
                                    <TrendingUp className="w-6 h-6" />
                                </button>
                            </DialogTrigger>
                            <DialogContent className="max-w-[calc(100vw-2rem)] rounded-2xl p-0 overflow-hidden border-emerald-500/20">

                                <DialogHeader className="p-6 border-b bg-emerald-500/5 items-start rtl:items-start text-start rtl:text-start">
                                    <DialogTitle className="flex items-center gap-2 text-emerald-600">
                                        <Coins className="w-5 h-5" />
                                        {t('common.exchangeRates')}
                                    </DialogTitle>
                                </DialogHeader>

                                <div className="p-2">
                                    <ExchangeRateList isMobile={true} />
                                </div>

                                <div className="p-4 bg-secondary/30 flex flex-col gap-2">
                                    <div className="flex gap-2 w-full">
                                        {!showExchangeTicker && (
                                            <Button
                                                variant="outline"
                                                className="flex-1 border-primary/20 text-primary hover:bg-primary/5 h-11 rounded-xl font-bold"
                                                onClick={() => setShowExchangeTicker(true)}
                                            >
                                                <TrendingUp className="w-4 h-4 mr-2" />
                                                {t('pos.showTicker') || 'Show Ticker'}
                                            </Button>
                                        )}
                                        {showExchangeTicker && <div className="flex-1" />}
                                        <Button
                                            className="flex-1 h-11 rounded-xl font-bold"
                                            onClick={() => {
                                                refreshExchangeRate();
                                                toast({
                                                    title: t('pos.ratesUpdated') || 'Rates Updated',
                                                    description: `USD/IQD: ${exchangeData?.rate || '...'}`,
                                                    duration: 2000
                                                });
                                            }}
                                        >
                                            <RefreshCw className="w-4 h-4 mr-2" />
                                            {t('common.refresh')}
                                        </Button>
                                    </div>
                                </div>
                            </DialogContent>
                        </Dialog>}
                    </div>
                </div>
            </div>
        </div>
    )
}

interface MobileGridProps {
    t: any
    search: string
    setSearch: (s: string) => void
    setIsSkuModalOpen: (o: boolean) => void
    setIsBarcodeModalOpen: (o: boolean) => void
    isDeviceScannerAutoEnabled: boolean
    filteredProducts: PosCatalogProduct[]
    cart: CartItem[]
    addToCart: (p: PosCatalogProduct) => void
    updateQuantity: (itemKey: string, d: number) => void
    features: WorkspaceFeatures
    getDisplayImageUrl: (url?: string) => string
    categories: Category[]
    selectedCategory: string
    setSelectedCategory: (id: string) => void
    activeDiscountMap: Map<string, ResolvedActiveDiscount>
    tutorialProductId?: string
}

function MobileGrid({ t, search, setSearch, setIsSkuModalOpen, setIsBarcodeModalOpen, isDeviceScannerAutoEnabled, filteredProducts, cart, addToCart, updateQuantity, features, getDisplayImageUrl, categories, selectedCategory, setSelectedCategory, activeDiscountMap, tutorialProductId }: MobileGridProps) {
    return (
        <div className="flex flex-col gap-4 animate-in fade-in slide-in-from-right-4 duration-300">
            {/* Search & Tool Bar */}
            <div className="flex items-center gap-2 p-4 pb-0">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                        placeholder={t('pos.searchPlaceholder') || "Search products..."}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="pl-10 h-12 rounded-2xl bg-muted/30 border-none shadow-inner text-base"
                    />
                </div>
                <Button
                    variant="outline"
                    size="icon"
                    className="h-12 w-12 rounded-2xl border-none bg-muted/30"
                    onClick={() => setIsSkuModalOpen(true)}
                    title="Enter SKU"
                >
                    <Barcode className="w-5 h-5 text-muted-foreground" />
                </Button>
                <Button
                    variant="outline"
                    size="icon"
                    className="h-12 w-12 rounded-2xl border-none bg-muted/30"
                    onClick={() => setIsBarcodeModalOpen(true)}
                >
                    {isDeviceScannerAutoEnabled ? (
                        <ScanBarcode className="w-5 h-5 text-muted-foreground" />
                    ) : (
                        <Camera className="w-5 h-5 text-muted-foreground" />
                    )}
                </Button>
            </div>

            {/* Categories */}
            <div className="flex gap-2 overflow-x-auto px-4 py-2 scrollbar-none no-scrollbar">
                <button
                    key="all"
                    onClick={() => setSelectedCategory('all')}
                    className={cn(
                        "whitespace-nowrap px-6 py-2.5 rounded-full text-sm font-bold transition-all",
                        selectedCategory === 'all' ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20" : "bg-card border border-border text-muted-foreground"
                    )}
                >
                    {t('common.all') || 'All Items'}
                </button>
                <button
                    key="none"
                    onClick={() => setSelectedCategory('none')}
                    className={cn(
                        "whitespace-nowrap px-6 py-2.5 rounded-full text-sm font-bold transition-all",
                        selectedCategory === 'none' ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20" : "bg-card border border-border text-muted-foreground"
                    )}
                >
                    {t('categories.noCategory') || 'No Category'}
                </button>
                {categories.map((cat) => (
                    <button
                        key={cat.id}
                        onClick={() => setSelectedCategory(cat.id)}
                        className={cn(
                            "whitespace-nowrap px-6 py-2.5 rounded-full text-sm font-bold transition-all",
                            selectedCategory === cat.id ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20" : "bg-card border border-border text-muted-foreground"
                        )}
                    >
                        {cat.name}
                    </button>
                ))}
            </div>

            {/* Products Grid */}
            <div className="grid grid-cols-2 gap-4 p-4 pt-0 pb-10">
                {filteredProducts.map((product) => {
                    const cartItem = cart.find((item) => buildCartItemKey(item.product_id, item.storageId) === buildCartItemKey(product.id, product.storageId))
                    const inCartQuantity = cartItem?.quantity || 0
                    const isInfiniteActivity = product.isInfiniteActivity === true
                    const remainingQuantity = isInfiniteActivity ? ACTIVITY_POS_QUANTITY_LIMIT : product.quantity - inCartQuantity
                    const minStock = product.minStockLevel || 5
                    const isLowStock = remainingQuantity <= minStock
                    const isCriticalStock = remainingQuantity <= (minStock / 2)
                    const activeDiscount = activeDiscountMap.get(product.id)
                    const displayPrice = activeDiscount?.discountPrice ?? product.price

                    return (
                        <div
                            key={product.id}
                            data-tour-id={tutorialProductId === product.id ? 'tutorial-pos-product-card' : undefined}
                            className={cn(
                                "bg-card rounded-[2rem] border border-border p-3 shadow-sm flex flex-col gap-3 group active:scale-[0.98] transition-all",
                                product.hasBatches && "border-sky-300/70 bg-gradient-to-br from-sky-50/70 via-card to-card shadow-[0_10px_30px_rgba(14,165,233,0.08)] dark:border-sky-500/25 dark:from-sky-500/10"
                            )}
                            onClick={(e) => {
                                if ((e.target as HTMLElement).closest('button')) return;
                                if (isInfiniteActivity || remainingQuantity > 0) addToCart(product);
                            }}
                        >
                            <div className="aspect-square bg-muted/30 rounded-[1.5rem] overflow-hidden relative">
                                <ProductImage
                                    url={product.imageUrl}
                                    name={product.name}
                                    getDisplayImageUrl={getDisplayImageUrl}
                                    className="w-full h-full"
                                    fallbackIcon={<Zap className="w-10 h-10 absolute inset-0 m-auto opacity-10" />}
                                />

                                {inCartQuantity > 0 && (
                                    <div className="absolute top-2 left-2 bg-emerald-500 text-white px-2 py-1 rounded-xl text-[10px] font-black animate-pop-in border border-emerald-400 shadow-sm z-10">
                                        +{inCartQuantity}
                                    </div>
                                )}

                                {/* Stock Badge */}
                                {!isInfiniteActivity && <div className={cn(
                                    "absolute top-2 right-2 backdrop-blur-md px-2.5 py-1 rounded-xl text-[10px] font-black border transition-colors duration-300",
                                    remainingQuantity <= 0
                                        ? "bg-destructive text-destructive-foreground border-destructive/20"
                                        : isLowStock
                                            ? isCriticalStock
                                                ? "bg-red-500 text-white border-red-400 shadow-[0_0_8px_rgba(239,68,68,0.4)]"
                                                : "bg-amber-400 text-amber-950 border-amber-300/50"
                                            : "bg-primary/20 text-primary border-primary/20"
                                )}>
                                    {remainingQuantity} <span className="text-[9px] opacity-70 ml-0.5">{t(`products.units.${product.unit}`, product.unit).toUpperCase()}</span>
                                </div>}

                                {product.hasBatches && product.nextBatchQuantity !== null && (
                                    <div className="absolute bottom-2 left-2 backdrop-blur-md px-2.5 py-1 rounded-xl text-[10px] font-black border border-sky-500/20 bg-sky-500/10 text-sky-700 dark:text-sky-300 transition-colors duration-300">
                                        {product.nextBatchQuantity} <span className="text-[9px] opacity-70 ml-0.5">{t(`products.units.${product.unit}`, product.unit).toUpperCase()}</span>
                                    </div>
                                )}

                                {activeDiscount && (
                                    <div className={cn(
                                        "absolute left-2 rounded-xl bg-emerald-500 px-2 py-1 text-[10px] font-black text-white shadow-sm z-10",
                                        product.hasBatches && product.nextBatchQuantity !== null ? "bottom-10" : "bottom-2"
                                    )}>
                                        {formatDiscountBadge(activeDiscount, product.currency, features.iqd_display_preference)}
                                    </div>
                                )}

                                {product.hasBatches && product.nextBatchNumber && (
                                    <div className={cn(
                                        "absolute bottom-2 right-2 rounded-xl px-2 py-1 text-[9px] font-black shadow-sm z-10 backdrop-blur-md truncate",
                                        getBatchExpiryStatus(product.nextBatchExpiryDate) === 'expired'
                                            ? "bg-rose-500/90 text-white border border-rose-400/50"
                                            : getBatchExpiryStatus(product.nextBatchExpiryDate) === 'soon'
                                                ? "bg-amber-400/90 text-amber-950 border border-amber-300/50"
                                                : "bg-background/80 text-sky-700 dark:text-sky-300 border border-border/50"
                                    )}>
                                        EXP {formatBatchExpiryDate(product.nextBatchExpiryDate)}
                                    </div>
                                )}

                                {!isInfiniteActivity && remainingQuantity <= 0 && (
                                    <div className="absolute inset-0 bg-background/60 backdrop-blur-[2px] flex items-center justify-center text-xs font-bold text-destructive">
                                        {t('pos.outOfStock') || 'Out of stock'}
                                    </div>
                                )}
                            </div>
                            <div className="flex flex-col gap-2 px-1">
                                <h3 className="font-bold text-sm line-clamp-1">{product.name}</h3>
                                {product.hasBatches && product.nextBatchNumber && (
                                    <div className="text-[10px] font-mono font-bold text-secondary-foreground/80 uppercase tracking-widest truncate -mt-1">
                                        BATCH {product.nextBatchNumber}
                                    </div>
                                )}
                                {activeDiscount ? (
                                    <div className="space-y-0.5">
                                        <div className="text-[11px] font-semibold text-muted-foreground line-through">
                                            {formatCurrency(product.price, product.currency, features.iqd_display_preference)}
                                        </div>
                                        <div className="font-black text-sm text-emerald-600">
                                            {formatCurrency(displayPrice, product.currency, features.iqd_display_preference)}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="text-primary font-black text-sm">
                                        {formatCurrency(product.price, product.currency, features.iqd_display_preference)}
                                    </div>
                                )}
                            </div>
                            <div
                                className="flex items-center justify-between bg-muted/30 rounded-2xl p-1 mt-auto"
                                onClick={(e) => e.stopPropagation()}
                            >
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 rounded-xl hover:bg-background"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        updateQuantity(buildCartItemKey(product.id, product.storageId), -1);
                                    }}
                                    disabled={!cartItem}
                                >
                                    <Minus className="w-3 h-3" />
                                </Button>
                                <span className="font-bold text-sm min-w-4 text-center">{cartItem?.quantity || 0}</span>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 rounded-xl hover:bg-background text-primary"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        addToCart(product);
                                    }}
                                    disabled={!isInfiniteActivity && remainingQuantity <= 0}
                                >
                                    <Plus className="w-3 h-3" />
                                </Button>
                            </div>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}

interface MobileCartProps {
    cart: CartItem[]
    removeFromCart: (itemKey: string) => void
    updateQuantity: (itemKey: string, d: number) => void
    features: WorkspaceFeatures
    totalAmount: number
    settlementCurrency: string
    paymentType: 'cash' | 'digital' | 'loan'
    setPaymentType: (t: 'cash' | 'digital' | 'loan') => void
    isTutorialPosTask: boolean
    tutorialProductId?: string
    digitalProvider: 'fib' | 'qicard' | 'zaincash' | 'fastpay'
    setDigitalProvider: (p: 'fib' | 'qicard' | 'zaincash' | 'fastpay') => void
    handleCheckout: (loanRegistrationData?: LoanRegistrationData) => void
    handleHoldSale: () => void
    isLoading: boolean
    getDisplayImageUrl: (url?: string) => string
    products: InventoryProduct[]
    convertPrice: (amount: number, from: CurrencyCode, to: CurrencyCode) => number
    openPriceEdit: (item: CartItem) => void
    clearNegotiatedPrice: (item: CartItem) => void
    isAdmin: boolean
    discountValue: string
    setDiscountValue: (val: string) => void
    discountType: 'percent' | 'amount'
    setDiscountType: (type: 'percent' | 'amount') => void
    hasTrulyMissingRates: boolean
    hasLoadingRates: boolean
    isActivitiesStorage: boolean
    t: any
    setDynamicUnitModal: (modal: { type: 'm²' | 'Kg'; itemKey: string } | null) => void
    setExactQuantity: (itemKey: string, quantity: number) => void
}

function MobileCart({
    cart, removeFromCart, updateQuantity, features, totalAmount,
    settlementCurrency, paymentType, setPaymentType, isTutorialPosTask, tutorialProductId, digitalProvider,
    setDigitalProvider, handleCheckout, handleHoldSale, isLoading,
    getDisplayImageUrl, products, convertPrice, openPriceEdit,
    clearNegotiatedPrice, isAdmin,
    discountValue, setDiscountValue, discountType, setDiscountType,
    hasTrulyMissingRates, hasLoadingRates, isActivitiesStorage, t,
    setDynamicUnitModal, setExactQuantity
}: MobileCartProps) {
    const [isExpanded, setIsExpanded] = useState(false)
    const [isDragging, setIsDragging] = useState(false)
    const [startY, setStartY] = useState<number | null>(null)
    const [currentY, setCurrentY] = useState(0)
    const [mobileInputBuffer, setMobileInputBuffer] = useState<Record<string, string>>({})
    const panelRef = useRef<HTMLDivElement>(null)
    const scrollContainerRef = useRef<HTMLDivElement>(null)
    const [canScrollUp, setCanScrollUp] = useState(false)
    const [canScrollDown, setCanScrollDown] = useState(false)

    const checkScroll = useCallback(() => {
        if (!scrollContainerRef.current) return
        const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current
        setCanScrollUp(scrollTop > 10)
        setCanScrollDown(scrollTop + clientHeight < scrollHeight - 10)
    }, [])

    useEffect(() => {
        const container = scrollContainerRef.current
        if (!container) return

        const handleScroll = () => checkScroll()
        container.addEventListener('scroll', handleScroll)

        const observer = new ResizeObserver(() => checkScroll())
        observer.observe(container)

        // Initial and on cart change
        checkScroll()

        return () => {
            container.removeEventListener('scroll', handleScroll)
            observer.disconnect()
        }
    }, [cart.length, checkScroll])

    const handleTouchStart = (e: React.TouchEvent) => {
        setStartY(e.touches[0].clientY)
        setIsDragging(true)
    }

    const handleTouchMove = (e: React.TouchEvent) => {
        if (startY === null) return
        const touchY = e.touches[0].clientY
        let deltaY = touchY - startY

        // Rubber-banding logic
        if (isExpanded) {
            // Dragging down is normal, dragging up rubber-bands
            if (deltaY < 0) deltaY = deltaY * 0.2
            setCurrentY(deltaY)
        } else {
            // Dragging up is normal, dragging down rubber-bands
            if (deltaY > 0) deltaY = deltaY * 0.2
            setCurrentY(deltaY)
        }
    }

    const handleTouchEnd = () => {
        // Snap threshold: 60px
        if (Math.abs(currentY) > 60) {
            if (isExpanded && currentY > 0) setIsExpanded(false)
            else if (!isExpanded && currentY < 0) setIsExpanded(true)
        }
        setIsDragging(false)
        setStartY(null)
        setCurrentY(0)
    }

    const collapsedHeight = 120
    // Derive progress (0 = collapsed, 1 = expanded)
    // We use a 100px "active zone" for the cross-fade
    const progress = isDragging
        ? Math.min(1, Math.max(0, isExpanded ? 1 - (currentY / 100) : (-currentY / 100)))
        : isExpanded ? 1 : 0

    return (
        <div className="flex flex-col h-full animate-in fade-in slide-in-from-left-4 duration-300 relative overflow-hidden overscroll-none">
            {/* Scroll Indicators (Mobile) */}
            {isExpanded && canScrollUp && (
                <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 bg-background/80 backdrop-blur-sm p-1.5 rounded-full border border-border shadow-sm animate-bounce pointer-events-none">
                    <ChevronUp className="w-4 h-4 text-primary" />
                </div>
            )}
            {isExpanded && canScrollDown && (
                <div className="absolute bottom-40 left-1/2 -translate-x-1/2 z-10 bg-background/80 backdrop-blur-sm p-1.5 rounded-full border border-border shadow-sm animate-bounce pointer-events-none">
                    <ChevronDown className="w-4 h-4 text-primary" />
                </div>
            )}

            <div
                ref={scrollContainerRef}
                data-tour-id="tutorial-pos-cart"
                className={cn(
                    "flex-1 overflow-y-auto p-4 space-y-4 transition-all duration-300 overscroll-contain relative",
                    "pb-40 text-sm" // Increased padding to clear the 120px fixed checkout bar
                )}
            >

                {cart.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 opacity-30 gap-4">
                        <ShoppingCart className="w-20 h-20" />
                        <p className="font-bold text-lg">{t('pos.emptyCart')}</p>
                    </div>
                ) : (
                    cart.map((item) => {
                        const product = products.find((candidate) => (
                            candidate.id === item.product_id
                            && (!item.storageId || candidate.storageId === item.storageId)
                        ))
                        const originalCurrency = (product?.currency || 'usd') as CurrencyCode
                        const settlementCurr = settlementCurrency as CurrencyCode
                        const unitPrice = getCartEffectivePrice(item)
                        const convertedUnitPrice = convertPrice(unitPrice, originalCurrency, settlementCurr)
                        const isExchanged = originalCurrency !== settlementCurr
                        const hasDiscount = hasAutomaticDiscount(item)
                        const itemKey = buildCartItemKey(item.product_id, item.storageId)

                        return (
                            <div
                                key={itemKey}
                                data-tour-id={tutorialProductId === item.product_id ? 'tutorial-pos-cart-quantity' : undefined}
                                className="flex gap-4 bg-card p-4 rounded-[2rem] border border-border shadow-sm group"
                            >
                                <div className="w-20 h-20 bg-muted/30 rounded-2xl overflow-hidden shrink-0">
                                    <ProductImage
                                        url={item.imageUrl}
                                        name={item.name}
                                        getDisplayImageUrl={getDisplayImageUrl}
                                        className="w-full h-full"
                                        fallbackIcon={<Zap className="w-8 h-8 opacity-10" />}
                                    />
                                </div>
                                <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
                                    <div className="flex justify-between items-start gap-2">
                                        <div className="flex flex-col min-w-0 flex-1">
                                            <div className="flex items-center justify-between gap-2">
                                                <h3 className="font-bold text-sm truncate flex-1">{item.name}</h3>
                                                <div className="text-primary font-black text-sm whitespace-nowrap flex items-center gap-1">
                                                    {formatCurrency(convertedUnitPrice * item.quantity, settlementCurr, features.iqd_display_preference)}
                                                    {isAdmin && (
                                                        <button
                                                            onClick={() => openPriceEdit(item)}
                                                            className="p-1.5 rounded-lg bg-primary/10 text-primary border border-primary/20 transition-colors"
                                                        >
                                                            <Pencil className="w-3.5 h-3.5" />
                                                        </button>
                                                    )}
                                                    {isDynamicUnit(item.unit) && (
                                                        <button
                                                            onClick={() => setDynamicUnitModal({ type: item.unit as 'm²' | 'Kg', itemKey })}
                                                            className="p-1.5 rounded-lg bg-primary/10 text-primary border border-primary/20 transition-colors"
                                                            title={item.unit === 'm²' ? (t('pos.adjustM2') || 'Adjust m²') : (t('pos.adjustKg') || 'Adjust Kg')}
                                                        >
                                                            {item.unit === 'm²' ? <Ruler className="w-3.5 h-3.5" /> : <Scale className="w-3.5 h-3.5" />}
                                                        </button>
                                                    )}
                                                </div>
                                            </div>

                                            <div className="text-[10px] space-y-0.5 mt-1">
                                                <div className={cn(
                                                    "text-muted-foreground transition-all duration-300",
                                                    item.negotiated_price !== undefined || hasDiscount ? "line-through opacity-50" : ""
                                                )}>
                                                    {formatCurrency(item.price, originalCurrency, features.iqd_display_preference)} x {item.quantity} {t(`products.units.${item.unit}`, item.unit).toUpperCase()}
                                                </div>

                                                {(item.negotiated_price !== undefined || hasDiscount) && (
                                                    <div className="text-emerald-500 font-bold flex items-center gap-1 animate-in slide-in-from-left-2 duration-300">
                                                        {formatCurrency(unitPrice, originalCurrency, features.iqd_display_preference)} x {item.quantity} {t(`products.units.${item.unit}`, item.unit).toUpperCase()}
                                                        <button
                                                            onClick={() => clearNegotiatedPrice(item)}
                                                            className="p-0.5 rounded-full hover:bg-destructive/10 text-destructive transition-colors"
                                                        >
                                                            <X className="w-2.5 h-2.5" />
                                                        </button>
                                                    </div>
                                                )}

                                                {isExchanged && (
                                                    <div className="text-primary/40 font-medium">
                                                        ≈ {formatCurrency(convertedUnitPrice, settlementCurr, features.iqd_display_preference)} each
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => removeFromCart(itemKey)}
                                            className="p-2 -me-1 bg-destructive/10 text-destructive border border-destructive/20 rounded-xl transition-colors shrink-0"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>

                                    <div className="flex justify-end mt-2">
                                        {isDynamicUnit(item.unit) ? (
                                            <div className="flex items-center gap-2 bg-muted/50 rounded-xl p-1.5 border border-border/50">
                                                <Input
                                                    type="text"
                                                    inputMode="decimal"
                                                    value={mobileInputBuffer[itemKey] ?? String(item.quantity)}
                                                    onChange={(e) => {
                                                        const raw = e.target.value
                                                        setMobileInputBuffer((prev) => ({ ...prev, [itemKey]: raw }))
                                                        const parsed = parseFloat(raw)
                                                        if (!isNaN(parsed) && parsed >= 0) {
                                                            setExactQuantity(itemKey, parsed)
                                                        }
                                                    }}
                                                    onBlur={() => setMobileInputBuffer((prev) => {
                                                        const { [itemKey]: _, ...rest } = prev
                                                        return rest
                                                    })}
                                                    className="h-8 w-16 text-xs text-center rounded-lg border-border/50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                                />
                                                <span className="text-[10px] font-bold opacity-50 uppercase tracking-tighter pr-1">{t(`products.units.${item.unit}`, item.unit)}</span>
                                            </div>
                                        ) : (
                                            <div className="flex items-center gap-3 bg-muted/50 rounded-xl p-0.5 border border-border/50 h-fit">
                                                <button onClick={() => updateQuantity(itemKey, -1)} className="p-1.5 hover:bg-background rounded-lg transition-colors">
                                                    <Minus className="w-3 h-3" />
                                                </button>
                                                <span className="flex flex-col items-center justify-center min-w-[2.5rem] leading-none py-1">
                                                    <span className="text-sm font-black">{item.quantity}</span>
                                                    <span className="text-[8px] font-bold opacity-50 uppercase tracking-tighter">{t(`products.units.${item.unit}`, item.unit)}</span>
                                                </span>
                                                <button onClick={() => updateQuantity(itemKey, 1)} className="p-1.5 hover:bg-background rounded-lg transition-colors text-primary">
                                                    <Plus className="w-3 h-3" />
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )
                    })
                )}
            </div>

            {/* Collapsible Bottom Panel */}
            <div
                ref={panelRef}
                className={cn(
                    "fixed bottom-0 left-0 right-0 bg-card border-t border-border shadow-[0_-10px_40px_rgba(0,0,0,0.1)] z-40 transition-all duration-500 ease-in-out px-6 pt-2 overscroll-none touch-none flex flex-col",
                    "h-[75vh]", // Constant height
                    isExpanded ? "rounded-t-[2.5rem]" : "rounded-t-[2rem]",
                    isDragging && "duration-0 transition-none will-change-transform"
                )}
                style={{
                    transform: isDragging
                        ? `translateY(calc(${isExpanded ? '0px' : `75vh - ${collapsedHeight}px`} + ${currentY}px))`
                        : isExpanded ? 'none' : `translateY(calc(75vh - ${collapsedHeight}px))`
                }}
            >

                {/* Drag Handle - Larger touch area */}
                <div
                    className="flex flex-col items-center gap-1.5 cursor-grab active:cursor-grabbing py-4 -mt-3 group touch-none"
                    onTouchStart={handleTouchStart}
                    onTouchMove={handleTouchMove}
                    onTouchEnd={handleTouchEnd}
                    onClick={() => setIsExpanded(!isExpanded)}
                >
                    <div className="w-12 h-1.5 bg-muted-foreground/20 rounded-full group-hover:bg-primary/30 transition-colors" />
                </div>

                {/* Collapsed/Header View - touch-none to prevent background scroll */}
                <div className="flex items-center justify-between py-2 touch-none">
                    <div className="flex flex-col cursor-pointer" onClick={() => setIsExpanded(true)}>
                        <div className="flex items-baseline gap-1.5">
                            <span className="text-2xl font-black text-primary">
                                {formatCurrency(totalAmount, settlementCurrency, features.iqd_display_preference)}
                            </span>
                            <span className="text-[10px] font-bold text-muted-foreground uppercase">{settlementCurrency}</span>
                        </div>
                        <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider -mt-1">
                            {cart.length} {cart.length === 1 ? t('common.item') : t('common.items')} • {t(`pos.${paymentType}`)}
                        </span>
                    </div>

                    <div
                        className="transition-opacity duration-300"
                        style={{
                            opacity: Math.max(0, 1 - progress * 2), // Fade out faster
                            pointerEvents: progress > 0.3 ? 'none' : 'auto'
                        }}
                    >
                        <Button
                            data-tour-id="tutorial-pos-checkout"
                            className="h-12 px-6 rounded-2xl font-black shadow-lg shadow-primary/20 active:scale-95 transition-all text-primary-foreground"
                            onClick={(e) => {
                                e.stopPropagation();
                                handleCheckout();
                            }}
                            disabled={cart.length === 0 || isLoading || hasTrulyMissingRates}
                        >
                            {isLoading ? <Loader2 className="animate-spin w-5 h-5" /> : (
                                <div className="flex items-center gap-2">
                                    {paymentType === 'digital' ? (
                                        <Zap className="w-5 h-5" />
                                    ) : paymentType === 'loan' ? (
                                        <Coins className="w-5 h-5" />
                                    ) : (
                                        <Banknote className="w-5 h-5" />
                                    )}
                                    <span>
                                        {paymentType === 'digital'
                                            ? t('pos.digitalCheckout') || 'Digital Checkout'
                                            : paymentType === 'loan'
                                                ? t('pos.processLoan') || 'Process Loan'
                                                : t('pos.checkout') || 'Checkout'}
                                    </span>
                                    <ChevronRight className="w-4 h-4" />
                                </div>
                            )}
                        </Button>
                    </div>
                </div>

                {/* Expanded Content View - Scrollable area */}
                <div
                    className={cn(
                        "flex-1 overflow-y-auto overscroll-contain touch-auto mt-4 transition-all duration-300",
                        !isDragging && !isExpanded && "pointer-events-none"
                    )}
                    style={{
                        opacity: progress,
                        transform: `translateY(${(1 - progress) * 20}px)` // Subtle slide up
                    }}
                >
                    <div className="space-y-6 pb-8">
                        {/* Payment Method Toggle */}
                        <div className="flex bg-muted p-1 rounded-2xl gap-1" data-tour-id="tutorial-pos-payment-area">
                            <button
                                data-tour-id="tutorial-pos-payment-cash"
                                onClick={() => setPaymentType('cash')}
                                className={cn(
                                    "flex-1 py-3.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all border",
                                    paymentType === 'cash'
                                        ? "bg-emerald-100 text-emerald-900 shadow-lg border-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-300 dark:border-emerald-800"
                                        : "bg-emerald-50/30 text-emerald-700 border-emerald-100/30 dark:bg-emerald-500/5 dark:text-emerald-400 dark:border-emerald-500/10"
                                )}
                            >
                                <Banknote className={cn("w-4 h-4 transition-colors", paymentType === 'cash' ? "text-emerald-600 dark:text-emerald-400" : "text-emerald-600/80")} /> {t('pos.cash') || 'Cash'}
                            </button>
                            <button
                                data-tour-id="tutorial-pos-payment-digital"
                                onClick={() => setPaymentType('digital')}
                                className={cn(
                                    "flex-1 py-3.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all border",
                                    paymentType === 'digital'
                                        ? "bg-blue-100 text-blue-900 shadow-lg border-blue-200 dark:bg-blue-900/40 dark:text-blue-300 dark:border-blue-800"
                                        : "bg-blue-50/30 text-blue-700 border-blue-100/30 dark:bg-blue-500/5 dark:text-blue-400 dark:border-blue-500/10"
                                )}
                            >
                                <Zap className={cn("w-4 h-4 transition-colors", paymentType === 'digital' ? "text-blue-600 dark:text-blue-400" : "text-blue-600/80")} /> {t('pos.digital') || 'Digital'}
                            </button>
                            {!isActivitiesStorage && <button
                                data-tour-id="tutorial-pos-payment-loan"
                                onClick={() => {
                                    if (!isTutorialPosTask) setPaymentType('loan')
                                }}
                                disabled={isTutorialPosTask}
                                className={cn(
                                    "flex-1 py-3.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all border",
                                    isTutorialPosTask
                                        ? "cursor-not-allowed border-border bg-muted text-muted-foreground opacity-80"
                                        : paymentType === 'loan'
                                        ? "bg-rose-100 text-rose-900 shadow-lg border-rose-200 dark:bg-rose-900/40 dark:text-rose-300 dark:border-rose-800"
                                        : "bg-rose-50/30 text-rose-700 border-rose-100/30 dark:bg-rose-500/5 dark:text-rose-400 dark:border-rose-500/10"
                                )}
                            >
                                <Coins className={cn("w-4 h-4 transition-colors", isTutorialPosTask ? "text-muted-foreground" : paymentType === 'loan' ? "text-rose-600 dark:text-rose-400" : "text-rose-600/80")} /> {t('pos.loan') || 'Loan'}
                            </button>}
                        </div>

                        {/* Digital Provider Sub-toggle */}
                        {paymentType === 'digital' && (
                            <div className="flex justify-center gap-3 animate-in zoom-in duration-200" data-tour-id="tutorial-pos-digital-provider">
                                {['fib', 'qicard', 'zaincash', 'fastpay'].map((provider) => (
                                    <button
                                        key={provider}
                                        onClick={() => setDigitalProvider(provider as any)}
                                        className={cn(
                                            "p-1 rounded-xl transition-all border-2",
                                            digitalProvider === provider ? "border-primary scale-110 shadow-lg" : "border-transparent opacity-40 grayscale"
                                        )}
                                    >
                                        <img
                                            src={`./icons/${provider === 'fib' ? 'fib.svg' : provider === 'qicard' ? 'qi.svg' : provider === 'zaincash' ? 'zain.svg' : 'fastpay.svg'}`}
                                            className="w-10 h-10 rounded-lg object-contain"
                                        />
                                    </button>
                                ))}
                            </div>
                        )}

                        {/* Total Discount Input - Mobile Optimized */}
                        <div className="flex flex-col gap-3">
                            <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider ml-1">{t('pos.totalDiscount')}</label>
                            <div className="flex items-center gap-3 bg-muted/30 p-2 rounded-2xl border border-border/50 transition-all focus-within:border-primary/50 focus-within:bg-background">
                                <div className="flex-1 relative">
                                    <Input
                                        type="number"
                                        value={discountValue}
                                        onChange={(e) => setDiscountValue(e.target.value)}
                                        onFocus={(e) => e.target.select()}
                                        className="h-12 bg-transparent border-none shadow-none focus-visible:ring-0 text-lg font-black placeholder:text-muted-foreground/40 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                        placeholder="0.00"
                                    />
                                </div>
                                <div className="flex bg-muted p-1 rounded-xl gap-1 border border-border/10">
                                    <button
                                        onClick={() => setDiscountType('percent')}
                                        className={cn(
                                            "w-12 h-10 rounded-lg flex items-center justify-center text-sm font-black transition-all duration-200",
                                            discountType === 'percent'
                                                ? "bg-background text-foreground shadow-sm ring-1 ring-black/5"
                                                : "text-muted-foreground/40 hover:text-muted-foreground"
                                        )}
                                    >
                                        %
                                    </button>
                                    <button
                                        onClick={() => setDiscountType('amount')}
                                        className={cn(
                                            "w-12 h-10 rounded-lg flex items-center justify-center text-sm font-black transition-all duration-200",
                                            discountType === 'amount'
                                                ? "bg-background text-foreground shadow-sm ring-1 ring-black/5"
                                                : "text-muted-foreground/40 hover:text-muted-foreground"
                                        )}
                                    >
                                        $
                                    </button>
                                </div>
                            </div>
                            {hasTrulyMissingRates ? (
                                <div className="mx-1 text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-xl px-3 py-2.5 flex items-center gap-2 animate-in fade-in duration-300">
                                    <RefreshCw className="w-3.5 h-3.5 flex-shrink-0" />
                                    <span>Exchange rates unavailable. Check your connection or set manual rates.</span>
                                </div>
                            ) : hasLoadingRates && (
                                <div className="mx-1 text-xs text-amber-500 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2.5 flex items-center gap-2 animate-in fade-in duration-300">
                                    <RefreshCw className="w-3.5 h-3.5 flex-shrink-0 animate-spin" />
                                    <span>Refreshing rates... You can still checkout.</span>
                                </div>
                            )}

                            <div className="space-y-3">
                                <div className="flex justify-between items-center text-muted-foreground text-sm font-medium">
                                    <span>{t('pos.subtotal')}</span>
                                    <span>{formatCurrency(totalAmount, settlementCurrency, features.iqd_display_preference)}</span>
                                </div>
                                <div className="flex justify-between items-center pt-2 border-t border-border/50">
                                    <span className="font-bold text-lg text-foreground">{t('pos.total')}</span>
                                    <div className="flex flex-col items-end">
                                        <span className="font-black text-2xl text-primary leading-none">
                                            {formatCurrency(totalAmount, settlementCurrency, features.iqd_display_preference)}
                                        </span>
                                        <span className="text-[10px] uppercase font-bold text-primary/40 tracking-widest mt-1">{settlementCurrency}</span>
                                    </div>
                                </div>
                            </div>

                            <div className="flex gap-2 pt-2">
                                <Button
                                    data-tour-id="tutorial-pos-checkout"
                                    className="flex-[4] h-14 rounded-2xl text-lg font-black shadow-xl shadow-primary/20 active:scale-95 transition-all text-primary-foreground"
                                    onClick={() => handleCheckout()}
                                    disabled={cart.length === 0 || isLoading || hasTrulyMissingRates}
                                >
                                    {isLoading ? <Loader2 className="animate-spin w-6 h-6" /> : (
                                        <div className="flex items-center gap-2">
                                            {paymentType === 'digital' ? (
                                                <Zap className="w-6 h-6" />
                                            ) : paymentType === 'loan' ? (
                                                <Coins className="w-6 h-6" />
                                            ) : (
                                                <Banknote className="w-6 h-6" />
                                            )}
                                            <span>
                                                {paymentType === 'digital'
                                                    ? t('pos.digitalCheckout') || 'Digital Checkout'
                                                    : paymentType === 'loan'
                                                        ? t('pos.processLoan') || 'Process Loan'
                                                        : t('pos.checkout') || 'Checkout'}
                                            </span>
                                        </div>
                                    )}
                                </Button>
                                <Button
                                    variant="outline"
                                    className="flex-1 h-14 rounded-2xl border-2 hover:bg-primary/5 hover:text-primary transition-all group px-0"
                                    onClick={handleHoldSale}
                                    disabled={cart.length === 0 || isLoading}
                                >
                                    <Archive className="w-6 h-6 group-hover:scale-110 transition-transform" />
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Backdrop for expanded state */}
            {isExpanded && (
                <div
                    className="fixed inset-0 bg-black/20 backdrop-blur-[2px] z-30 animate-in fade-in duration-300"
                    onClick={() => setIsExpanded(false)}
                />
            )}
        </div>
    )
}
