import { useEffect, useMemo, useState } from 'react'
import { useLocation, useRoute } from 'wouter'
import { BriefcaseBusiness, Pencil, Plus, Search, Trash2 } from 'lucide-react'

import { useAuth } from '@/auth'
import {
    createProduct,
    deleteProduct,
    updateProduct,
    useCategories,
    useProduct,
    useProducts,
    type CurrencyCode,
    type Product
} from '@/local-db'
import { isService } from '@/lib/catalogItem'
import { formatCurrency } from '@/lib/utils'
import { useWorkspace } from '@/workspace'
import {
    Button,
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CurrencySelector,
    DeleteConfirmationModal,
    Input,
    Label,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Switch,
    Textarea,
    useToast
} from '@/ui/components'

type ServiceFormState = {
    name: string
    description: string
    categoryId: string
    price: string
    costPrice: string
    currency: CurrencyCode
    imageUrl: string
    canBeReturned: boolean
    returnRules: string
}

const emptyForm = (currency: CurrencyCode): ServiceFormState => ({
    name: '', description: '', categoryId: '', price: '', costPrice: '', currency,
    imageUrl: '', canBeReturned: true, returnRules: ''
})

function toForm(product: Product): ServiceFormState {
    return {
        name: product.name,
        description: product.description || '',
        categoryId: product.categoryId || '',
        price: String(product.price ?? 0),
        costPrice: product.costPrice == null ? '' : String(product.costPrice),
        currency: product.currency,
        imageUrl: product.imageUrl || '',
        canBeReturned: product.canBeReturned ?? true,
        returnRules: product.returnRules || ''
    }
}

export function Services() {
    const { user } = useAuth()
    const { features } = useWorkspace()
    const [, navigate] = useLocation()
    const { toast } = useToast()
    const products = useProducts(user?.workspaceId, { syncBarcodeCache: false })
    const categories = useCategories(user?.workspaceId)
    const [search, setSearch] = useState('')
    const [deleteTarget, setDeleteTarget] = useState<Product | null>(null)
    const canEdit = user?.role === 'admin' || user?.role === 'staff'

    const services = useMemo(() => products
        .filter(isService)
        .filter((service) => {
            const query = search.trim().toLocaleLowerCase()
            return !query
                || service.name.toLocaleLowerCase().includes(query)
                || service.description?.toLocaleLowerCase().includes(query)
                || categories.find((category) => category.id === service.categoryId)?.name.toLocaleLowerCase().includes(query)
        })
        .sort((left, right) => left.name.localeCompare(right.name)), [categories, products, search])

    return (
        <div className="space-y-6">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                <div>
                    <h1 className="flex items-center gap-2 text-2xl font-bold"><BriefcaseBusiness className="h-6 w-6 text-primary" />Services</h1>
                    <p className="text-muted-foreground">Manage non-inventory items that can be sold and returned.</p>
                </div>
                {canEdit && <Button onClick={() => navigate('/services/new')}><Plus className="h-4 w-4" />Add Service</Button>}
            </div>

            <div className="relative max-w-md"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} className="pl-9" placeholder="Search services" /></div>

            <Card>
                <CardContent className="p-0">
                    {services.length === 0 ? <div className="py-14 text-center text-muted-foreground">No services yet.</div> : (
                        <div className="divide-y">
                            {services.map((service) => (
                                <div key={service.id} className="flex items-center gap-4 p-4">
                                    <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-primary/10 text-primary">
                                        {service.imageUrl ? <img src={service.imageUrl} alt="" className="h-full w-full object-cover" /> : <BriefcaseBusiness className="h-5 w-5" />}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2"><span className="truncate font-semibold">{service.name}</span><span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">Service</span></div>
                                        <div className="truncate text-sm text-muted-foreground">{categories.find((category) => category.id === service.categoryId)?.name || 'No category'}</div>
                                    </div>
                                    <div className="text-right font-semibold">{formatCurrency(service.price, service.currency, features.iqd_display_preference)}</div>
                                    <Button variant="ghost" size="icon" onClick={() => navigate(`/services/${service.id}`)}><Pencil className="h-4 w-4" /></Button>
                                    {canEdit && <Button variant="ghost" size="icon" className="text-destructive" onClick={() => setDeleteTarget(service)}><Trash2 className="h-4 w-4" /></Button>}
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>

            <DeleteConfirmationModal
                isOpen={!!deleteTarget}
                onClose={() => setDeleteTarget(null)}
                title="Delete Service"
                description="This removes the service from the catalog. Existing sale history is kept."
                itemName={deleteTarget?.name || ''}
                onConfirm={() => {
                    if (!deleteTarget) return
                    void deleteProduct(deleteTarget.id).then(() => setDeleteTarget(null)).catch((error) => toast({ variant: 'destructive', title: 'Could not delete service', description: String(error) }))
                }}
            />
        </div>
    )
}

export function ServiceFormPage() {
    const { user } = useAuth()
    const { features } = useWorkspace()
    const [, navigate] = useLocation()
    const [, params] = useRoute('/services/:serviceId')
    const { toast } = useToast()
    const serviceId = params?.serviceId || ''
    const editing = Boolean(serviceId && serviceId !== 'new')
    const product = useProduct(editing ? serviceId : undefined)
    const categories = useCategories(user?.workspaceId)
    const [form, setForm] = useState<ServiceFormState>(() => emptyForm(features.default_currency))
    const [saving, setSaving] = useState(false)

    useEffect(() => {
        if (editing && product && isService(product)) setForm(toForm(product))
    }, [editing, product])

    useEffect(() => {
        if (editing && product && !isService(product)) navigate('/services')
    }, [editing, navigate, product])

    if (editing && product && !isService(product)) {
        return null
    }

    const save = async (event: React.FormEvent) => {
        event.preventDefault()
        if (!user?.workspaceId || !form.name.trim()) return
        setSaving(true)
        try {
            const category = categories.find((entry) => entry.id === form.categoryId)
            const data = {
                isService: true,
                name: form.name.trim(), description: form.description.trim(), categoryId: form.categoryId || null,
                category: category?.name || null, price: Number(form.price) || 0,
                costPrice: form.costPrice.trim() === '' ? null : Number(form.costPrice), currency: form.currency,
                imageUrl: form.imageUrl.trim() || undefined, canBeReturned: form.canBeReturned,
                returnRules: form.returnRules.trim() || undefined,
                // Required by the shared local Product type; createProduct deliberately strips these for services.
                sku: '', unit: '', quantity: 0, minStockLevel: 0, storageId: null, parentProductId: null,
                createdBy: user.id
            }
            if (editing && product) await updateProduct(product.id, data)
            else await createProduct(user.workspaceId, data)
            navigate('/services')
        } catch (error) {
            toast({ variant: 'destructive', title: 'Could not save service', description: error instanceof Error ? error.message : String(error) })
        } finally { setSaving(false) }
    }

    return <form onSubmit={save} className="mx-auto max-w-3xl space-y-5">
        <div className="flex items-center justify-between"><div><h1 className="text-2xl font-bold">{editing ? 'Edit Service' : 'Add Service'}</h1><p className="text-muted-foreground">Services have no SKU, unit, stock, or physical storage.</p></div><Button type="button" variant="outline" onClick={() => navigate('/services')}>Cancel</Button></div>
        <Card><CardHeader><CardTitle>Service details</CardTitle></CardHeader><CardContent className="grid gap-5 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2"><Label>Name</Label><Input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></div>
            <div className="space-y-2 md:col-span-2"><Label>Description</Label><Textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></div>
            <div className="space-y-2"><Label>Category</Label><Select value={form.categoryId || '__none'} onValueChange={(value) => setForm({ ...form, categoryId: value === '__none' ? '' : value })}><SelectTrigger><SelectValue placeholder="No category" /></SelectTrigger><SelectContent><SelectItem value="__none">No category</SelectItem>{categories.map((category) => <SelectItem key={category.id} value={category.id}>{category.name}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-2"><CurrencySelector label="Currency" value={form.currency} onChange={(currency) => setForm({ ...form, currency })} iqdDisplayPreference={features.iqd_display_preference} /></div>
            <div className="space-y-2"><Label>Selling price</Label><Input required type="number" min="0" step="0.01" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} /></div>
            <div className="space-y-2"><Label>Cost price</Label><Input type="number" min="0" step="0.01" value={form.costPrice} onChange={(event) => setForm({ ...form, costPrice: event.target.value })} /></div>
            <div className="space-y-2 md:col-span-2"><Label>Image URL</Label><Input value={form.imageUrl} onChange={(event) => setForm({ ...form, imageUrl: event.target.value })} /></div>
            <div className="flex items-center justify-between rounded-xl border p-4 md:col-span-2"><div><Label>Can be returned</Label><p className="text-sm text-muted-foreground">Returns reverse the sale financially without restocking.</p></div><Switch checked={form.canBeReturned} onCheckedChange={(canBeReturned) => setForm({ ...form, canBeReturned })} /></div>
            {form.canBeReturned && <div className="space-y-2 md:col-span-2"><Label>Return rules</Label><Textarea value={form.returnRules} onChange={(event) => setForm({ ...form, returnRules: event.target.value })} /></div>}
        </CardContent></Card>
        <Button disabled={saving} type="submit" className="w-full">{saving ? 'Saving…' : 'Save Service'}</Button>
    </form>
}
