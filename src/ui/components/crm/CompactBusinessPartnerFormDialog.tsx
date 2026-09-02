import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'

import type { BusinessPartnerRole, CurrencyCode } from '@/local-db'
import {
    AppDialog,
    AppDialogBody,
    AppDialogContent,
    AppDialogFooter,
    AppDialogHeader,
    AppDialogTitle,
    Button,
    Input,
    Label
} from '@/ui/components'

type CompactBusinessPartnerFormState = {
    partnerName: string
    phone: string
    address: string
    defaultCurrency: CurrencyCode
}

function createEmptyState(defaultCurrency: CurrencyCode): CompactBusinessPartnerFormState {
    return {
        partnerName: '',
        phone: '',
        address: '',
        defaultCurrency
    }
}

export interface CompactBusinessPartnerFormPayload {
    partnerName: string
    phone: string
    address: string
    /** Kept at zero because the compact flow does not collect credit limits. */
    creditLimit: number
    /** Supplied by the caller; intentionally not selectable in this dialog. */
    defaultCurrency: CurrencyCode
    /** Supplied by the caller; intentionally not selectable in this dialog. */
    role: BusinessPartnerRole
}

interface CompactBusinessPartnerFormDialogProps {
    isOpen: boolean
    onOpenChange: (open: boolean) => void
    /**
     * The integration must select the partner role. Keeping this required
     * prevents a compact form from creating an ambiguously typed partner.
     */
    role: BusinessPartnerRole
    /** The workspace/default currency to persist for the new partner. */
    defaultCurrency: CurrencyCode
    title?: string
    submitLabel?: string
    isSaving?: boolean
    onSubmit: (payload: CompactBusinessPartnerFormPayload) => void | Promise<void>
}

/**
 * Create-only partner form for integrations that already know the role and
 * default currency. It deliberately exposes only the minimum customer-facing
 * fields while returning the required computed values with the submission.
 */
export function CompactBusinessPartnerFormDialog({
    isOpen,
    onOpenChange,
    role,
    defaultCurrency,
    title,
    submitLabel,
    isSaving = false,
    onSubmit
}: CompactBusinessPartnerFormDialogProps) {
    const { t } = useTranslation()
    const [formState, setFormState] = useState<CompactBusinessPartnerFormState>(() => createEmptyState(defaultCurrency))
    const [isSubmitting, setIsSubmitting] = useState(false)
    const isProcessing = isSaving || isSubmitting

    useEffect(() => {
        if (isOpen) {
            setFormState(createEmptyState(defaultCurrency))
        }
    }, [defaultCurrency, isOpen])

    const canSubmit = Boolean(
        formState.partnerName.trim()
        && formState.phone.trim()
        && formState.address.trim()
    )

    const handleOpenChange = (open: boolean) => {
        if (!isProcessing) {
            onOpenChange(open)
        }
    }

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        if (!canSubmit || isProcessing) {
            return
        }

        setIsSubmitting(true)
        try {
            await onSubmit({
                partnerName: formState.partnerName.trim(),
                phone: formState.phone.trim(),
                address: formState.address.trim(),
                creditLimit: 0,
                defaultCurrency: formState.defaultCurrency,
                role
            })
        } finally {
            setIsSubmitting(false)
        }
    }

    return (
        <AppDialog open={isOpen} onOpenChange={handleOpenChange}>
            <AppDialogContent
                className="max-w-lg"
                showCloseButton={!isProcessing}
                onPointerDownOutside={(event) => {
                    if (isProcessing) event.preventDefault()
                }}
                onEscapeKeyDown={(event) => {
                    if (isProcessing) event.preventDefault()
                }}
            >
                <AppDialogHeader>
                    <AppDialogTitle>
                        {title || t('businessPartners.addPartner')}
                    </AppDialogTitle>
                </AppDialogHeader>

                <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
                    <AppDialogBody className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="compact-business-partner-name">
                                {t('businessPartners.form.partnerName')} <span className="text-destructive">*</span>
                            </Label>
                            <Input
                                id="compact-business-partner-name"
                                name="partnerName"
                                value={formState.partnerName}
                                onChange={(event) => setFormState((current) => ({
                                    ...current,
                                    partnerName: event.target.value
                                }))}
                                required
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="compact-business-partner-phone">
                                {t('customers.form.phone')} <span className="text-destructive">*</span>
                            </Label>
                            <Input
                                id="compact-business-partner-phone"
                                name="phone"
                                value={formState.phone}
                                onChange={(event) => setFormState((current) => ({
                                    ...current,
                                    phone: event.target.value
                                }))}
                                required
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="compact-business-partner-address">
                                {t('customers.form.address')} <span className="text-destructive">*</span>
                            </Label>
                            <Input
                                id="compact-business-partner-address"
                                name="address"
                                value={formState.address}
                                onChange={(event) => setFormState((current) => ({
                                    ...current,
                                    address: event.target.value
                                }))}
                                required
                            />
                        </div>
                    </AppDialogBody>

                    <AppDialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => handleOpenChange(false)}
                            disabled={isProcessing}
                        >
                            {t('common.cancel')}
                        </Button>
                        <Button type="submit" disabled={!canSubmit || isProcessing}>
                            {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            {isProcessing ? t('common.saving') : (submitLabel || t('common.create'))}
                        </Button>
                    </AppDialogFooter>
                </form>
            </AppDialogContent>
        </AppDialog>
    )
}
