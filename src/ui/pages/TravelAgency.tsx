import { useMemo, useState } from 'react'
import { CheckCircle2, Pencil, Plane, Plus, Search, Wallet } from 'lucide-react'
import { useLocation } from 'wouter'

import { useAuth } from '@/auth'
import { getTravelPaymentMethodLabel, getTravelReceiverLabel, getTravelSaleNet, getTravelSaleRevenue } from '@/lib/travelAgency'
import { formatCurrency } from '@/lib/utils'
import { setTravelAgencySalePaymentStatus, useTravelAgencySales } from '@/local-db'
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
    useToast
} from '@/ui/components'

export function TravelAgency() {
    const { user } = useAuth()
    const { features } = useWorkspace()
    const { toast } = useToast()
    const [, navigate] = useLocation()
    const sales = useTravelAgencySales(user?.workspaceId)
    const [query, setQuery] = useState('')
    const [updatingSaleId, setUpdatingSaleId] = useState<string | null>(null)

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
                || sale.travelPackages.some((travelPackage) => travelPackage.toLowerCase().includes(normalizedQuery))
                || touristNames.includes(normalizedQuery)
        })
    }, [query, sales])

    const totals = useMemo(() => {
        const revenue = filteredSales.reduce((sum, sale) => sum + getTravelSaleRevenue(sale), 0)
        const cost = filteredSales.reduce((sum, sale) => sum + sale.supplierCost, 0)
        const paidCount = filteredSales.filter((sale) => sale.isPaid).length
        const currencies = Array.from(new Set(filteredSales.map((sale) => sale.currency)))

        return {
            revenue,
            cost,
            net: revenue - cost,
            paidCount,
            summaryCurrency: currencies.length === 1 ? currencies[0] : null
        }
    }, [filteredSales])

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
                            Net {totals.summaryCurrency
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
                                    <TableHead>Payment</TableHead>
                                    <TableHead>Receiver</TableHead>
                                    <TableHead className="text-right">Revenue</TableHead>
                                    <TableHead className="text-right">Cost</TableHead>
                                    <TableHead className="text-right">Net</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead className="text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredSales.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={12} className="py-12 text-center text-muted-foreground">
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
                                                        {sale.touristCount > 1 ? 'Group booking' : 'Single traveller'}
                                                    </div>
                                                </TableCell>
                                                <TableCell>{sale.saleDate}</TableCell>
                                                <TableCell>{sale.touristCount}</TableCell>
                                                <TableCell className="max-w-[220px]">
                                                    <div className="truncate">{sale.travelPackages.join(', ') || 'No packages'}</div>
                                                </TableCell>
                                                <TableCell>{sale.supplierName || 'No supplier'}</TableCell>
                                                <TableCell>{getTravelPaymentMethodLabel(sale.paymentMethod)}</TableCell>
                                                <TableCell>{getTravelReceiverLabel(sale.receiver)}</TableCell>
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
                                                <TableCell>
                                                    <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${sale.isPaid ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                                                        {sale.isPaid ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Wallet className="h-3.5 w-3.5" />}
                                                        {sale.isPaid ? 'Paid' : 'Unpaid'}
                                                    </span>
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <div className="flex justify-end gap-2">
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            onClick={() => navigate(`/travel-agency/${sale.id}`)}
                                                        >
                                                            <Pencil className="h-4 w-4" />
                                                        </Button>
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
        </div>
    )
}
