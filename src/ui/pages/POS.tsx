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
    Settings as SettingsIcon,
    Pencil
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

    // Keyboard Navigation State (Electron Only)
    const [isElectron, setIsElectron] = useState(false)
    const [focusedSection, setFocusedSection] = useState<'grid' | 'cart'>('grid')
    const [focusedProductIndex, setFocusedProductIndex] = useState<number>(-1)
    const [focusedCartIndex, setFocusedCartIndex] = useState<number>(-1)
    const searchInputRef = useRef<HTMLInputElement>(null)
    const productRefs = useRef<(HTMLButtonElement | null)[]>([])
    const cartItemRefs = useRef<(HTMLDivElement | null)[]>([])
    const lastEnterTime = useRef<number>(0)

    useEffect(() => {
        window.electronAPI?.isElectron().then((res) => {
            setIsElectron(res)
            if (res) setFocusedProductIndex(0) // Default first item focus on Electron
        })
    }, [])

    // Calculate grid columns for ArrowUp/Down navigation
    const getGridColumns = () => {
        const width = window.innerWidth
        if (width >= 1280) return 4 // xl
        if (width >= 1024) return 3 // lg
        return 2 // default/md
    }

    // Negotiated Price Edit State
    const [editingPriceItemId, setEditingPriceItemId] = useState<string | null>(null)
    const [negotiatedPriceInput, setNegotiatedPriceInput] = useState('')
    const isAdmin = user?.role === 'admin'

    // Payment Method State
    const [paymentType, setPaymentType] = useState<'cash' | 'digital'>('cash')
    const [digitalProvider, setDigitalProvider] = useState<'fib' | 'qicard' | 'zaincash' | 'fastpay'>('fib')
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
    const { exchangeData, eurRates, tryRates, status, refresh: refreshExchangeRate } = useExchangeRate()
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
        const itemCurrency = products.find(p => p.id === item.product_id)?.currency || 'usd'
        const basePrice = item.negotiated_price ?? item.price
        const converted = convertPrice(basePrice, itemCurrency, settlementCurrency)
        return sum + (converted * item.quantity)
    }, 0)
    const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0)

    // Keyboard Navigation Effect
    useEffect(() => {
        if (!isElectron) return

        const handleNavigation = (e: KeyboardEvent) => {
            // Disable if modals are open
            if (isSkuModalOpen || isBarcodeModalOpen || editingPriceItemId) return

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

            // Handle letter/number keys to auto-focus search
            if (e.key.length === 1 && /^[a-zA-Z0-9]$/.test(e.key) && !e.ctrlKey && !e.altKey && !e.metaKey) {
                searchInputRef.current?.focus()
                // The key will be typed automatically since we're focusing
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
                            updateQuantity(cart[focusedCartIndex].product_id, 1)
                        }
                        break
                    case 'ArrowLeft':
                        e.preventDefault()
                        if (focusedCartIndex >= 0 && focusedCartIndex < cart.length) {
                            updateQuantity(cart[focusedCartIndex].product_id, -1)
                        }
                        break
                    case 'Escape':
                        e.preventDefault()
                        if (focusedCartIndex >= 0 && focusedCartIndex < cart.length) {
                            removeFromCart(cart[focusedCartIndex].product_id)
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
    }, [isElectron, isSkuModalOpen, isBarcodeModalOpen, editingPriceItemId, focusedProductIndex, focusedSection, focusedCartIndex, filteredProducts, cart, search])

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

        if (product.currency === 'try' && !features.try_conversion_enabled) {
            toast({
                variant: 'destructive',
                title: t('messages.error'),
                description: t('pos.tryDisabled') || 'TRY conversion is disabled.',
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

    const setNegotiatedPrice = (productId: string, price: number | undefined) => {
        setCart((prev) =>
            prev.map((item) =>
                item.product_id === productId
                    ? { ...item, negotiated_price: price }
                    : item
            )
        )
    }

    const openPriceEdit = (productId: string, currentPrice: number) => {
        setEditingPriceItemId(productId)
        setNegotiatedPriceInput(currentPrice.toString())
    }

    const savePriceEdit = () => {
        if (editingPriceItemId) {
            const newPrice = parseFloat(negotiatedPriceInput)
            if (!isNaN(newPrice) && newPrice >= 0) {
                setNegotiatedPrice(editingPriceItemId, newPrice)
            }
            setEditingPriceItemId(null)
            setNegotiatedPriceInput('')
        }
    }

    const cancelPriceEdit = () => {
        setEditingPriceItemId(null)
        setNegotiatedPriceInput('')
    }

    const clearNegotiatedPrice = (productId: string) => {
        setNegotiatedPrice(productId, undefined)
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

        if (usedCurrencies.has('try')) {
            if (settlementCurrency === 'iqd' && tryRates.try_iqd) {
                exchangeRatesSnapshot.push({
                    pair: 'TRY/IQD',
                    rate: tryRates.try_iqd.rate,
                    source: tryRates.try_iqd.source,
                    timestamp: tryRates.try_iqd.timestamp
                })
            } else if (settlementCurrency === 'usd' && tryRates.usd_try) {
                exchangeRatesSnapshot.push({
                    pair: 'USD/TRY',
                    rate: tryRates.usd_try.rate,
                    source: tryRates.usd_try.source,
                    timestamp: tryRates.usd_try.timestamp
                })
            }
        }

        // Handle TRY settlement with USD/EUR products - need IQD bridge rates
        if (settlementCurrency === 'try') {
            // Always add TRY/IQD for cost conversion chaining
            if (tryRates.try_iqd && !exchangeRatesSnapshot.find(s => s.pair === 'TRY/IQD')) {
                exchangeRatesSnapshot.push({
                    pair: 'TRY/IQD',
                    rate: tryRates.try_iqd.rate,
                    source: tryRates.try_iqd.source,
                    timestamp: tryRates.try_iqd.timestamp
                })
            }
            // Add USD/IQD if USD products in cart
            if (usedCurrencies.has('usd') && exchangeData && !exchangeRatesSnapshot.find(s => s.pair === 'USD/IQD')) {
                exchangeRatesSnapshot.push({
                    pair: 'USD/IQD',
                    rate: exchangeData.rate,
                    source: exchangeData.source,
                    timestamp: exchangeData.timestamp || new Date().toISOString()
                })
            }
            // Add EUR/IQD if EUR products in cart
            if (usedCurrencies.has('eur') && eurRates.eur_iqd && !exchangeRatesSnapshot.find(s => s.pair === 'EUR/IQD')) {
                exchangeRatesSnapshot.push({
                    pair: 'EUR/IQD',
                    rate: eurRates.eur_iqd.rate,
                    source: eurRates.eur_iqd.source,
                    timestamp: eurRates.eur_iqd.timestamp
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
            if (settlementCurrency === 'try' && tryRates.try_iqd && !exchangeRatesSnapshot.find(s => s.pair === 'TRY/IQD')) {
                exchangeRatesSnapshot.push({
                    pair: 'TRY/IQD',
                    rate: tryRates.try_iqd.rate,
                    source: tryRates.try_iqd.source,
                    timestamp: tryRates.try_iqd.timestamp
                })
            }
        }

        const snapshotRate = exchangeData?.rate || 0
        const snapshotSource = exchangeData?.source || 'none'
        const snapshotTimestamp = new Date().toISOString()

        const itemsWithMetadata = cart.map((item) => {
            const product = products.find(p => p.id === item.product_id)
            const originalCurrency = product?.currency || 'usd'
            const effectivePrice = item.negotiated_price ?? item.price
            const convertedUnitPrice = convertPrice(effectivePrice, originalCurrency, settlementCurrency)
            const costPrice = product?.costPrice || 0
            const convertedCostPrice = convertPrice(costPrice, originalCurrency, settlementCurrency)

            return {
                product_id: item.product_id,
                quantity: item.quantity,
                unit_price: effectivePrice, // negotiated or original
                total_price: effectivePrice * item.quantity,
                cost_price: costPrice,
                converted_cost_price: convertedCostPrice,
                original_currency: originalCurrency,
                original_unit_price: item.price, // always store original
                converted_unit_price: convertedUnitPrice,
                settlement_currency: settlementCurrency,
                negotiated_price: item.negotiated_price, // store if negotiated
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
            exchange_rates: exchangeRatesSnapshot,
            origin: 'pos',
            payment_method: paymentType === 'cash' ? 'cash' : digitalProvider
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
                        settlementCurrency: settlementCurrency,
                        exchangeSource: snapshotSource,
                        exchangeRate: snapshotRate,
                        exchangeRateTimestamp: snapshotTimestamp,
                        exchangeRates: checkoutPayload.exchange_rates,
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
                            costPrice: item.cost_price,
                            convertedCostPrice: item.converted_cost_price,
                            originalCurrency: item.original_currency,
                            originalUnitPrice: item.original_unit_price,
                            convertedUnitPrice: item.converted_unit_price,
                            settlementCurrency: item.settlement_currency
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
                            ref={searchInputRef}
                            className="pl-10 h-12 text-lg"
                            tabIndex={isElectron ? -1 : 0}
                        />
                    </div>
                    <div className="flex gap-2">
                        <Button
                            variant="outline"
                            className="h-12 w-12 rounded-xl relative overflow-hidden"
                            onClick={() => setIsSkuModalOpen(true)}
                            title="Scan SKU (Hotkey: P)"
                            tabIndex={isElectron ? -1 : 0}
                        >
                            <Barcode className="w-5 h-5" />
                        </Button>
                        <Button
                            variant="outline"
                            className="h-12 px-4 rounded-xl relative flex items-center gap-2"
                            onClick={() => setIsBarcodeModalOpen(true)}
                            title="Barcode Scanner (Hotkey: K)"
                            tabIndex={isElectron ? -1 : 0}
                        >
                            <Camera className="w-5 h-5" />
                            <div className={`w-2.5 h-2.5 rounded-full ${isScannerAutoEnabled ? 'bg-emerald-500' : 'bg-red-500'} border border-background shadow-sm`} />
                        </Button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto pr-2">
                    <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {filteredProducts.map((product, index) => (
                            <button
                                key={product.id}
                                ref={el => productRefs.current[index] = el}
                                onClick={() => addToCart(product)}
                                disabled={product.quantity <= 0}
                                className={cn(
                                    "bg-card hover:bg-accent/50 transition-all duration-200 p-4 rounded-xl border border-border text-left flex flex-col gap-2 relative overflow-hidden group outline-none",
                                    product.quantity <= 0 ? 'opacity-60 cursor-not-allowed' : '',
                                    // Keyboard focus highlight (Electron only)
                                    (isElectron && focusedSection === 'grid' && focusedProductIndex === index) ? "ring-2 ring-primary ring-offset-2 ring-offset-background scale-[1.02] shadow-lg z-10 box-shadow-[0_0_0_2px_hsl(var(--primary))]" : ""
                                )}
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
                                                // Hide the image and show fallback
                                                (e.target as HTMLImageElement).style.display = 'none';
                                                const parent = (e.target as HTMLImageElement).parentElement;
                                                if (parent) {
                                                    parent.innerHTML = `<span class="text-xs font-medium text-center px-2 line-clamp-3">${product.name}</span>`;
                                                }
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
                            cart.map((item, index) => {
                                const productCurrency = products.find(p => p.id === item.product_id)?.currency || 'usd'
                                const effectivePrice = item.negotiated_price ?? item.price
                                const convertedPrice = convertPrice(effectivePrice, productCurrency, settlementCurrency)
                                const isConverted = productCurrency !== settlementCurrency
                                const hasNegotiated = item.negotiated_price !== undefined

                                return (
                                    <div
                                        key={item.product_id}
                                        ref={el => cartItemRefs.current[index] = el}
                                        className={cn(
                                            "bg-background border border-border p-3 rounded-lg flex gap-3 group transition-all duration-200 scroll-m-2",
                                            (isElectron && focusedSection === 'cart' && focusedCartIndex === index) ? "ring-2 ring-primary ring-offset-2 ring-offset-background border-primary/50 shadow-md transform scale-[1.01]" : ""
                                        )}
                                    >
                                        <div className="flex-1 min-w-0">
                                            <div className="font-medium truncate">{item.name}</div>
                                            <div className="flex flex-col gap-0.5">
                                                {/* Show original price (grayed out if negotiated) */}
                                                <div className={cn(
                                                    "text-xs",
                                                    hasNegotiated ? "text-muted-foreground/50 line-through" : "text-muted-foreground"
                                                )}>
                                                    {formatCurrency(item.price, productCurrency, features.iqd_display_preference)} x {item.quantity}
                                                </div>
                                                {/* Show negotiated price if set */}
                                                {hasNegotiated && (
                                                    <div className="text-xs text-emerald-600 font-medium flex items-center gap-1">
                                                        <span>{formatCurrency(item.negotiated_price!, productCurrency, features.iqd_display_preference)} x {item.quantity}</span>
                                                        {isAdmin && (
                                                            <button
                                                                onClick={() => clearNegotiatedPrice(item.product_id)}
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
                                                {isAdmin && (
                                                    <button
                                                        onClick={() => openPriceEdit(item.product_id, item.negotiated_price ?? item.price)}
                                                        className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 hover:bg-muted rounded"
                                                        title={t('pos.modifyPrice') || 'Modify Price'}
                                                    >
                                                        <Pencil className="w-3 h-3 text-primary" />
                                                    </button>
                                                )}
                                            </div>
                                            {isConverted && !hasNegotiated && (
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
                                        <span className={cn("font-bold", status === 'error' ? "text-destructive" : "text-primary")}>
                                            {status === 'error' ? t('common.offline') || 'Offline' : formatCurrency(exchangeData.rate, 'iqd', features.iqd_display_preference)}
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
                                        <span className={cn("font-bold", status === 'error' ? "text-destructive" : "text-primary")}>
                                            {status === 'error' ? t('common.offline') || 'Offline' : formatCurrency(eurRates.eur_iqd.rate, 'iqd', features.iqd_display_preference)}
                                        </span>
                                    </div>
                                </div>
                            )}

                            {/* TRY Rate (Conditional) */}
                            {features.try_conversion_enabled && tryRates.try_iqd && (
                                <div className={cn(
                                    "flex justify-between items-center text-[11px]",
                                    (exchangeData || (features.eur_conversion_enabled && eurRates.eur_iqd)) && "pt-1.5 border-t border-primary/5"
                                )}>
                                    <div className="flex items-center gap-2">
                                        <span className="font-bold text-primary/80 uppercase">TRY/IQD</span>
                                        <span className="opacity-50 text-[10px] uppercase leading-none">{tryRates.try_iqd.source}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="opacity-60">100 TRY =</span>
                                        <span className={cn("font-bold", status === 'error' ? "text-destructive" : "text-primary")}>
                                            {status === 'error' ? t('common.offline') || 'Offline' : formatCurrency(tryRates.try_iqd.rate, 'iqd', features.iqd_display_preference)}
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

                    {/* Payment Method Toggle */}
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <span className="text-xs text-muted-foreground font-medium">{t('pos.paymentMethod') || 'Payment Method'}</span>
                            <div className="flex bg-muted rounded-lg p-0.5 gap-0.5">
                                <button
                                    onClick={() => setPaymentType('cash')}
                                    className={cn(
                                        "px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5",
                                        paymentType === 'cash'
                                            ? "bg-background shadow-sm"
                                            : "hover:bg-background/50"
                                    )}
                                >
                                    <CreditCard className="w-3 h-3" />
                                    {t('pos.cash') || 'Cash'}
                                </button>
                                <button
                                    onClick={() => setPaymentType('digital')}
                                    className={cn(
                                        "px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5",
                                        paymentType === 'digital'
                                            ? "bg-background shadow-sm"
                                            : "hover:bg-background/50"
                                    )}
                                >
                                    <Zap className="w-3 h-3" />
                                    {t('pos.digital') || 'Digital'}
                                </button>
                            </div>
                        </div>

                        {/* Digital Provider Sub-toggle */}
                        {paymentType === 'digital' && (
                            <div className="flex justify-end">
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
                                            src="./icons/FIB24x24.jpg"
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
                                            src="./icons/QIcard24x24.png"
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
                                            src="./icons/zain24x24.png"
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
                                            src="./icons/fastpay24x24.jpg"
                                            alt="FastPay"
                                            className="w-6 h-6 rounded"
                                        />
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    <Button
                        size="lg"
                        className="w-full h-14 text-xl shadow-lg shadow-primary/20"
                        onClick={handleCheckout}
                        disabled={cart.length === 0 || isLoading || (cart.some(item => products.find(p => p.id === item.product_id)?.currency !== settlementCurrency) && (status === 'error' || !exchangeData))}
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

            {/* Negotiated Price Edit Dialog */}
            <Dialog open={editingPriceItemId !== null} onOpenChange={() => cancelPriceEdit()}>
                <DialogContent className="max-w-sm">
                    <DialogHeader>
                        <DialogTitle>{t('pos.modifyPrice') || 'Modify Price'}</DialogTitle>
                    </DialogHeader>
                    {(() => {
                        const editingItem = cart.find(i => i.product_id === editingPriceItemId)
                        const editingProduct = products.find(p => p.id === editingPriceItemId)
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
                                    <Input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        value={negotiatedPriceInput}
                                        onChange={(e) => setNegotiatedPriceInput(e.target.value)}
                                        placeholder="0.00"
                                        className="text-lg py-5 font-mono mt-1"
                                        autoFocus
                                    />
                                    <p className="text-xs text-muted-foreground mt-1">
                                        {t('pos.originalPriceDesc') || 'Original price will be preserved in records.'}
                                    </p>
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
        </div >
    )
}
