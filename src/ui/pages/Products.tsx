import { useState } from 'react'
import { useProducts, createProduct, updateProduct, deleteProduct, useCategories, createCategory, updateCategory, deleteCategory, type Product, type Category } from '@/local-db'
import type { CurrencyCode } from '@/local-db/models'
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
    SelectValue,
    CurrencySelector
} from '@/ui/components'
import { Plus, Pencil, Trash2, Package, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/auth'
import { useWorkspace } from '@/workspace'

const UNITS = ['pcs', 'kg', 'liter', 'box', 'pack']

type ProductFormData = {
    sku: string
    name: string
    description: string
    categoryId: string | undefined
    price: number | ''
    costPrice: number | ''
    quantity: number | ''
    minStockLevel: number | ''
    unit: string
    currency: CurrencyCode
    imageUrl: string
}

const initialFormData: ProductFormData = {
    sku: '',
    name: '',
    description: '',
    categoryId: undefined,
    price: '',
    costPrice: '',
    quantity: '',
    minStockLevel: 10,
    unit: 'pcs',
    currency: 'usd',
    imageUrl: ''
}

export function Products() {
    const { user } = useAuth()
    const products = useProducts(user?.workspaceId)
    const categories = useCategories(user?.workspaceId)
    const { features } = useWorkspace()
    const { t } = useTranslation()
    const canEdit = user?.role === 'admin' || user?.role === 'staff'
    const canDelete = user?.role === 'admin'
    const workspaceId = user?.workspaceId || ''
    const [search, setSearch] = useState('')
    const [isDialogOpen, setIsDialogOpen] = useState(false)
    const [isCategoryDialogOpen, setIsCategoryDialogOpen] = useState(false)
    const [editingProduct, setEditingProduct] = useState<Product | null>(null)
    const [editingCategory, setEditingCategory] = useState<Category | null>(null)
    const [formData, setFormData] = useState<ProductFormData>(initialFormData)
    const [categoryFormData, setCategoryFormData] = useState({ name: '', description: '' })
    const [isLoading, setIsLoading] = useState(false)

    const getCategoryName = (id?: string) => {
        if (!id) return t('categories.noCategory')
        const cat = categories.find(c => c.id === id)
        return cat?.name || t('categories.deletedCategory')
    }

    const filteredProducts = products.filter(
        (p) =>
            p.name.toLowerCase().includes(search.toLowerCase()) ||
            p.sku.toLowerCase().includes(search.toLowerCase()) ||
            getCategoryName(p.categoryId).toLowerCase().includes(search.toLowerCase())
    )

    const handleOpenDialog = (product?: Product) => {
        if (product) {
            setEditingProduct(product)
            setFormData({
                sku: product.sku,
                name: product.name,
                description: product.description,
                categoryId: product.categoryId,
                price: product.price,
                costPrice: product.costPrice,
                quantity: product.quantity,
                minStockLevel: product.minStockLevel,
                unit: product.unit,
                currency: product.currency,
                imageUrl: product.imageUrl || ''
            })
        } else {
            setEditingProduct(null)
            setFormData({
                ...initialFormData,
                currency: features.default_currency
            })
        }
        setIsDialogOpen(true)
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setIsLoading(true)

        try {
            const dataToSave = {
                ...formData,
                price: Number(formData.price) || 0,
                costPrice: Number(formData.costPrice) || 0,
                quantity: Number(formData.quantity) || 0,
                minStockLevel: Number(formData.minStockLevel) || 0
            }

            if (editingProduct) {
                await updateProduct(editingProduct.id, dataToSave)
            } else {
                await createProduct(workspaceId, dataToSave)
            }
            setIsDialogOpen(false)
            setFormData(initialFormData)
        } catch (error) {
            console.error('Error saving product:', error)
        } finally {
            setIsLoading(false)
        }
    }

    const handleCategorySubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setIsLoading(true)
        try {
            if (editingCategory) {
                await updateCategory(editingCategory.id, categoryFormData)
            } else {
                await createCategory(workspaceId, categoryFormData)
            }
            setIsCategoryDialogOpen(false)
            setCategoryFormData({ name: '', description: '' })
        } catch (error) {
            console.error('Error saving category:', error)
        } finally {
            setIsLoading(false)
        }
    }

    const handleOpenCategoryDialog = (category?: Category) => {
        if (category) {
            setEditingCategory(category)
            setCategoryFormData({ name: category.name, description: category.description || '' })
        } else {
            setEditingCategory(null)
            setCategoryFormData({ name: '', description: '' })
        }
        setIsCategoryDialogOpen(true)
    }

    const handleDeleteCategory = async (id: string) => {
        if (confirm(t('categories.messages.deleteConfirm'))) {
            await deleteCategory(id)
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
                {canEdit && (
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={() => setIsCategoryDialogOpen(true)}>
                            <Plus className="w-4 h-4" />
                            {t('products.addCategory')}
                        </Button>
                        <Button onClick={() => handleOpenDialog()}>
                            <Plus className="w-4 h-4" />
                            {t('products.addProduct')}
                        </Button>
                    </div>
                )}
            </div>

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
                                        <TableCell>{getCategoryName(product.categoryId)}</TableCell>
                                        <TableCell className="text-right">
                                            {formatCurrency(product.price, product.currency, features.iqd_display_preference)}
                                        </TableCell>
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
                                <Select value={formData.categoryId || 'none'} onValueChange={(value) => setFormData({ ...formData, categoryId: value === 'none' ? undefined : value })}>
                                    <SelectTrigger>
                                        <SelectValue placeholder={t('categories.noCategory')} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="none">{t('categories.noCategory')}</SelectItem>
                                        {categories.map((cat) => (
                                            <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
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

                        <div className="grid gap-4 md:grid-cols-3">
                            <div className="space-y-2">
                                <Label htmlFor="price">{t('products.table.price')}</Label>
                                <Input
                                    id="price"
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={formData.price}
                                    onChange={(e) => setFormData({ ...formData, price: e.target.value === '' ? '' : parseFloat(e.target.value) })}
                                    placeholder="0.00"
                                    required
                                />
                            </div>
                            <div className="space-y-2">
                                <CurrencySelector
                                    label={t('products.form.currency') || "Currency"}
                                    value={formData.currency}
                                    onChange={(val) => setFormData({ ...formData, currency: val })}
                                    iqdDisplayPreference={features.iqd_display_preference}
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
                                    onChange={(e) => setFormData({ ...formData, costPrice: e.target.value === '' ? '' : parseFloat(e.target.value) })}
                                    placeholder="0.00"
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
                                    onChange={(e) => setFormData({ ...formData, quantity: e.target.value === '' ? '' : parseInt(e.target.value) })}
                                    placeholder="0"
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
                                    onChange={(e) => setFormData({ ...formData, minStockLevel: e.target.value === '' ? '' : parseInt(e.target.value) })}
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
            {/* Category Dialog */}
            <Dialog open={isCategoryDialogOpen} onOpenChange={setIsCategoryDialogOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>{editingCategory ? t('categories.editCategory') : t('categories.addCategory')}</DialogTitle>
                    </DialogHeader>
                    <form onSubmit={handleCategorySubmit} className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="cat-name">{t('categories.form.name')}</Label>
                            <Input
                                id="cat-name"
                                value={categoryFormData.name}
                                onChange={(e) => setCategoryFormData({ ...categoryFormData, name: e.target.value })}
                                placeholder={t('categories.form.name')}
                                required
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="cat-description">{t('categories.form.description')}</Label>
                            <Textarea
                                id="cat-description"
                                value={categoryFormData.description}
                                onChange={(e) => setCategoryFormData({ ...categoryFormData, description: e.target.value })}
                                placeholder={t('categories.form.description')}
                                rows={3}
                            />
                        </div>

                        {/* Category List (Management) */}
                        {!editingCategory && categories.length > 0 && (
                            <div className="pt-4 border-t">
                                <Label className="mb-2 block text-sm font-medium">Existing Categories</Label>
                                <div className="space-y-2 max-h-40 overflow-y-auto pr-2">
                                    {categories.map((cat) => (
                                        <div key={cat.id} className="flex items-center justify-between p-2 bg-muted/50 rounded-md group">
                                            <span className="text-sm">{cat.name}</span>
                                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleOpenCategoryDialog(cat)}>
                                                    <Pencil className="h-3 w-3" />
                                                </Button>
                                                <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => handleDeleteCategory(cat.id)}>
                                                    <Trash2 className="h-3 w-3" />
                                                </Button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        <DialogFooter>
                            {editingCategory && (
                                <Button type="button" variant="ghost" onClick={() => setEditingCategory(null)}>
                                    Cancel Edit
                                </Button>
                            )}
                            <Button type="submit" disabled={isLoading}>
                                {isLoading ? t('common.loading') : editingCategory ? t('common.save') : t('common.create')}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    )
}
