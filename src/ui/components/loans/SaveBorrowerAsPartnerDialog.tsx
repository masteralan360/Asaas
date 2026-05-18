import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MapPin, Phone, SkipForward, UserPlus } from 'lucide-react'

import { createBusinessPartner, linkLoanToBusinessPartner, type CurrencyCode } from '@/local-db'
import { recalculateBusinessPartnerSummary } from '@/local-db/businessPartners'
import {
    Button,
    Dialog,
    DialogContent,
    useToast
} from '@/ui/components'

export interface SaveBorrowerAsPartnerData {
    loanId: string
    borrowerName: string
    borrowerPhone: string
    borrowerAddress: string
    settlementCurrency: CurrencyCode
}

const STORAGE_KEY = 'pending_save_partner_prompt'

export function usePendingSavePartnerPrompt() {
    const [data, setDataState] = useState<SaveBorrowerAsPartnerData | null>(() => {
        try {
            const stored = localStorage.getItem(STORAGE_KEY)
            return stored ? JSON.parse(stored) : null
        } catch { return null }
    })

    const setData = (d: SaveBorrowerAsPartnerData | null) => {
        setDataState(d)
        if (d) {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(d))
        } else {
            localStorage.removeItem(STORAGE_KEY)
        }
    }

    return [data, setData] as const
}

interface SaveBorrowerAsPartnerDialogProps {
    isOpen: boolean
    onOpenChange: (open: boolean) => void
    workspaceId: string
    data: SaveBorrowerAsPartnerData | null
    onComplete?: () => void
}

export function SaveBorrowerAsPartnerDialog({
    isOpen,
    onOpenChange,
    workspaceId,
    data,
    onComplete
}: SaveBorrowerAsPartnerDialogProps) {
    const { t } = useTranslation()
    const { toast } = useToast()
    const [isSaving, setIsSaving] = useState(false)

    const handleSave = async () => {
        if (!data || isSaving) return

        setIsSaving(true)
        try {
            const partner = await createBusinessPartner(workspaceId, {
                name: data.borrowerName,
                phone: data.borrowerPhone || undefined,
                address: data.borrowerAddress || undefined,
                defaultCurrency: data.settlementCurrency,
                role: 'customer',
                creditLimit: 0
            })

            await linkLoanToBusinessPartner(data.loanId, partner.id, partner.name)
            await recalculateBusinessPartnerSummary(workspaceId, partner.id)

            toast({
                title: t('messages.success') || 'Success',
                description: t('loans.messages.borrowerSavedAsPartner', {
                    defaultValue: 'Borrower saved as business partner and linked to loan'
                })
            })
            localStorage.removeItem(STORAGE_KEY)
            onOpenChange(false)
            onComplete?.()
        } catch (error: any) {
            toast({
                variant: 'destructive',
                title: t('messages.error') || 'Error',
                description: error?.message || t('loans.messages.borrowerSavePartnerFailed', {
                    defaultValue: 'Failed to save borrower as business partner'
                })
            })
        } finally {
            setIsSaving(false)
        }
    }

    const handleSkip = () => {
        localStorage.removeItem(STORAGE_KEY)
        onOpenChange(false)
        onComplete?.()
    }

    if (!data) return null

    const hasDetails = data.borrowerPhone || data.borrowerAddress

    return (
        <Dialog open={isOpen} onOpenChange={() => {}}>
            <DialogContent
                className="sm:max-w-md overflow-hidden [&>button:last-child]:hidden"
                onPointerDownOutside={(e) => e.preventDefault()}
                onEscapeKeyDown={(e) => e.preventDefault()}
            >
                {/* Hero area */}
                <div className="flex flex-col items-center gap-3 pb-1 pt-2 text-center">
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-4 ring-primary/5">
                        <UserPlus className="h-7 w-7" />
                    </div>
                    <div className="space-y-1.5">
                        <h3 className="text-lg font-semibold leading-tight">
                            {t('loans.saveAsPartnerTitle', { defaultValue: 'Save as Business Partner?' })}
                        </h3>
                        <p className="text-sm text-muted-foreground">
                            {t('loans.saveAsPartnerDescription', {
                                name: data.borrowerName,
                                defaultValue: '{{name}} is not linked to a business partner. Would you like to save them for future use?'
                            })}
                        </p>
                    </div>
                </div>

                {/* Borrower card */}
                <div className="rounded-xl border bg-muted/30 px-4 py-3">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/70">
                        {t('loans.borrowerDetails', { defaultValue: 'Borrower Details' })}
                    </div>
                    <div className="mt-2 space-y-1.5">
                        <div className="text-[15px] font-semibold leading-tight">{data.borrowerName}</div>
                        {hasDetails ? (
                            <div className="space-y-1">
                                {data.borrowerPhone ? (
                                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                        <Phone className="h-3.5 w-3.5 shrink-0" />
                                        <span>{data.borrowerPhone}</span>
                                    </div>
                                ) : null}
                                {data.borrowerAddress ? (
                                    <div className="flex items-start gap-2 text-sm text-muted-foreground">
                                        <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                        <span>{data.borrowerAddress}</span>
                                    </div>
                                ) : null}
                            </div>
                        ) : null}
                    </div>
                </div>

                {/* Actions */}
                <div className="flex flex-col gap-2 pt-1">
                    <Button type="button" className="w-full gap-2" onClick={handleSave} disabled={isSaving}>
                        <UserPlus className="h-4 w-4" />
                        {isSaving
                            ? (t('common.loading') || 'Loading...')
                            : (t('loans.saveAsPartner', { defaultValue: 'Save as Partner' }))}
                    </Button>
                    <button
                        type="button"
                        className="mx-auto py-1.5 text-sm text-muted-foreground underline-offset-4 hover:underline disabled:pointer-events-none disabled:opacity-50"
                        onClick={handleSkip}
                        disabled={isSaving}
                    >
                        {t('common.skip', { defaultValue: 'Skip' })}
                    </button>
                </div>
            </DialogContent>
        </Dialog>
    )
}
