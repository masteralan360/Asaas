import { useMemo, useState } from 'react'
import { Check, CheckCircle2, Eye, Pencil, Plane, Plus, Search, Wallet, Lock } from 'lucide-react'
import { useLocation } from 'wouter'

import { useAuth } from '@/auth'
import { useExchangeRate } from '@/context/ExchangeRateContext'
import { convertCurrencyAmountWithLiveRates } from '@/lib/orderCurrency'
import { getTravelPaymentMethodLabel, getTravelSaleNet, getTravelSaleRevenue, getTravelStatusLabel } from '@/lib/travelAgency'
import { formatCurrency } from '@/lib/utils'
import { setTravelAgencySalePaymentStatus, setTravelAgencySaleStatus, useTravelAgencySales, lockTravelSale } from '@/local-db'
import { useWorkspace } from '@/workspace'
import {
    Button,
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    Input,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
    useToast,
    Dialog,
    DialogContent,
    DialogHeader,
    DialogFooter,
    DialogTitle
} from '@/ui/components'

export function TravelAgency() {
    const { user } = useAuth()
    const { features } = useWorkspace()
    const { toast } = useToast()
    const [, navigate] = useLocation()
    const sales = useTravelAgencySales(user?.workspaceId)
    const [query, setQuery] = useState('')
    const [updatingSaleId, setUpdatingSaleId] = useState<string | null>(null)
    const [lockConfirm, setLockConfirm] = useState<{ isOpen: boolean; saleId: string }>({
        isOpen: false,
        saleId: ''
    })

    const filteredSales = useMemo(() => {
        const normalizedQuery = query.trim().toLowerCase()
        if (!normalizedQuery) {
            return sales
        }

        return sales.filter((sale) => {
            const touristNames = sale.tourists
                .map((tourist) => `${tourist.fullName} ${tourist.surname}`.trim().toLowerCase())
                .join(' ')

            return sale.saleNumber.toLowerCase().includes(normalizedQuery)
                || sale.supplierName?.toLowerCase().includes(normalizedQuery)
                || sale.groupName?.toLowerCase().includes(normalizedQuery)
                || sale.travelPackages.some((travelPackage) => travelPackage.toLowerCase().includes(normalizedQuery))
                || touristNames.includes(normalizedQuery)
        })
    }, [query, sales])

    const { exchangeData, eurRates, tryRates } = useExchangeRate()

    const liveRates = useMemo(() => ({
        exchangeData,
        eurRates,
        tryRates
    }), [exchangeData, eurRates, tryRates])

    const totals = useMemo(() => {
        const targetCurrency = features.default_currency
        const activeSales = filteredSales.filter(sale => sale.status !== 'draft')
        const revenue = activeSales.reduce((sum, sale) => {
            const saleRevenue = getTravelSaleRevenue(sale)
            return sum + convertCurrencyAmountWithLiveRates(saleRevenue, sale.currency, targetCurrency, liveRates)
        }, 0)
        const cost = activeSales.reduce((sum, sale) => {
            return sum + convertCurrencyAmountWithLiveRates(sale.supplierCost, sale.currency, targetCurrency, liveRates)
        }, 0)
        const paidCount = activeSales.filter((sale) => sale.isPaid).length

        return {
            revenue,
            cost,
            net: revenue - cost,
            paidCount,
            summaryCurrency: targetCurrency
        }
    }, [filteredSales, liveRates, features.default_currency])

    async function handleSetStatus(saleId: string, status: 'completed' | 'draft') {
        setUpdatingSaleId(saleId)
        try {
            await setTravelAgencySaleStatus(saleId, status)
            toast({
                title: status === 'completed' ? 'Sale marked as completed' : 'Sale marked as draft'
            })
        } catch (error: any) {
            toast({
                title: 'Error',
                description: error?.message || 'Failed to update status',
                variant: 'destructive'
            })
        } finally {
            setUpdatingSaleId(null)
        }
    }

    async function togglePaymentStatus(saleId: string, isPaid: boolean) {
        setUpdatingSaleId(saleId)
        try {
            await setTravelAgencySalePaymentStatus(saleId, { isPaid: !isPaid })
            toast({
                title: !isPaid ? 'Sale marked as paid' : 'Sale marked as unpaid'
            })
        } catch (error: any) {
            toast({
                title: 'Error',
                description: error?.message || 'Failed to update payment status',
                variant: 'destructive'
            })
        } finally {
            setUpdatingSaleId(null)
        }
    }

    async function handleLockConfirm() {
        if (!user?.workspaceId || !lockConfirm.saleId) return

        try {
            await lockTravelSale(lockConfirm.saleId)
            toast({ title: 'Sale locked successfully' })
        } catch (error: any) {
            toast({
                title: 'Error',
                description: error?.message || 'Failed to lock sale',
                variant: 'destructive'
            })
        } finally {
            setLockConfirm({ isOpen: false, saleId: '' })
        }
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                    <h1 className="flex items-center gap-2 text-2xl font-bold">
                        <Plane className="h-6 w-6 text-primary" />
                        Travel Agency
                    </h1>
                    <p className="text-muted-foreground">
                        Register travel sales, tourist groups, supplier cuts, and payment collection in one place.
                    </p>
                </div>
                <Button className="gap-2 self-start rounded-xl" onClick={() => navigate('/travel-agency/new')}>
                    <Plus className="h-4 w-4" />
                    New Sale
                </Button>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm text-muted-foreground">Collected Revenue</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-black">
                            {totals.summaryCurrency
                                ? formatCurrency(totals.revenue, totals.summaryCurrency, features.iqd_display_preference)
                                : 'Mixed currencies'}
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm text-muted-foreground">Supplier Cost</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-3xl font-black">
                            {totals.summaryCurrency
                                ? formatCurrency(totals.cost, totals.summaryCurrency, features.iqd_display_preference)
                                : 'Mixed currencies'}
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm text-muted-foreground">Paid Sales</CardTitle>
                    </CardHeader>
                    <CardContent className="flex items-center justify-between gap-4">
                        <div className="text-3xl font-black">{totals.paidCount}</div>
                        <div className="rounded-2xl bg-primary/10 px-4 py-2 text-sm font-semibold text-primary">
                            Commission {totals.summaryCurrency
                                ? formatCurrency(totals.net, totals.summaryCurrency, features.iqd_display_preference)
                                : 'Mixed currencies'}
                        </div>
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader className="gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <CardTitle>Travel Sales</CardTitle>
                    <div className="relative w-full max-w-sm">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder="Search sales, suppliers, packages, or tourists..."
                            className="pl-9"
                        />
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Sale</TableHead>
                                    <TableHead>Date</TableHead>
                                    <TableHead>Tourists</TableHead>
                                    <TableHead>Packages</TableHead>
                                    <TableHead>Supplier</TableHead>
                                    <TableHead>Payment Method</TableHead>
                                    <TableHead className="text-right">Revenue</TableHead>
                                    <TableHead className="text-right">Cost</TableHead>
                                    <TableHead className="text-right">Commission</TableHead>
                                    <TableHead className="text-center">Payment Status</TableHead>
                                    <TableHead className="text-center">Sale Status</TableHead>
                                    <TableHead className="text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredSales.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={11} className="py-12 text-center text-muted-foreground">
                                            No travel sales yet. Create the first one from the button above.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    filteredSales.map((sale) => {
                                        const revenue = getTravelSaleRevenue(sale)
                                        const net = getTravelSaleNet(sale)

                                        return (
                                            <TableRow key={sale.id}>
                                                <TableCell>
                                                    <div className="font-semibold">{sale.saleNumber}</div>
                                                    <div className="text-xs text-muted-foreground">
                                                        {sale.groupName ? sale.groupName : (sale.touristCount > 1 ? 'Group booking' : 'Single traveller')}
                                                    </div>
                                                </TableCell>
                                                <TableCell>{sale.saleDate}</TableCell>
                                                <TableCell>{sale.touristCount}</TableCell>
                                                <TableCell className="max-w-[220px]">
                                                    <div className="truncate">{sale.travelPackages.join(', ') || 'No packages'}</div>
                                                </TableCell>
                                                <TableCell>{sale.supplierName || 'No supplier'}</TableCell>
                                                <TableCell>{getTravelPaymentMethodLabel(sale.paymentMethod)}</TableCell>
                                                <TableCell className="text-right font-semibold">
                                                    {formatCurrency(revenue, sale.currency, features.iqd_display_preference)}
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    {formatCurrency(sale.supplierCost, sale.currency, features.iqd_display_preference)}
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <span className={net >= 0 ? 'text-emerald-600' : 'text-destructive'}>
                                                        {formatCurrency(net, sale.currency, features.iqd_display_preference)}
                                                    </span>
                                                </TableCell>
                                                <TableCell className="text-center">
                                                    <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${sale.isPaid ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                                                        {sale.isPaid ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Wallet className="h-3.5 w-3.5" />}
                                                        {sale.isPaid ? 'Paid' : 'Unpaid'}
                                                        {sale.isLocked && <Lock className="h-3.5 w-3.5 text-muted-foreground ml-1" />}
                                                    </span>
                                                </TableCell>
                                                <TableCell className="text-center">
                                                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border ${sale.status === 'completed' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-slate-50 text-slate-700 border-slate-200'}`}>
                                                        {getTravelStatusLabel(sale.status)}
                                                    </span>
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <div className="flex justify-end gap-2">
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            onClick={() => navigate(`/travel-agency/${sale.id}/view`)}
                                                            title="View Sale"
                                                        >
                                                            <Eye className="h-4 w-4" />
                                                        </Button>
                                                        {!sale.isLocked && (
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                onClick={() => navigate(`/travel-agency/${sale.id}`)}
                                                            >
                                                                <Pencil className="h-4 w-4" />
                                                            </Button>
                                                        )}
                                                        {sale.status === 'draft' && (
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                className="text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                                                                disabled={updatingSaleId === sale.id}
                                                                onClick={() => handleSetStatus(sale.id, 'completed')}
                                                                title="Mark as Completed"
                                                            >
                                                                <Check className="h-4 w-4" />
                                                            </Button>
                                                        )}
                                                        {sale.status === 'completed' && sale.isPaid && !sale.isLocked && (
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                className="text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                                                                onClick={() => setLockConfirm({ isOpen: true, saleId: sale.id })}
                                                                title="Lock Sale"
                                                            >
                                                                <Lock className="h-4 w-4" />
                                                            </Button>
                                                        )}
                                                        {!sale.isLocked && (
                                                            <Button
                                                                variant={sale.isPaid ? 'outline' : 'default'}
                                                                size="sm"
                                                                disabled={updatingSaleId === sale.id}
                                                                onClick={() => togglePaymentStatus(sale.id, sale.isPaid)}
                                                            >
                                                                {updatingSaleId === sale.id
                                                                    ? 'Saving...'
                                                                    : sale.isPaid
                                                                        ? 'Unpay'
                                                                        : 'Pay'}
                                                            </Button>
                                                        )}
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        )
                                    })
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>

            <Dialog open={lockConfirm.isOpen} onOpenChange={(open) => !open && setLockConfirm({ isOpen: false, saleId: '' })}>
                <DialogContent className="max-w-[400px] rounded-3xl p-0 overflow-hidden border-none shadow-2xl">
                    <div className="bg-gradient-to-b from-amber-500/10 to-transparent p-8 text-center space-y-4">
                        <div className="mx-auto w-16 h-16 bg-amber-500/20 rounded-2xl flex items-center justify-center mb-2">
                            <Lock className="w-8 h-8 text-amber-600" />
                        </div>
                        <DialogHeader>
                            <DialogTitle className="text-2xl font-black text-center">Lock Sale?</DialogTitle>
                        </DialogHeader>
                        <p className="text-muted-foreground text-sm font-medium leading-relaxed">
                            Locking this sale will prevent any changes to its data. This action cannot be undone.
                        </p>
                    </div>
                    <DialogFooter className="p-6 pt-2 grid grid-cols-2 gap-3 sm:justify-start">
                        <Button
                            variant="outline"
                            className="rounded-xl h-12 font-bold border-2"
                            onClick={() => setLockConfirm({ isOpen: false, saleId: '' })}
                        >
                            Cancel
                        </Button>
                        <Button
                            className="rounded-xl h-12 font-bold bg-amber-600 hover:bg-amber-700 shadow-lg shadow-amber-600/20"
                            onClick={handleLockConfirm}
                        >
                            Lock Now
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
