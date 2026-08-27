import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link2, Loader2, ShoppingCart, UserRound } from 'lucide-react'

import type { CartItem } from '@/types'
import type { BusinessPartner, CurrencyCode, InstallmentFrequency, PaymentAccount } from '@/local-db'
import { formatCurrency } from '@/lib/utils'
import {
    ORDER_FINANCING_PAYMENT_METHODS,
    STANDARD_PAYMENT_METHODS,
    type PaymentMethodOption
} from '@/lib/paymentMethods'
import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Input,
    Label,
    Progress
} from '@/ui/components'
import { PartnerAutocompleteInput } from '@/ui/components/crm/PartnerAutocompleteInput'
import { PaymentMethodSelect } from '@/ui/components/payments/PaymentMethodSelect'
import { PaymentAccountSelector } from '@/ui/components/payments/PaymentAccountSelector'

export type QuickOrderCheckoutData = {
    customer: BusinessPartner
    paymentMethod: PaymentMethodOption
    installmentCount: number
    installmentFrequency: InstallmentFrequency
    firstDueDate: string | null
    paymentAccountId?: string | null
    paymentAccountNameSnapshot?: string | null
}

export type QuickOrderProgressStage = 'preparing' | 'creating' | 'reserving' | 'completing' | null

interface QuickOrderModalProps {
    isOpen: boolean
    onOpenChange: (open: boolean) => void
    workspaceId: string
    cart: CartItem[]
    totalAmount: number
    settlementCurrency: CurrencyCode
    iqdPreference: 'IQD' | '\u062f.\u0639'
    loansEnabled: boolean
    installmentsEnabled: boolean
    isSubmitting: boolean
    progressStage: QuickOrderProgressStage
    onSubmit: (data: QuickOrderCheckoutData) => Promise<void>
}

export function QuickOrderModal({
    isOpen,
    onOpenChange,
    workspaceId,
    cart,
    totalAmount,
    settlementCurrency,
    iqdPreference,
    loansEnabled,
    installmentsEnabled,
    isSubmitting,
    progressStage,
    onSubmit
}: QuickOrderModalProps) {
    const { t } = useTranslation()
    const [customerSearch, setCustomerSearch] = useState('')
    const [customer, setCustomer] = useState<BusinessPartner | null>(null)
    const [paymentMethod, setPaymentMethod] = useState<PaymentMethodOption>('cash')
    const [paymentAccount, setPaymentAccount] = useState<PaymentAccount | null>(null)
    const [firstDueDate, setFirstDueDate] = useState('')
    const [submitError, setSubmitError] = useState<string | null>(null)

    const paymentMethods = useMemo<PaymentMethodOption[]>(() => [
        ...STANDARD_PAYMENT_METHODS,
        ...(loansEnabled ? [ORDER_FINANCING_PAYMENT_METHODS[0]] : []),
        ...(installmentsEnabled ? [ORDER_FINANCING_PAYMENT_METHODS[1]] : [])
    ], [installmentsEnabled, loansEnabled])
    const isInstallmentBased = paymentMethod === 'installments'
    const progress = progressStage === 'preparing'
        ? { value: 15, label: t('pos.quickOrder.progress.preparing', { defaultValue: 'Preparing order details' }) }
        : progressStage === 'creating'
            ? { value: 40, label: t('pos.quickOrder.progress.creating', { defaultValue: 'Creating Sales Order' }) }
            : progressStage === 'reserving'
                ? { value: 65, label: t('pos.quickOrder.progress.reserving', { defaultValue: 'Validating stock and payment' }) }
                : progressStage === 'completing'
                    ? { value: 90, label: t('pos.quickOrder.progress.completing', { defaultValue: 'Completing order and inventory' }) }
                    : null

    useEffect(() => {
        if (!isOpen) return
        setCustomerSearch('')
        setCustomer(null)
        setPaymentMethod('cash')
        setPaymentAccount(null)
        setFirstDueDate('')
        setSubmitError(null)
    }, [isOpen])

    const handleSubmit = async () => {
        if (!customer) {
            setSubmitError(t('orders.form.selectCustomer', { defaultValue: 'Select a customer before saving this order.' }))
            return
        }
        if (!paymentMethod) {
            setSubmitError(t('orders.form.errors.paymentMethodRequired', { defaultValue: 'Select a payment method.' }))
            return
        }
        if (isInstallmentBased && !firstDueDate) {
            setSubmitError(t('orders.form.errors.firstInstallmentDueDateRequired', { defaultValue: 'Select the first installment due date.' }))
            return
        }

        setSubmitError(null)
        try {
            await onSubmit({
                customer,
                paymentMethod,
                installmentCount: 3,
                installmentFrequency: 'monthly',
                firstDueDate: isInstallmentBased ? firstDueDate : null,
                paymentAccountId: paymentAccount?.id ?? null,
                paymentAccountNameSnapshot: paymentAccount?.name ?? null,
            })
        } catch (error) {
            setSubmitError(error instanceof Error
                ? error.message
                : t('orders.form.errors.saveSalesFailed', { defaultValue: 'Failed to save sales order.' }))
        }
    }

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !isSubmitting && onOpenChange(open)}>
            <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto rounded-3xl p-0 shadow-2xl">
                <DialogHeader className="border-b bg-muted/30 px-6 py-5 text-start">
                    <DialogTitle className="flex items-center gap-2 text-xl">
                        <ShoppingCart className="h-5 w-5 text-primary" />
                        {t('pos.quickOrder.title', { defaultValue: 'Quick Order' })}
                    </DialogTitle>
                    <DialogDescription>
                        {t('pos.quickOrder.description', { defaultValue: 'Select the customer and payment method to complete this sales order.' })}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-5 px-6 py-5">
                    {isSubmitting && progress ? (
                        <div role="status" aria-live="polite" className="rounded-2xl border border-primary/20 bg-primary/5 p-4">
                            <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                                <span className="font-medium text-primary">{progress.label}</span>
                                <span className="tabular-nums text-xs font-semibold text-primary/80">{progress.value}%</span>
                            </div>
                            <Progress value={progress.value} className="h-2 bg-primary/15" indicatorClassName="bg-primary" />
                        </div>
                    ) : null}

                    <div className="grid gap-2">
                        <Label className="flex items-center gap-2">
                            <UserRound className="h-4 w-4 text-muted-foreground" />
                            {t('orders.form.customer', { defaultValue: 'Customer' })}
                            <span className="text-destructive">*</span>
                        </Label>
                        <PartnerAutocompleteInput
                            workspaceId={workspaceId}
                            roles={['customer']}
                            value={customerSearch}
                            onChange={(value) => {
                                setCustomerSearch(value)
                                setCustomer(null)
                            }}
                            onSelectPartner={(partner) => {
                                setCustomer(partner)
                                setCustomerSearch(partner.name)
                            }}
                            disabled={isSubmitting}
                            placeholder={t('orders.form.selectCustomer', { defaultValue: 'Select Customer' })}
                        />
                        {customer ? (
                            <div className="flex items-center gap-2 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2">
                                <Link2 className="h-4 w-4 shrink-0 text-primary" />
                                <div className="min-w-0">
                                    <div className="text-[11px] font-bold uppercase tracking-wide text-primary">
                                        {t('businessPartners.linked', { defaultValue: 'Linked' })} {t('businessPartners.title', { defaultValue: 'Business Partner' })}
                                    </div>
                                    <div className="truncate text-sm font-semibold">{customer.name}</div>
                                </div>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="ml-auto h-8 shrink-0 px-2 text-muted-foreground"
                                    onClick={() => {
                                        setCustomer(null)
                                        setCustomerSearch('')
                                    }}
                                    disabled={isSubmitting}
                                >
                                    {t('common.remove', { defaultValue: 'Remove' })}
                                </Button>
                            </div>
                        ) : null}
                    </div>

                    <div className="grid gap-2">
                        <Label htmlFor="quick-order-payment">
                            {t('pos.paymentMethod', { defaultValue: 'Payment Method' })}
                            <span className="text-destructive"> *</span>
                        </Label>
                        <PaymentMethodSelect
                            id="quick-order-payment"
                            value={paymentMethod}
                            onValueChange={setPaymentMethod}
                            onLinkedPaymentAccountSelect={setPaymentAccount}
                            workspaceId={workspaceId}
                            methods={paymentMethods}
                            disabled={isSubmitting}
                        />
                    </div>

                    {paymentMethod !== 'loan' && paymentMethod !== 'installments' ? (
                        <PaymentAccountSelector
                            workspaceId={workspaceId}
                            value={paymentAccount?.id ?? null}
                            onValueChange={setPaymentAccount}
                            disabled={isSubmitting}
                            cashDrawerOnly={paymentMethod === 'cash'}
                        />
                    ) : null}

                    {isInstallmentBased ? (
                        <div className="grid gap-2 rounded-2xl border bg-muted/20 p-4">
                            <Label htmlFor="quick-order-first-due-date">
                                {t('orders.form.firstInstallmentDueDate', { defaultValue: 'First installment due date' })}
                                <span className="text-destructive"> *</span>
                            </Label>
                            <Input
                                id="quick-order-first-due-date"
                                type="date"
                                value={firstDueDate}
                                onChange={(event) => setFirstDueDate(event.target.value)}
                                disabled={isSubmitting}
                            />
                            <p className="text-xs text-muted-foreground">
                                {t('pos.quickOrder.installmentHint', { defaultValue: 'This uses the normal monthly installment schedule.' })}
                            </p>
                        </div>
                    ) : null}

                    <div className="rounded-2xl border bg-muted/20 p-4">
                        <div className="mb-3 flex items-center justify-between gap-3">
                            <div>
                                <div className="text-sm font-semibold">{t('pos.quickOrder.summary', { defaultValue: 'Order Summary' })}</div>
                                <div className="text-xs text-muted-foreground">
                                    {t('pos.quickOrder.itemCount', { count: cart.length, defaultValue: '{{count}} cart items' })}
                                </div>
                            </div>
                            <div className="text-right text-base font-bold text-primary">
                                {formatCurrency(totalAmount, settlementCurrency, iqdPreference)}
                            </div>
                        </div>
                        <div className="max-h-32 space-y-2 overflow-y-auto pe-1">
                            {cart.map((item) => (
                                <div key={`${item.product_id}:${item.storageId || ''}`} className="flex justify-between gap-3 text-sm">
                                    <span className="min-w-0 truncate">{item.name}</span>
                                    <span className="shrink-0 text-muted-foreground">× {item.quantity}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {submitError ? (
                        <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                            {submitError}
                        </p>
                    ) : null}
                </div>

                <DialogFooter className="border-t bg-muted/10 px-6 py-4 sm:justify-between">
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
                        {t('common.cancel', { defaultValue: 'Cancel' })}
                    </Button>
                    <Button type="button" onClick={handleSubmit} disabled={isSubmitting || !customer || (isInstallmentBased && !firstDueDate)}>
                        {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        {t('pos.quickOrder.save', { defaultValue: 'Save Order' })}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
