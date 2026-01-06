import { useState } from 'react'
import { useProducts, createProduct, updateProduct, deleteProduct, type Product } from '@/local-db'
import { formatCurrency } from '@/lib/utils'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
    Button,
    Input,
    Label,
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    Textarea,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/components'
import { Plus, Pencil, Trash2, Package, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/auth'

const CATEGORIES = ['Electronics', 'Clothing', 'Food', 'Furniture', 'Other']
const UNITS = ['pcs', 'kg', 'liter', 'box', 'pack']

type ProductFormData = Omit<Product, 'id' | 'createdAt' | 'updatedAt' | 'syncStatus' | 'lastSyncedAt' | 'version' | 'isDeleted'>

const initialFormData: ProductFormData = {
    sku: '',
    name: '',
    description: '',
    category: 'Other',
    price: 0,
    costPrice: 0,
    quantity: 0,
    minStockLevel: 10,
    unit: 'pcs',
    imageUrl: ''
}

export function Products() {
    const products = useProducts()
    const { t } = useTranslation()
    const { user } = useAuth()
    const canEdit = user?.role === 'admin' || user?.role === 'staff'
    const canDelete = user?.role === 'admin'
    const [search, setSearch] = useState('')
    const [isDialogOpen, setIsDialogOpen] = useState(false)
    const [editingProduct, setEditingProduct] = useState<Product | null>(null)
    const [formData, setFormData] = useState<ProductFormData>(initialFormData)
    const [isLoading, setIsLoading] = useState(false)

    const filteredProducts = products.filter(
        (p) =>
            p.name.toLowerCase().includes(search.toLowerCase()) ||
            p.sku.toLowerCase().includes(search.toLowerCase()) ||
            p.category.toLowerCase().includes(search.toLowerCase())
    )

    const handleOpenDialog = (product?: Product) => {
        if (product) {
            setEditingProduct(product)
            setFormData({
                sku: product.sku,
                name: product.name,
                description: product.description,
                category: product.category,
                price: product.price,
                costPrice: product.costPrice,
                quantity: product.quantity,
                minStockLevel: product.minStockLevel,
                unit: product.unit,
                imageUrl: product.imageUrl || ''
            })
        } else {
            setEditingProduct(null)
            setFormData(initialFormData)
        }
        setIsDialogOpen(true)
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setIsLoading(true)

        try {
            if (editingProduct) {
                await updateProduct(editingProduct.id, formData)
            } else {
                await createProduct(formData)
            }
            setIsDialogOpen(false)
            setFormData(initialFormData)
        } catch (error) {
            console.error('Error saving product:', error)
        } finally {
            setIsLoading(false)
        }
    }

    const handleDelete = async (id: string) => {
        if (confirm(t('products.messages.deleteConfirm') || 'Are you sure you want to delete this product?')) {
            await deleteProduct(id)
        }
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <Package className="w-6 h-6 text-primary" />
                        {t('products.title')}
                    </h1>
                    <p className="text-muted-foreground">{t('products.subtitle') || 'Manage your inventory'}</p>
                </div>
            </div>
            {canEdit && (
                <Button onClick={() => handleOpenDialog()}>
                    <Plus className="w-4 h-4" />
                    {t('products.addProduct')}
                </Button>
            )}

            {/* Search */}
            <div className="relative max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                    placeholder={t('products.searchPlaceholder') || "Search products..."}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-10"
                />
            </div>

            {/* Products Table */}
            <Card>
                <CardHeader>
                    <CardTitle>{t('products.title')}</CardTitle>
                </CardHeader>
                <CardContent>
                    {filteredProducts.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                            {products.length === 0 ? t('common.noData') : t('common.noData')}
                        </div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>{t('products.table.sku')}</TableHead>
                                    <TableHead>{t('products.table.name')}</TableHead>
                                    <TableHead>{t('products.table.category')}</TableHead>
                                    <TableHead className="text-right">{t('products.table.price')}</TableHead>
                                    <TableHead className="text-right">{t('products.table.stock')}</TableHead>
                                    {(canEdit || canDelete) && <TableHead className="text-right">{t('common.actions')}</TableHead>}
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredProducts.map((product) => (
                                    <TableRow key={product.id}>
                                        <TableCell className="font-mono text-sm">{product.sku}</TableCell>
                                        <TableCell className="font-medium">{product.name}</TableCell>
                                        <TableCell>{product.category}</TableCell>
                                        <TableCell className="text-right">{formatCurrency(product.price)}</TableCell>
                                        <TableCell className="text-right">
                                            <span className={product.quantity <= product.minStockLevel ? 'text-amber-500 font-medium' : ''}>
                                                {product.quantity} {product.unit}
                                            </span>
                                        </TableCell>
                                        {(canEdit || canDelete) && (
                                            <TableCell className="text-right">
                                                <div className="flex justify-end gap-2">
                                                    {canEdit && (
                                                        <Button variant="ghost" size="icon" onClick={() => handleOpenDialog(product)}>
                                                            <Pencil className="w-4 h-4" />
                                                        </Button>
                                                    )}
                                                    {canDelete && (
                                                        <Button variant="ghost" size="icon" onClick={() => handleDelete(product.id)}>
                                                            <Trash2 className="w-4 h-4 text-destructive" />
                                                        </Button>
                                                    )}
                                                </div>
                                            </TableCell>
                                        )}
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>

            {/* Add/Edit Dialog */}
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                    {/* ... Dialog Content ... */}
                    <DialogHeader>
                        <DialogTitle>{editingProduct ? t('common.edit') : t('products.addProduct')}</DialogTitle>
                    </DialogHeader>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="grid gap-4 md:grid-cols-2">
                            <div className="space-y-2">
                                <Label htmlFor="sku">{t('products.table.sku')}</Label>
                                <Input
                                    id="sku"
                                    value={formData.sku}
                                    onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
                                    placeholder="PRD-001"
                                    required
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="name">{t('products.table.name')}</Label>
                                <Input
                                    id="name"
                                    value={formData.name}
                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    placeholder={t('products.form.name') || "Product name"}
                                    required
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="description">{t('products.form.description')}</Label>
                            <Textarea
                                id="description"
                                value={formData.description}
                                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                placeholder={t('products.form.description') || "Product description..."}
                                rows={3}
                            />
                        </div>

                        <div className="grid gap-4 md:grid-cols-2">
                            <div className="space-y-2">
                                <Label htmlFor="category">{t('products.table.category')}</Label>
                                <Select value={formData.category} onValueChange={(value) => setFormData({ ...formData, category: value })}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {CATEGORIES.map((cat) => (
                                            <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="unit">{t('products.form.unit')}</Label>
                                <Select value={formData.unit} onValueChange={(value) => setFormData({ ...formData, unit: value })}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {UNITS.map((unit) => (
                                            <SelectItem key={unit} value={unit}>{unit}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        <div className="grid gap-4 md:grid-cols-2">
                            <div className="space-y-2">
                                <Label htmlFor="price">{t('products.table.price')}</Label>
                                <Input
                                    id="price"
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={formData.price}
                                    onChange={(e) => setFormData({ ...formData, price: parseFloat(e.target.value) || 0 })}
                                    required
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="costPrice">{t('products.form.cost')}</Label>
                                <Input
                                    id="costPrice"
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={formData.costPrice}
                                    onChange={(e) => setFormData({ ...formData, costPrice: parseFloat(e.target.value) || 0 })}
                                    required
                                />
                            </div>
                        </div>

                        <div className="grid gap-4 md:grid-cols-2">
                            <div className="space-y-2">
                                <Label htmlFor="quantity">{t('products.form.stock')}</Label>
                                <Input
                                    id="quantity"
                                    type="number"
                                    min="0"
                                    value={formData.quantity}
                                    onChange={(e) => setFormData({ ...formData, quantity: parseInt(e.target.value) || 0 })}
                                    required
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="minStockLevel">{t('products.form.minStock')}</Label>
                                <Input
                                    id="minStockLevel"
                                    type="number"
                                    min="0"
                                    value={formData.minStockLevel}
                                    onChange={(e) => setFormData({ ...formData, minStockLevel: parseInt(e.target.value) || 0 })}
                                    required
                                />
                            </div>
                        </div>

                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                                {t('common.cancel')}
                            </Button>
                            <Button type="submit" disabled={isLoading}>
                                {isLoading ? t('common.loading') : editingProduct ? t('common.save') : t('common.create')}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    )
}
