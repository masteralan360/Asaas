import { AlertTriangle, FileText, Printer, Receipt } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { StoredCustomTemplateRow } from '@/lib/customTemplates'
import type { PrintFormat } from '@/services/pdfGenerator'
import { useWorkspace } from '@/workspace'
import { Button } from '@/ui/components/button'
import {
    SmallDialog,
    SmallDialogContent,
    SmallDialogHeader,
    SmallDialogTitle
} from '@/ui/components/small-dialog'

export type PrintSelectionNativeOption = {
    format: PrintFormat
    label: string
    description: string
    /** Distinguishes native layouts that use the same paper format. */
    nativeTemplateKey?: string
    /** Marks an option that prints returned items only. */
    returned?: boolean
}

export type PrintSelectionTemplateOption = {
    format: PrintFormat
    template: StoredCustomTemplateRow
    label: string
    description?: string
    primary?: boolean
    /** Marks a saved layout dedicated to partial and fully returned orders. */
    returned?: boolean
    disabled?: boolean
    warning?: string
}

interface PrintSelectionModalProps {
    isOpen: boolean
    onClose: () => void
    onSelect: (format: PrintFormat, template?: StoredCustomTemplateRow, nativeTemplateKey?: string) => void
    nativeOptions: PrintSelectionNativeOption[]
    templateOptions?: PrintSelectionTemplateOption[]
    onCreateReturnTemplate?: () => void
}

function PrintOptionIcon({ format, custom = false }: { format: PrintFormat; custom?: boolean }) {
    if (format === 'receipt') {
        return <Receipt className={`h-6 w-6 ${custom ? 'text-primary' : 'text-foreground'}`} />
    }

    return <FileText className={`h-6 w-6 ${custom ? 'text-primary' : 'text-foreground'}`} />
}

function PrintOptionBadges({ primary = false, returned = false }: { primary?: boolean; returned?: boolean }) {
    const { t } = useTranslation()
    if (!primary && !returned) return null

    return (
        <span className="absolute end-2 top-2 flex flex-col items-end gap-1">
            {primary ? (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                    {t('customTemplates.primary', { defaultValue: 'Primary' })}
                </span>
            ) : null}
            {returned ? (
                <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-[10px] font-bold text-rose-700 dark:text-rose-300">
                    {t('orders.return.returnedStatus', { defaultValue: 'Returned' })}
                </span>
            ) : null}
        </span>
    )
}

export function PrintSelectionModal({
    isOpen,
    onClose,
    onSelect,
    nativeOptions,
    templateOptions = [],
    onCreateReturnTemplate
}: PrintSelectionModalProps) {
    const { t } = useTranslation()
    const { hasCapability } = useWorkspace()
    const canUseA4Invoices = hasCapability('a4PdfInvoices')
    const visibleNativeOptions = nativeOptions.filter((option) =>
        option.format !== 'a4' || canUseA4Invoices
    )
    const visibleTemplateOptions = templateOptions.filter((option) =>
        option.format !== 'a4' || canUseA4Invoices
    )
    // A saved return layout is the destination of the creation action, so do not
    // offer to create another one once the workspace already has one available.
    const shouldShowCreateReturnTemplate = Boolean(onCreateReturnTemplate)
        && !templateOptions.some((option) => option.returned)
    const visibleOptionCount = visibleNativeOptions.length
        + visibleTemplateOptions.length
        + (shouldShowCreateReturnTemplate ? 1 : 0)

    return (
        <SmallDialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <SmallDialogContent>
                <SmallDialogHeader>
                    <SmallDialogTitle className="flex items-center gap-2">
                        <Printer className="h-5 w-5 text-primary" />
                        {t('common.print', { defaultValue: 'Select Print' })}
                    </SmallDialogTitle>
                </SmallDialogHeader>

                <div className="grid max-h-[65vh] grid-cols-1 gap-4 overflow-y-auto py-4 sm:grid-cols-2">
                    {visibleNativeOptions.length === 0 && visibleTemplateOptions.length === 0 ? (
                        <div className="col-span-full rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                            {t('print.noFormatsAvailable', {
                                defaultValue: 'No print formats are available for this workspace.'
                            })}
                        </div>
                    ) : null}
                    {visibleNativeOptions.map((option) => (
                        <Button
                            key={`native-${option.format}-${option.label}`}
                            variant="outline"
                            className={`relative flex h-32 min-w-0 flex-col gap-3 overflow-hidden whitespace-normal px-3 py-3 text-center transition-all hover:border-primary hover:bg-primary/5 ${
                                visibleOptionCount === 1 ? 'sm:col-span-2' : ''
                            }`}
                            onClick={() => onSelect(option.format, undefined, option.nativeTemplateKey)}
                        >
                            <PrintOptionBadges returned={option.returned} />
                            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary">
                                <PrintOptionIcon format={option.format} />
                            </div>
                            <div className="w-full min-w-0 space-y-1 overflow-hidden">
                                <div className="truncate font-bold">{option.label}</div>
                                <div className="line-clamp-2 break-words text-center text-xs leading-4 text-muted-foreground">
                                    {option.description}
                                </div>
                            </div>
                        </Button>
                    ))}

                    {shouldShowCreateReturnTemplate ? (
                        <Button
                            variant="outline"
                            className={`relative flex h-32 min-w-0 flex-col gap-3 overflow-hidden whitespace-normal border-dashed px-3 py-3 text-center transition-all hover:border-primary hover:bg-primary/5 ${
                                visibleOptionCount === 1 ? 'sm:col-span-2' : ''
                            }`}
                            onClick={onCreateReturnTemplate}
                        >
                            <PrintOptionBadges returned />
                            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-500/10">
                                <FileText className="h-6 w-6 text-rose-700 dark:text-rose-300" />
                            </div>
                            <div className="w-full min-w-0 space-y-1 overflow-hidden">
                                <div className="truncate font-bold">
                                    {t('orders.print.createReturnTemplate', { defaultValue: 'Create return template' })}
                                </div>
                                <div className="line-clamp-2 break-words text-center text-xs leading-4 text-muted-foreground">
                                    {t('orders.print.createReturnTemplateDescription', {
                                        defaultValue: 'Create an independent layout for partial and fully returned orders.'
                                    })}
                                </div>
                            </div>
                        </Button>
                    ) : null}

                    {visibleTemplateOptions.map(({ format, template, label, description, primary, returned, disabled, warning }) => (
                        <Button
                            key={template.id}
                            variant="outline"
                            className={`relative flex min-h-32 min-w-0 flex-col gap-2 overflow-hidden whitespace-normal px-3 py-3 text-center transition-all hover:border-primary hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-70 ${
                                visibleOptionCount === 1 ? 'sm:col-span-2' : ''
                            }`}
                            onClick={() => onSelect(format, template)}
                            disabled={disabled}
                        >
                            <PrintOptionBadges primary={primary} returned={returned} />
                            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                                <PrintOptionIcon format={format} custom />
                            </div>
                            <div className="w-full min-w-0 space-y-1 overflow-hidden">
                                <div className="truncate font-bold">
                                    {label}
                                </div>
                                <div className="line-clamp-2 break-words text-center text-xs leading-4 text-muted-foreground">
                                    {description || t('customTemplates.customPrint', {
                                        defaultValue: format === 'receipt' ? 'Custom Receipt' : 'Custom A4 Print'
                                    })}
                                </div>
                                {warning ? (
                                    <div className="mt-1 flex items-start justify-center gap-1 rounded-md border border-amber-300/70 bg-amber-500/10 px-2 py-1 text-[10px] leading-3 text-amber-800 dark:text-amber-300">
                                        <AlertTriangle className="h-3 w-3 shrink-0" />
                                        <span className="line-clamp-3">{warning}</span>
                                    </div>
                                ) : null}
                            </div>
                        </Button>
                    ))}
                </div>
            </SmallDialogContent>
        </SmallDialog>
    )
}
