import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    Button,
    Label,
    Textarea
} from '@/ui/components'

interface ReturnConfirmationModalProps {
    isOpen: boolean
    onClose: () => void
    onConfirm: (reason: string, quantity?: number) => void
    title: string
    message: string
    isItemReturn?: boolean
    maxQuantity?: number
    itemName?: string
}

export function ReturnConfirmationModal({
    isOpen,
    onClose,
    onConfirm,
    title,
    message,
    isItemReturn = false,
    maxQuantity = 1,
    itemName = ''
}: ReturnConfirmationModalProps) {
    const { t } = useTranslation()
    const [step, setStep] = useState<'confirmation' | 'quantity' | 'reason'>('confirmation')
    const [selectedReason, setSelectedReason] = useState<string>('customer_returned')
    const [otherReason, setOtherReason] = useState('')
    const [returnQuantity, setReturnQuantity] = useState<number>(1)

    const returnReasons = [
        { value: 'customer_returned', label: t('sales.return.reasons.customerReturned') || 'Customer returned item' },
        { value: 'wrong_item', label: t('sales.return.reasons.wrongItem') || 'Wrong item sold' },
        { value: 'pricing_mistake', label: t('sales.return.reasons.pricingMistake') || 'Pricing mistake' },
        { value: 'damaged_product', label: t('sales.return.reasons.damagedProduct') || 'Damaged product' },
        { value: 'duplicate_sale', label: t('sales.return.reasons.duplicateSale') || 'Duplicate sale' },
        { value: 'other', label: t('sales.return.reasons.other') || 'Other' }
    ]

    const handleContinue = () => {
        if (isItemReturn) {
            setStep('quantity')
        } else {
            setStep('reason')
        }
    }

    const handleQuantityContinue = () => {
        setStep('reason')
    }

    const handleReturnConfirm = () => {
        const finalReason = selectedReason === 'other' ? otherReason :
            returnReasons.find(r => r.value === selectedReason)?.label || selectedReason
        onConfirm(finalReason, isItemReturn ? returnQuantity : undefined)
        handleClose()
    }

    const handleClose = () => {
        setStep('confirmation')
        setSelectedReason('customer_returned')
        setOtherReason('')
        setReturnQuantity(1)
        onClose()
    }

    return (
        <Dialog open={isOpen} onOpenChange={handleClose}>
            <DialogContent className="max-w-xl dark:bg-zinc-950/90 backdrop-blur-xl border-zinc-200 dark:border-zinc-800 shadow-2xl animate-in fade-in zoom-in duration-300">
                <DialogHeader>
                    <DialogTitle className="text-2xl font-black text-foreground tracking-tight flex items-center gap-2">
                        <RotateCcw className="w-6 h-6 text-primary" />
                        {title}
                    </DialogTitle>
                </DialogHeader>

                <div className="py-4">
                    {step === 'confirmation' && (
                        <div className="space-y-6">
                            <p className="text-lg text-muted-foreground font-medium leading-relaxed">
                                {message}
                            </p>
                            {isItemReturn && itemName && (
                                <div className="bg-muted/50 p-4 rounded-2xl border border-border/50">
                                    <p className="text-sm font-bold text-foreground">
                                        {itemName}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                        {t('sales.return.availableToReturn') || 'Available to return'}: {maxQuantity}
                                    </p>
                                </div>
                            )}
                            <DialogFooter className="gap-3 sm:gap-0">
                                <Button variant="outline" onClick={handleClose} className="rounded-xl h-12 px-6 font-bold">
                                    {t('common.cancel') || 'Cancel'}
                                </Button>
                                <Button onClick={handleContinue} className="rounded-xl h-12 px-8 font-black shadow-lg shadow-primary/20">
                                    {t('common.continue') || 'Continue'}
                                </Button>
                            </DialogFooter>
                        </div>
                    )}

                    {step === 'quantity' && (
                        <div className="space-y-6">
                            <div className="space-y-4">
                                <Label className="text-lg font-bold text-foreground block">
                                    {t('sales.return.selectQuantity', { item: itemName }) || `How many "${itemName}" would you like to return?`}
                                </Label>
                                <div className="flex flex-col gap-2">
                                    <div className="relative">
                                        <input
                                            type="number"
                                            min="1"
                                            max={maxQuantity}
                                            value={returnQuantity}
                                            autoFocus
                                            onChange={(e) => setReturnQuantity(Math.min(Math.max(1, parseInt(e.target.value) || 1), maxQuantity))}
                                            className="w-full h-16 px-6 text-2xl font-black bg-muted/30 border-2 border-border/50 rounded-2xl focus:border-primary focus:ring-0 transition-all outline-none"
                                        />
                                        <div className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground font-bold">
                                            / {maxQuantity}
                                        </div>
                                    </div>
                                    <p className="text-sm text-muted-foreground font-medium px-2">
                                        {t('sales.return.maxQuantity', { max: maxQuantity }) || `Maximum allowed: ${maxQuantity}`}
                                    </p>
                                </div>
                                <div className="flex gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setReturnQuantity(1)}
                                        className="h-9 px-4 rounded-lg font-bold"
                                    >
                                        1
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setReturnQuantity(maxQuantity)}
                                        className="h-9 px-4 rounded-lg font-bold"
                                    >
                                        {t('common.all') || 'All'} ({maxQuantity})
                                    </Button>
                                    {maxQuantity > 2 && (
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => setReturnQuantity(Math.floor(maxQuantity / 2))}
                                            className="h-9 px-4 rounded-lg font-bold"
                                        >
                                            50%
                                        </Button>
                                    )}
                                </div>
                            </div>

                            <DialogFooter className="gap-3 sm:gap-0">
                                <Button variant="outline" onClick={() => setStep('confirmation')} className="rounded-xl h-12 px-6 font-bold">
                                    {t('common.back') || 'Back'}
                                </Button>
                                <Button onClick={handleQuantityContinue} className="rounded-xl h-12 px-8 font-black shadow-lg shadow-primary/20">
                                    {t('common.continue') || 'Continue'}
                                </Button>
                            </DialogFooter>
                        </div>
                    )}

                    {step === 'reason' && (
                        <div className="space-y-6">
                            <div className="space-y-4">
                                <Label className="text-lg font-bold text-foreground block">
                                    {t('sales.return.selectReason') || 'Specify reason for return'}
                                </Label>
                                <div className="grid grid-cols-1 gap-2">
                                    {returnReasons.map((reason) => (
                                        <label
                                            key={reason.value}
                                            className={cn(
                                                "flex items-center gap-3 p-4 rounded-2xl border-2 cursor-pointer transition-all",
                                                selectedReason === reason.value
                                                    ? "bg-primary/5 border-primary shadow-sm"
                                                    : "bg-muted/30 border-transparent hover:bg-muted/50 hover:border-border/50"
                                            )}
                                        >
                                            <input
                                                type="radio"
                                                name="returnReason"
                                                value={reason.value}
                                                checked={selectedReason === reason.value}
                                                onChange={(e) => setSelectedReason(e.target.value)}
                                                className="h-5 w-5 text-primary border-zinc-300 focus:ring-primary"
                                            />
                                            <span className="text-sm font-bold text-foreground">
                                                {reason.label}
                                            </span>
                                        </label>
                                    ))}
                                </div>
                            </div>

                            {selectedReason === 'other' && (
                                <div className="space-y-2 animate-in slide-in-from-top-2 duration-300">
                                    <Label htmlFor="other-reason" className="text-sm font-bold text-foreground px-1">
                                        {t('sales.return.specifyReason') || 'Please specify:'}
                                    </Label>
                                    <Textarea
                                        id="other-reason"
                                        value={otherReason}
                                        onChange={(e) => setOtherReason(e.target.value)}
                                        placeholder={t('sales.return.reasonPlaceholder') || 'Enter details...'}
                                        className="rounded-2xl border-2 focus:border-primary transition-all resize-none min-h-[100px]"
                                        maxLength={100}
                                    />
                                </div>
                            )}

                            <DialogFooter className="gap-3 sm:gap-0">
                                <Button variant="outline" onClick={() => setStep(isItemReturn ? 'quantity' : 'confirmation')} className="rounded-xl h-12 px-6 font-bold">
                                    {t('common.back') || 'Back'}
                                </Button>
                                <Button
                                    onClick={handleReturnConfirm}
                                    disabled={selectedReason === 'other' && !otherReason.trim()}
                                    className="rounded-xl h-12 px-8 font-black shadow-lg shadow-primary/20"
                                >
                                    {t('sales.return.confirmReturn') || 'Confirm Return'}
                                </Button>
                            </DialogFooter>
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    )
}
