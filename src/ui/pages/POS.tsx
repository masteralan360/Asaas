import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/auth'
import { supabase } from '@/auth/supabase'
import { useProducts, type Product } from '@/local-db'
import { db } from '@/local-db/database'
import { formatCurrency } from '@/lib/utils'
import { CartItem } from '@/types'
import {
    Button,
    Input,
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    useToast
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
    Barcode
} from 'lucide-react'
import { generateId } from '@/lib/utils'
import { addToQueue } from '@/sync/syncQueue'

export function POS() {
    const { toast } = useToast()
    const { user } = useAuth()
    const { t } = useTranslation()
    const products = useProducts(user?.workspaceId)
    const [search, setSearch] = useState('')
    const [cart, setCart] = useState<CartItem[]>([])
    const [isSkuModalOpen, setIsSkuModalOpen] = useState(false)
    const [skuInput, setSkuInput] = useState('')
    const [isLoading, setIsLoading] = useState(false)
    const skuInputRef = useRef<HTMLInputElement>(null)

    // Filter products
    const filteredProducts = products.filter(
        (p) =>
            p.name.toLowerCase().includes(search.toLowerCase()) ||
            p.sku.toLowerCase().includes(search.toLowerCase())
    )

    // Calculate totals
    const totalAmount = cart.reduce((sum, item) => sum + item.price * item.quantity, 0)
    const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0)

    // Hotkey listener
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const hotkey = localStorage.getItem('pos_hotkey') || 'p'
            if (e.key.toLowerCase() === hotkey.toLowerCase() && !isSkuModalOpen) {
                e.preventDefault()
                setIsSkuModalOpen(true)
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [isSkuModalOpen])

    // Focus SKU input when modal opens
    useEffect(() => {
        if (isSkuModalOpen && skuInputRef.current) {
            setTimeout(() => skuInputRef.current?.focus(), 100)
        }
    }, [isSkuModalOpen])

    const addToCart = (product: Product) => {
        if (product.quantity <= 0) return // Out of stock

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
        } else {
            // Optional: Show feedback
            alert(t('pos.skuNotFound') || 'Product not found')
        }
    }

    const handleCheckout = async () => {
        if (cart.length === 0 || !user) return
        setIsLoading(true)

        const saleId = generateId()
        const checkoutPayload = {
            items: cart.map((item) => ({
                product_id: item.product_id,
                quantity: item.quantity,
                price: item.price,
                total: item.price * item.quantity
            })),
            total_amount: totalAmount,
            origin: 'pos'
        }

        try {
            // Attempt online checkout
            const { error } = await supabase.rpc('complete_sale', {
                payload: checkoutPayload
            })

            if (error) {
                // If it's a network error, we want to handle it as offline
                if (error.message?.includes('Failed to fetch') || (error as any).status === 0) {
                    throw new Error('OFFLINE_FETCH_ERROR')
                }
                throw error
            }

            // Update local inventory (reflect backend change immediately)
            await Promise.all(cart.map(async (item) => {
                const product = products.find(p => p.id === item.product_id)
                if (product) {
                    await db.products.update(item.product_id, {
                        quantity: Math.max(0, product.quantity - item.quantity)
                    })
                }
            }))

            // Success
            setCart([])
            toast({
                title: t('messages.success'),
                description: t('messages.saleCompleted'),
                duration: 3000,
            })
        } catch (err: any) {
            console.error('Checkout failed, attempting offline save:', err)

            // Handle Offline Fallback
            if (err.message === 'OFFLINE_FETCH_ERROR' || !navigator.onLine) {
                try {
                    // 1. Save Sale locally
                    await db.sales.add({
                        id: saleId,
                        workspaceId: user.workspaceId,
                        cashierId: user.id,
                        totalAmount: totalAmount,
                        origin: 'pos',
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString(),
                        syncStatus: 'pending',
                        lastSyncedAt: null,
                        version: 1,
                        isDeleted: false
                    })

                    // 2. Save Sale Items locally
                    await Promise.all(cart.map(item =>
                        db.sale_items.add({
                            id: generateId(),
                            saleId: saleId,
                            productId: item.product_id,
                            quantity: item.quantity,
                            unitPrice: item.price,
                            totalPrice: item.price * item.quantity
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
                    await addToQueue('sales', saleId, 'create', checkoutPayload)

                    // Success Feedback
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
                    <Button
                        variant="outline"
                        className="h-12 w-12 rounded-xl"
                        onClick={() => setIsSkuModalOpen(true)}
                        title="Scan SKU (Hotkey: P)"
                    >
                        <Barcode className="w-5 h-5" />
                    </Button>
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
                                <div className="h-24 w-full bg-muted/20 rounded-lg mb-2 flex items-center justify-center text-muted-foreground">
                                    {/* Placeholder for Image */}
                                    <Zap className="w-8 h-8 opacity-20" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <h3 className="font-semibold truncate" title={product.name}>{product.name}</h3>
                                    <p className="text-xs text-muted-foreground truncate">{product.sku}</p>
                                </div>
                                <div className="mt-auto font-bold text-lg text-primary">
                                    {formatCurrency(product.price)}
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
                            cart.map((item) => (
                                <div key={item.product_id} className="bg-background border border-border p-3 rounded-lg flex gap-3 group">
                                    <div className="flex-1 min-w-0">
                                        <div className="font-medium truncate">{item.name}</div>
                                        <div className="text-xs text-muted-foreground">{formatCurrency(item.price)} x {item.quantity}</div>
                                    </div>
                                    <div className="flex flex-col items-end gap-1">
                                        <div className="font-bold">{formatCurrency(item.price * item.quantity)}</div>
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
                            ))
                        )}
                    </div>
                </div>

                <div className="p-4 border-t border-border bg-muted/10">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-muted-foreground">Subtotal</span>
                        <span className="font-semibold">{formatCurrency(totalAmount)}</span>
                    </div>
                    <div className="flex items-center justify-between mb-4 text-xl font-bold text-primary">
                        <span>Total</span>
                        <span>{formatCurrency(totalAmount)}</span>
                    </div>
                    <Button
                        size="lg"
                        className="w-full h-12 text-lg"
                        onClick={handleCheckout}
                        disabled={cart.length === 0 || isLoading}
                    >
                        {isLoading ? (
                            <Loader2 className="w-5 h-5 animate-spin mr-2" />
                        ) : (
                            <CreditCard className="w-5 h-5 mr-2" />
                        )}
                        {t('pos.checkout') || 'Checkout'}
                    </Button>
                </div>
            </div>

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
