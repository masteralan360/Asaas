import { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/auth'
import { supabase } from '@/auth/supabase'
import { addToOfflineMutations, useProducts, type Product, type CurrencyCode } from '@/local-db'
import { db } from '@/local-db/database'
import { formatCurrency, generateId, cn } from '@/lib/utils'
import { CartItem } from '@/types'
import { useWorkspace } from '@/workspace'
import { useExchangeRate } from '@/context/ExchangeRateContext'
import {
    Button,
    Input,
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    useToast,
    Label,
    Switch
} from '@/ui/components'
import {
    Search,
    ShoppingCart,
    Plus,
    Minus,
    Trash2,
    CreditCard,
    Zap,
    Loader2,
    Barcode,
    Camera,
    Settings as SettingsIcon
} from 'lucide-react'
import { BarcodeScanner } from 'react-barcode-scanner'
import 'react-barcode-scanner/polyfill'

export function POS() {
    const { toast } = useToast()
    const { user } = useAuth()
    const { t } = useTranslation()
    const { features } = useWorkspace()
    const products = useProducts(user?.workspaceId)
    const [search, setSearch] = useState('')
    const [cart, setCart] = useState<CartItem[]>([])
    const [isSkuModalOpen, setIsSkuModalOpen] = useState(false)
    const [skuInput, setSkuInput] = useState('')
    const [isLoading, setIsLoading] = useState(false)
    const [isBarcodeModalOpen, setIsBarcodeModalOpen] = useState(false)
    const [isScannerAutoEnabled, setIsScannerAutoEnabled] = useState(() => {
        return localStorage.getItem('scanner_auto_enabled') === 'true'
    })
    const [selectedCameraId, setSelectedCameraId] = useState(localStorage.getItem('scanner_camera_id') || '')
    const [cameras, setCameras] = useState<MediaDeviceInfo[]>([])
    const skuInputRef = useRef<HTMLInputElement>(null)
    const lastScannedCode = useRef<string | null>(null)
    const lastScannedTime = useRef<number>(0)
    const [scanDelay, setScanDelay] = useState(() => {
        return Number(localStorage.getItem('scanner_scan_delay')) || 2500
    })

    // Filter products
    const filteredProducts = products.filter(
        (p) =>
            p.name.toLowerCase().includes(search.toLowerCase()) ||
            p.sku.toLowerCase().includes(search.toLowerCase())
    )

    const getDisplayImageUrl = (url?: string) => {
        if (!url) return '';
        if (url.match(/^[a-zA-Z]:[/\\]|^[/\\]|^\w+:/) && !url.startsWith('http') && !url.startsWith('erpimg://')) {
            return `erpimg:///${url.replace(/\\/g, '/')}`;
        }
        return url;
    }

    // Exchange Rate for advisory display and calculations
    const { exchangeData, eurRates, refresh: refreshExchangeRate } = useExchangeRate()
    const settlementCurrency = features.default_currency || 'usd'

    useEffect(() => {
        refreshExchangeRate()
    }, [refreshExchangeRate])

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
        }
        // CHAINED PATHS (If needed based on default_currency)
        else if (from === 'usd' && to === 'iqd') { /* already handled */ }
        else if (from === 'iqd' && to === 'usd') { /* already handled */ }
        // ... more chains if needed, e.g. IQD -> USD -> EUR
        else if (from === 'iqd' && to === 'eur') {
            const r1 = getRate('usd_iqd'); const r2 = getRate('usd_eur')
            if (r1 && r2) converted = (amount / r1) * r2
        } else if (from === 'eur' && to === 'iqd') {
            // we have direct EUR/IQD now from forexfy
        }

        // Rounding rules
        if (to === 'iqd') return Math.round(converted)
        return Math.round(converted * 100) / 100
    }, [exchangeData, eurRates])

    // Calculate totals
    const totalAmount = cart.reduce((sum, item) => {
        const itemCurrency = products.find(p => p.id === item.product_id)?.currency || 'usd'
        const converted = convertPrice(item.price, itemCurrency, settlementCurrency)
        return sum + (converted * item.quantity)
    }, 0)
    const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0)

    // Hotkey listener
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const skuHotkey = localStorage.getItem('pos_hotkey') || 'p'
            const barcodeHotkey = localStorage.getItem('barcode_hotkey') || 'k'

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
    }, [isSkuModalOpen, isBarcodeModalOpen])

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

    const addToCart = (product: Product) => {
        if (product.quantity <= 0) return // Out of stock

        // Check EUR support
        if (product.currency === 'eur' && !features.eur_conversion_enabled) {
            toast({
                variant: 'destructive',
                title: t('messages.error'),
                description: t('pos.eurDisabled') || 'Euro products represent a currency that is currently disabled in settings.',
            })
            return
        }

        // Mixed currency is now allowed.
        // Conversion will be handled in calculations and checkout.

        setCart((prev) => {
            const existing = prev.find((item) => item.product_id === product.id)
            if (existing) {
                // Check stock limit (assuming local DB is source of truth for immediate check)
                if (existing.quantity >= product.quantity) return prev

                return prev.map((item) =>
                    item.product_id === product.id
                        ? { ...item, quantity: item.quantity + 1 }
                        : item
                )
            }
            return [
                ...prev,
                {
                    product_id: product.id,
                    sku: product.sku,
                    name: product.name,
                    price: product.price,
                    quantity: 1,
                    max_stock: product.quantity
                }
            ]
        })
    }

    const removeFromCart = (productId: string) => {
        setCart((prev) => prev.filter((item) => item.product_id !== productId))
    }

    const updateQuantity = (productId: string, delta: number) => {
        setCart((prev) => {
            return prev.map((item) => {
                if (item.product_id === productId) {
                    const newQty = item.quantity + delta
                    if (newQty <= 0) return item
                    if (newQty > item.max_stock) return item
                    return { ...item, quantity: newQty }
                }
                return item
            })
        })
    }

    const handleSkuSubmit = (e: React.FormEvent) => {
        e.preventDefault()
        const product = products.find((p) => p.sku.toLowerCase() === skuInput.toLowerCase())

        if (product) {
            addToCart(product)
            setSkuInput('')
            setIsSkuModalOpen(false)
            toast({
                title: t('messages.success'),
                description: `${product.name} ${t('common.added')}`,
                duration: 2000,
            })
        } else {
            toast({
                variant: 'destructive',
                title: t('messages.error'),
                description: t('pos.skuNotFound') || 'Product not found',
            })
        }
    }

    const handleBarcodeDetected = (barcodes: any[]) => {
        if (!isScannerAutoEnabled || barcodes.length === 0) return
        const text = barcodes[0].rawValue

        // Simple debounce/cooldown logic
        const now = Date.now()
        if (text === lastScannedCode.current && (now - lastScannedTime.current) < scanDelay) {
            return
        }

        lastScannedCode.current = text
        lastScannedTime.current = now

        const product = products.find((p) =>
            (p.barcode && p.barcode === text) ||
            p.sku.toLowerCase() === text.toLowerCase()
        )

        if (product) {
            addToCart(product)
            toast({
                title: t('messages.success'),
                description: `${product.name} ${t('common.added')}`,
                duration: 2000,
            })
        } else {
            toast({
                variant: 'destructive',
                title: t('messages.error'),
                description: `${t('pos.skuNotFound')}: ${text}`,
                duration: 2000,
            })
        }
    }

    const handleCheckout = async () => {
        if (cart.length === 0 || !user) return

        const isMixedCurrency = cart.some(item => {
            const product = products.find(p => p.id === item.product_id)
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

        setIsLoading(true)

        const saleId = generateId()

        // Collect actually used exchange rates for this specific checkout
        const usedCurrencies = new Set(cart.map(item => products.find(p => p.id === item.product_id)?.currency || 'usd'))
        const exchangeRatesSnapshot: any[] = []

        // If it's a mixed checkout (items currency != settlement currency)
        if (usedCurrencies.has('usd') && settlementCurrency === 'iqd' && exchangeData) {
            exchangeRatesSnapshot.push({
                pair: 'USD/IQD',
                rate: exchangeData.rate,
                source: exchangeData.source,
                timestamp: exchangeData.timestamp || new Date().toISOString()
            })
        }
        if (usedCurrencies.has('eur')) {
            if (settlementCurrency === 'iqd' && eurRates.eur_iqd) {
                exchangeRatesSnapshot.push({
                    pair: 'EUR/IQD',
                    rate: eurRates.eur_iqd.rate,
                    source: eurRates.eur_iqd.source,
                    timestamp: eurRates.eur_iqd.timestamp
                })
            } else if (settlementCurrency === 'usd' && eurRates.usd_eur) {
                exchangeRatesSnapshot.push({
                    pair: 'USD/EUR',
                    rate: eurRates.usd_eur.rate,
                    source: eurRates.usd_eur.source,
                    timestamp: eurRates.usd_eur.timestamp
                })
            }
        }
        // Handle IQD items settled in USD/EUR if applicable
        if (usedCurrencies.has('iqd') && settlementCurrency !== 'iqd' && exchangeData) {
            // We need USD/IQD for IQD -> USD conversion
            if (!exchangeRatesSnapshot.find(s => s.pair === 'USD/IQD')) {
                exchangeRatesSnapshot.push({
                    pair: 'USD/IQD',
                    rate: exchangeData.rate,
                    source: exchangeData.source,
                    timestamp: exchangeData.timestamp || new Date().toISOString()
                })
            }
            if (settlementCurrency === 'eur' && eurRates.usd_eur) {
                exchangeRatesSnapshot.push({
                    pair: 'USD/EUR',
                    rate: eurRates.usd_eur.rate,
                    source: eurRates.usd_eur.source,
                    timestamp: eurRates.usd_eur.timestamp
                })
            }
        }

        const snapshotRate = exchangeData?.rate || 0
        const snapshotSource = exchangeData?.source || 'none'
        const snapshotTimestamp = new Date().toISOString()

        const itemsWithMetadata = cart.map((item) => {
            const product = products.find(p => p.id === item.product_id)
            const originalCurrency = product?.currency || 'usd'
            const convertedUnitPrice = convertPrice(item.price, originalCurrency, settlementCurrency)

            return {
                product_id: item.product_id,
                quantity: item.quantity,
                unit_price: item.price, // original
                total_price: item.price * item.quantity, // original total
                original_currency: originalCurrency,
                original_unit_price: item.price,
                converted_unit_price: convertedUnitPrice,
                settlement_currency: settlementCurrency,
                total: convertedUnitPrice * item.quantity
            }
        })

        const checkoutPayload = {
            id: saleId,
            items: itemsWithMetadata,
            total_amount: totalAmount,
            settlement_currency: settlementCurrency,
            exchange_source: exchangeRatesSnapshot.length > 1 ? 'mixed' : snapshotSource,
            exchange_rate: snapshotRate,
            exchange_rate_timestamp: snapshotTimestamp,
            exchange_rates: exchangeRatesSnapshot, // New field for multi-currency
            origin: 'pos'
        }

        try {
            // Attempt online checkout
            const { error } = await supabase.rpc('complete_sale', {
                payload: checkoutPayload
            })

            if (error) {
                if (error.message?.includes('Failed to fetch') || (error as any).status === 0) {
                    throw new Error('OFFLINE_FETCH_ERROR')
                }
                throw error
            }

            // Update local inventory
            await Promise.all(cart.map(async (item) => {
                const product = products.find(p => p.id === item.product_id)
                if (product) {
                    await db.products.update(item.product_id, {
                        quantity: Math.max(0, product.quantity - item.quantity)
                    })
                }
            }))

            setCart([])
            toast({
                title: t('messages.success'),
                description: t('messages.saleCompleted'),
                duration: 3000,
            })
            // Refresh exchange rate for the next sale
            refreshExchangeRate()
        } catch (err: any) {
            console.error('Checkout failed, attempting offline save:', err)

            if (err.message === 'OFFLINE_FETCH_ERROR' || !navigator.onLine) {
                try {
                    // 1. Save Sale locally
                    await db.sales.add({
                        id: saleId,
                        workspaceId: user.workspaceId,
                        cashierId: user.id,
                        totalAmount: totalAmount,
                        settlement_currency: settlementCurrency,
                        exchange_source: snapshotSource,
                        exchange_rate: snapshotRate,
                        exchange_rate_timestamp: snapshotTimestamp,
                        exchange_rates: checkoutPayload.exchange_rates,
                        origin: 'pos',
                        createdAt: snapshotTimestamp,
                        updatedAt: snapshotTimestamp,
                        syncStatus: 'pending',
                        lastSyncedAt: null,
                        version: 1,
                        isDeleted: false
                    })

                    // 2. Save Sale Items locally
                    await Promise.all(itemsWithMetadata.map(item =>
                        db.sale_items.add({
                            id: generateId(),
                            saleId: saleId,
                            productId: item.product_id,
                            quantity: item.quantity,
                            unitPrice: item.unit_price,
                            totalPrice: item.total_price,
                            original_currency: item.original_currency,
                            original_unit_price: item.original_unit_price,
                            converted_unit_price: item.converted_unit_price,
                            settlement_currency: item.settlement_currency
                        })
                    ))

                    // 3. Update Local Inventory
                    await Promise.all(cart.map(async (item) => {
                        const product = products.find(p => p.id === item.product_id)
                        if (product) {
                            await db.products.update(item.product_id, {
                                quantity: Math.max(0, product.quantity - item.quantity)
                            })
                        }
                    }))

                    // 4. Add to Sync Queue
                    await addToOfflineMutations('sales', saleId, 'create', checkoutPayload, user.workspaceId)

                    setCart([])
                    toast({
                        title: t('pos.offlineTitle') || 'Saved Offline',
                        description: t('pos.offlineDesc') || 'Sale saved locally and will sync when online.',
                        duration: 5000,
                    })
                    return
                } catch (saveErr: any) {
                    console.error('Offline save failed:', saveErr)
                }
            }

            toast({
                variant: 'destructive',
                title: t('messages.error'),
                description: t('messages.checkoutFailed') + ': ' + err.message,
            })
        } finally {
            setIsLoading(false)
        }
    }

    return (
        <div className="h-[calc(100vh-6rem)] flex gap-4">
            {/* Products Grid */}
            <div className="flex-1 flex flex-col gap-4">
                <div className="flex items-center gap-4 bg-card p-4 rounded-xl border border-border shadow-sm">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input
                            placeholder={t('pos.searchPlaceholder') || "Search products..."}
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="pl-10 h-12 text-lg"
                        />
                    </div>
                    <div className="flex gap-2">
                        <Button
                            variant="outline"
                            className="h-12 w-12 rounded-xl relative overflow-hidden"
                            onClick={() => setIsSkuModalOpen(true)}
                            title="Scan SKU (Hotkey: P)"
                        >
                            <Barcode className="w-5 h-5" />
                        </Button>
                        <Button
                            variant="outline"
                            className="h-12 px-4 rounded-xl relative flex items-center gap-2"
                            onClick={() => setIsBarcodeModalOpen(true)}
                            title="Barcode Scanner (Hotkey: K)"
                        >
                            <Camera className="w-5 h-5" />
                            <div className={`w-2.5 h-2.5 rounded-full ${isScannerAutoEnabled ? 'bg-emerald-500' : 'bg-red-500'} border border-background shadow-sm`} />
                        </Button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto pr-2">
                    <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {filteredProducts.map((product) => (
                            <button
                                key={product.id}
                                onClick={() => addToCart(product)}
                                disabled={product.quantity <= 0}
                                className={`
                                    bg-card hover:bg-accent/50 transition-colors p-4 rounded-xl border border-border text-left flex flex-col gap-2 relative overflow-hidden group
                                    ${product.quantity <= 0 ? 'opacity-60 cursor-not-allowed' : ''}
                                `}
                            >
                                <div className="absolute top-2 right-2 bg-primary/10 text-primary px-2 py-0.5 rounded text-xs font-bold">
                                    {product.quantity}
                                </div>
                                <div className="h-24 w-full bg-muted/20 rounded-lg mb-2 flex items-center justify-center text-muted-foreground overflow-hidden">
                                    {product.imageUrl ? (
                                        <img
                                            src={getDisplayImageUrl(product.imageUrl)}
                                            alt={product.name}
                                            className="w-full h-full object-cover"
                                            onError={(e) => {
                                                (e.target as HTMLImageElement).src = 'https://placehold.co/200x200?text=Error';
                                            }}
                                        />
                                    ) : (
                                        <Zap className="w-8 h-8 opacity-20" />
                                    )}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <h3 className="font-semibold truncate" title={product.name}>{product.name}</h3>
                                    <p className="text-xs text-muted-foreground truncate">{product.sku}</p>
                                </div>
                                <div className="mt-auto font-bold text-lg text-primary">
                                    {formatCurrency(product.price, product.currency, features.iqd_display_preference)}
                                </div>
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Cart Sidebar */}
            <div className="w-96 bg-card border border-border rounded-xl flex flex-col shadow-xl">
                <div className="p-4 border-b border-border bg-muted/5">
                    <h2 className="text-xl font-bold flex items-center gap-2">
                        <ShoppingCart className="w-5 h-5" />
                        {t('pos.currentSale') || 'Current Sale'}
                    </h2>
                    <div className="text-xs text-muted-foreground mt-1">
                        {totalItems} items
                    </div>
                </div>

                <div className="flex-1 p-4 overflow-y-auto">
                    <div className="space-y-3">
                        {cart.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center text-muted-foreground opacity-50 space-y-2 py-12">
                                <ShoppingCart className="w-12 h-12" />
                                <p>Cart is empty</p>
                            </div>
                        ) : (
                            cart.map((item) => {
                                const productCurrency = products.find(p => p.id === item.product_id)?.currency || 'usd'
                                const convertedPrice = convertPrice(item.price, productCurrency, settlementCurrency)
                                const isConverted = productCurrency !== settlementCurrency

                                return (
                                    <div key={item.product_id} className="bg-background border border-border p-3 rounded-lg flex gap-3 group">
                                        <div className="flex-1 min-w-0">
                                            <div className="font-medium truncate">{item.name}</div>
                                            <div className="flex flex-col gap-0.5">
                                                <div className="text-xs text-muted-foreground">
                                                    {formatCurrency(item.price, productCurrency, features.iqd_display_preference)} x {item.quantity}
                                                </div>
                                                {isConverted && (
                                                    <div className="text-[10px] text-primary/60 font-medium">
                                                        ≈ {formatCurrency(convertedPrice, settlementCurrency, features.iqd_display_preference)} {t('common.each')}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        <div className="flex flex-col items-end gap-1">
                                            <div className="font-bold flex flex-col items-end">
                                                <span>{formatCurrency(convertedPrice * item.quantity, settlementCurrency, features.iqd_display_preference)}</span>
                                                {isConverted && (
                                                    <span className="text-[10px] text-muted-foreground line-through opacity-50">
                                                        {formatCurrency(item.price * item.quantity, productCurrency, features.iqd_display_preference)}
                                                    </span>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <Button
                                                    variant="outline"
                                                    size="icon"
                                                    className="h-6 w-6 rounded-md"
                                                    onClick={() => updateQuantity(item.product_id, -1)}
                                                >
                                                    <Minus className="w-3 h-3" />
                                                </Button>
                                                <span className="w-4 text-center text-sm font-medium">{item.quantity}</span>
                                                <Button
                                                    variant="outline"
                                                    size="icon"
                                                    className="h-6 w-6 rounded-md"
                                                    onClick={() => updateQuantity(item.product_id, 1)}
                                                    disabled={item.quantity >= item.max_stock}
                                                >
                                                    <Plus className="w-3 h-3" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-6 w-6 rounded-md text-destructive opacity-0 group-hover:opacity-100 transition-opacity ml-1"
                                                    onClick={() => removeFromCart(item.product_id)}
                                                >
                                                    <Trash2 className="w-3 h-3" />
                                                </Button>
                                            </div>
                                        </div>
                                    </div>
                                )
                            })
                        )}
                    </div>
                </div>

                <div className="p-4 border-t border-border bg-muted/10 space-y-3">
                    {/* Exchange Rate Info */}
                    {(exchangeData || (features.eur_conversion_enabled && eurRates.eur_iqd)) && (
                        <div className="bg-primary/5 rounded-lg p-2.5 border border-primary/10 space-y-2">
                            {/* USD Rate */}
                            {exchangeData && (
                                <div className="flex justify-between items-center text-[11px]">
                                    <div className="flex items-center gap-2">
                                        <span className="font-bold text-primary/80 uppercase">USD/IQD</span>
                                        <span className="opacity-50 text-[10px] uppercase">{exchangeData.source}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="opacity-60">100 USD =</span>
                                        <span className="font-bold text-primary">
                                            {formatCurrency(exchangeData.rate, 'iqd', features.iqd_display_preference)}
                                        </span>
                                    </div>
                                </div>
                            )}

                            {/* EUR Rate (Conditional) */}
                            {features.eur_conversion_enabled && eurRates.eur_iqd && (
                                <div className={cn(
                                    "flex justify-between items-center text-[11px]",
                                    exchangeData && "pt-1.5 border-t border-primary/5"
                                )}>
                                    <div className="flex items-center gap-2">
                                        <span className="font-bold text-primary/80 uppercase">EUR/IQD</span>
                                        <span className="opacity-50 text-[10px] uppercase leading-none">{eurRates.eur_iqd.source}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="opacity-60">100 EUR =</span>
                                        <span className="font-bold text-primary">
                                            {formatCurrency(eurRates.eur_iqd.rate, 'iqd', features.iqd_display_preference)}
                                        </span>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <span className="text-muted-foreground text-sm">Subtotal</span>
                            <span className="font-semibold">
                                {formatCurrency(totalAmount, settlementCurrency, features.iqd_display_preference)}
                            </span>
                        </div>
                        <div className="flex items-center justify-between text-xl font-bold text-primary pt-1 border-t border-border/50">
                            <span>Total</span>
                            <div className="flex flex-col items-end leading-tight">
                                <span>{formatCurrency(totalAmount, settlementCurrency, features.iqd_display_preference)}</span>
                                <span className="text-[10px] uppercase opacity-50 tracking-tighter">{settlementCurrency}</span>
                            </div>
                        </div>
                    </div>

                    <Button
                        size="lg"
                        className="w-full h-14 text-xl shadow-lg shadow-primary/20"
                        onClick={handleCheckout}
                        disabled={cart.length === 0 || isLoading || (cart.some(item => products.find(p => p.id === item.product_id)?.currency !== settlementCurrency) && !exchangeData)}
                    >
                        {isLoading ? (
                            <Loader2 className="w-6 h-6 animate-spin mr-2" />
                        ) : (
                            <CreditCard className="w-6 h-6 mr-2" />
                        )}
                        {t('pos.checkout') || 'Checkout'}
                    </Button>
                </div>
            </div>

            {/* Barcode Scanner Modal */}
            <Dialog open={isBarcodeModalOpen} onOpenChange={setIsBarcodeModalOpen}>
                <DialogContent className="sm:max-w-2xl">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Camera className="w-5 h-5 text-primary" />
                            {t('pos.barcodeScanner')}
                        </DialogTitle>
                    </DialogHeader>

                    <div className="space-y-6 py-4">
                        {/* Scanner View */}
                        <div className="relative aspect-video bg-muted rounded-xl overflow-hidden border border-border shadow-inner group">
                            {isScannerAutoEnabled ? (
                                <BarcodeScanner
                                    onCapture={handleBarcodeDetected}
                                    trackConstraints={{ deviceId: selectedCameraId }}
                                    options={{
                                        formats: [
                                            'code_128',
                                            'code_39',
                                            'code_93',
                                            'codabar',
                                            'ean_13',
                                            'ean_8',
                                            'itf',
                                            'upc_a',
                                            'upc_e',
                                            'qr_code'
                                        ],
                                        delay: 1000
                                    }}
                                />
                            ) : (
                                <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground bg-muted/50">
                                    <Camera className="w-12 h-12 opacity-20 mb-2" />
                                    <p className="font-medium">{t('pos.scannerDisabled')}</p>
                                </div>
                            )}

                            {/* Scanner Overlay */}
                            {isScannerAutoEnabled && (
                                <div className="absolute inset-x-8 top-1/2 -translate-y-1/2 h-0.5 bg-primary/50 shadow-[0_0_15px_rgba(var(--primary),0.5)] animate-pulse" />
                            )}
                        </div>

                        {/* Controls */}
                        <div className="grid gap-6 md:grid-cols-2">
                            <div className="space-y-4 p-4 rounded-xl bg-muted/30 border border-border">
                                <div className="flex items-center justify-between">
                                    <div className="space-y-0.5">
                                        <Label className="text-base">{t('pos.autoScanner')}</Label>
                                        <p className="text-xs text-muted-foreground">{t('pos.autoScannerDesc')}</p>
                                    </div>
                                    <Switch
                                        checked={isScannerAutoEnabled}
                                        onCheckedChange={(val) => {
                                            setIsScannerAutoEnabled(val)
                                            localStorage.setItem('scanner_auto_enabled', String(val))
                                        }}
                                    />
                                </div>
                            </div>

                            <div className="space-y-4 p-4 rounded-xl bg-muted/30 border border-border">
                                <div className="space-y-2">
                                    <Label className="text-sm font-medium">{t('pos.scanDelay')} (ms)</Label>
                                    <Input
                                        type="number"
                                        value={scanDelay}
                                        onChange={(e) => {
                                            const val = Number(e.target.value)
                                            setScanDelay(val)
                                            localStorage.setItem('scanner_scan_delay', String(val))
                                        }}
                                        min={500}
                                        max={10000}
                                        step={100}
                                        className="h-9"
                                    />
                                    <p className="text-[10px] text-muted-foreground">{t('pos.scanDelayDesc')}</p>
                                </div>
                            </div>

                            <div className="space-y-2 col-span-full">
                                <Label className="text-sm font-medium flex items-center gap-2">
                                    <SettingsIcon className="w-4 h-4" />
                                    {t('pos.selectCamera')}
                                </Label>
                                <select
                                    className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                                    value={selectedCameraId}
                                    onChange={(e) => {
                                        setSelectedCameraId(e.target.value)
                                        localStorage.setItem('scanner_camera_id', e.target.value)
                                    }}
                                >
                                    {cameras.map((camera) => (
                                        <option key={camera.deviceId} value={camera.deviceId}>
                                            {camera.label || `Camera ${camera.deviceId.slice(0, 5)}`}
                                        </option>
                                    ))}
                                    {cameras.length === 0 && (
                                        <option value="">{t('pos.cameraNotFound')}</option>
                                    )}
                                </select>
                            </div>
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsBarcodeModalOpen(false)}>
                            {t('common.cancel')}
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
        </div>
    )
}
