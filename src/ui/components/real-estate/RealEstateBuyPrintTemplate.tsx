import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Phone } from 'lucide-react'
import { ReactQRCode } from '@lglab/react-qr-code'

import type { TemplatePreviewDataKey } from '@/lib/pdfPreviewStore'
import { platformService } from '@/services/platformService'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/ui/components/dialog'
import { Input } from '@/ui/components/input'

export type RealEstateBuyTemplateValues = Record<string, string>

export type WorkspaceContactPair = {
    primary?: string
    nonPrimary?: string
}

export type WorkspaceFooterContacts = {
    address?: WorkspaceContactPair
    email?: WorkspaceContactPair
    phone?: WorkspaceContactPair
}

type RealEstateBuyFieldType = 'text' | 'number' | 'date'

type RealEstateBuyPrintTemplateProps = {
    values: RealEstateBuyTemplateValues
    workspaceName?: string | null
    logoUrl?: string | null
    qrValue?: string | null
    workspaceFooterContacts?: WorkspaceFooterContacts
    editableFields?: boolean
    fieldTypes?: Record<string, RealEstateBuyFieldType>
    fieldPlaceholders?: Record<string, string>
    transactionKeys?: TemplatePreviewDataKey[]
    onFieldChange?: (key: string, value: string) => void
}

function dataKeyToken(key: TemplatePreviewDataKey) {
    return key.token || `{{${key.key}}}`
}

function resolveDataKeyTokens(text: string, values: RealEstateBuyTemplateValues) {
    return text.replace(/\{\{\s*([A-Za-z][A-Za-z0-9_.]*)\s*\}\}/g, (match, key) => {
        const replacement = values[key]?.trim()
        return replacement || match
    })
}

function TransactionKeyPickerDialog({
    open,
    dataKeys,
    onOpenChange,
    onInsert
}: {
    open: boolean
    dataKeys: TemplatePreviewDataKey[]
    onOpenChange: (open: boolean) => void
    onInsert: (key: TemplatePreviewDataKey) => void
}) {
    const [query, setQuery] = useState('')

    useEffect(() => {
        if (open) {
            setQuery('')
        }
    }, [open])

    const groupedKeys = useMemo(() => {
        const normalizedQuery = query.trim().toLowerCase()
        const filteredKeys = dataKeys.filter((key) => {
            if (!normalizedQuery) return true
            return [
                key.key,
                key.label,
                key.group,
                key.description
            ].some((value) => value?.toLowerCase().includes(normalizedQuery))
        })

        return filteredKeys.reduce<Array<{ group: string; keys: TemplatePreviewDataKey[] }>>((groups, key) => {
            const group = key.group || 'Transaction'
            const existing = groups.find((item) => item.group === group)
            if (existing) {
                existing.keys.push(key)
            } else {
                groups.push({ group, keys: [key] })
            }
            return groups
        }, [])
    }, [dataKeys, query])

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-lg overflow-hidden p-0">
                <DialogHeader className="border-b px-5 py-4 text-left">
                    <DialogTitle>Transaction keys</DialogTitle>
                </DialogHeader>
                <div className="space-y-3 p-4">
                    <Input
                        autoFocus
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="Search transaction keys"
                    />
                    <div className="max-h-[360px] overflow-y-auto rounded-md border">
                        {groupedKeys.length > 0 ? groupedKeys.map((group) => (
                            <div key={group.group} className="border-b last:border-b-0">
                                <div className="bg-muted/50 px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                                    {group.group}
                                </div>
                                {group.keys.map((key) => (
                                    <button
                                        key={key.key}
                                        type="button"
                                        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground focus:outline-none"
                                        onClick={() => onInsert(key)}
                                    >
                                        <span className="min-w-0">
                                            <span className="block truncate font-medium">{key.label}</span>
                                            {key.description ? (
                                                <span className="block truncate text-xs text-muted-foreground">{key.description}</span>
                                            ) : null}
                                        </span>
                                        <code className="shrink-0 rounded bg-muted px-2 py-1 text-[11px]" dir="ltr">
                                            {dataKeyToken(key)}
                                        </code>
                                    </button>
                                ))}
                            </div>
                        )) : (
                            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                                No keys found.
                            </div>
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}

function value(values: RealEstateBuyTemplateValues, key: string, fallback = '') {
    return values[key]?.trim() || fallback
}

function resolveLogoSrc(logoUrl?: string | null) {
    if (!logoUrl) return null
    return logoUrl.startsWith('http') ? logoUrl : platformService.convertFileSrc(logoUrl)
}

function joinContact(pair?: WorkspaceContactPair, fallback = '', separator = ' / ') {
    const entries = [pair?.primary, pair?.nonPrimary]
        .map((entry) => entry?.trim())
        .filter((entry): entry is string => Boolean(entry))

    return entries.length > 0 ? entries.join(separator) : fallback
}

function TemplateField({
    values,
    fieldKey,
    fallback,
    placeholder,
    editable,
    type = 'text',
    onFieldChange
}: {
    values: RealEstateBuyTemplateValues
    fieldKey: string
    fallback?: string
    placeholder?: string
    editable?: boolean
    type?: RealEstateBuyFieldType
    onFieldChange?: (key: string, value: string) => void
}) {
    const currentValue = value(values, fieldKey, fallback)

    if (!editable) {
        return <>{currentValue}</>
    }

    return (
        <input
            type="text"
            inputMode={type === 'number' ? 'decimal' : undefined}
            value={currentValue}
            aria-label={fieldKey}
            placeholder={placeholder}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
                event.stopPropagation()
                event.currentTarget.select()
            }}
            onChange={(event) => onFieldChange?.(fieldKey, event.target.value)}
            className="h-[1.4em] w-full min-w-0 cursor-text bg-transparent p-0 text-center font-bold leading-none text-inherit outline-none ring-1 ring-transparent transition-shadow hover:ring-primary/30 focus:ring-2 focus:ring-primary print:ring-0"
            dir={type === 'date' ? 'ltr' : 'auto'}
        />
    )
}

function UnderlineValue({
    children,
    width = '30mm',
    align = 'center'
}: {
    children: ReactNode
    width?: string
    align?: 'start' | 'center' | 'end'
}) {
    return (
        <span
            className="inline-block border-b border-black px-1 font-bold leading-none"
            style={{ minWidth: width, width, textAlign: align }}
        >
            {children}
        </span>
    )
}

function FreeWriteTermRow({
    index,
    values,
    fieldKey,
    editable,
    transactionKeys = [],
    onFieldChange
}: {
    index: number
    values: RealEstateBuyTemplateValues
    fieldKey: string
    editable?: boolean
    transactionKeys?: TemplatePreviewDataKey[]
    onFieldChange?: (key: string, value: string) => void
}) {
    const text = values[fieldKey] || ''
    const showIndex = index === 1 || text.trim().length > 0
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    const insertionRangeRef = useRef({ start: text.length, end: text.length })
    const [isKeyPickerOpen, setIsKeyPickerOpen] = useState(false)

    const openKeyPicker = () => {
        if (transactionKeys.length === 0) return
        const textarea = textareaRef.current
        insertionRangeRef.current = {
            start: textarea?.selectionStart ?? text.length,
            end: textarea?.selectionEnd ?? text.length
        }
        setIsKeyPickerOpen(true)
    }

    const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.ctrlKey && (event.key === ' ' || event.code === 'Space')) {
            event.preventDefault()
            event.stopPropagation()
            openKeyPicker()
        }
    }

    const handleInsertKey = (dataKey: TemplatePreviewDataKey) => {
        const token = dataKeyToken(dataKey)
        const range = insertionRangeRef.current
        const nextValue = `${text.slice(0, range.start)}${token}${text.slice(range.end)}`

        onFieldChange?.(fieldKey, nextValue)
        setIsKeyPickerOpen(false)

        window.setTimeout(() => {
            const textarea = textareaRef.current
            if (!textarea) return
            const cursor = range.start + token.length
            textarea.focus()
            textarea.setSelectionRange(cursor, cursor)
        }, 0)
    }

    return (
        <div className="grid min-h-[11.8mm] grid-cols-[auto_1fr] gap-1 border-b border-dotted border-zinc-300 py-[1.6mm] leading-[1.8]">
            <div dir="ltr" className={showIndex ? 'min-w-[7mm] text-right font-bold' : 'min-w-[7mm] text-right font-bold opacity-0'}>{index} -</div>
            <div className="min-w-0">
                {editable ? (
                    <>
                        <textarea
                            ref={textareaRef}
                            value={text}
                            aria-label={`contract row ${index}`}
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={(event) => event.stopPropagation()}
                            onKeyDown={handleKeyDown}
                            onChange={(event) => onFieldChange?.(fieldKey, event.target.value)}
                            className="block h-[8.4mm] w-full resize-none bg-transparent p-0 text-right font-semibold leading-[1.8] text-black outline-none ring-1 ring-transparent transition-shadow hover:ring-primary/30 focus:ring-2 focus:ring-primary print:ring-0"
                            dir="rtl"
                            rows={1}
                        />
                        <TransactionKeyPickerDialog
                            open={isKeyPickerOpen}
                            dataKeys={transactionKeys}
                            onOpenChange={setIsKeyPickerOpen}
                            onInsert={handleInsertKey}
                        />
                    </>
                ) : (
                    <div className="min-h-[8.4mm] whitespace-pre-wrap text-right">{resolveDataKeyTokens(text, values)}</div>
                )}
            </div>
        </div>
    )
}

function SignatureBox({
    title,
    name,
    address,
    phone
}: {
    title: string
    name: ReactNode
    address: ReactNode
    phone: ReactNode
}) {
    return (
        <div className="flex min-h-[29mm] flex-col items-center justify-center gap-[2mm] px-2 text-center">
            <div className="text-[8.5px] font-bold">{title}</div>
            <UnderlineValue width="34mm">{name}</UnderlineValue>
            <UnderlineValue width="34mm">{address}</UnderlineValue>
            <div className="min-w-[34mm] text-[8px] font-bold" dir="ltr">{phone}</div>
        </div>
    )
}

export function RealEstateBuyPrintTemplate({
    values,
    workspaceName,
    logoUrl,
    qrValue,
    workspaceFooterContacts,
    editableFields,
    fieldTypes,
    fieldPlaceholders,
    transactionKeys,
    onFieldChange
}: RealEstateBuyPrintTemplateProps) {
    const logoSrc = resolveLogoSrc(logoUrl)
    const address = joinContact(workspaceFooterContacts?.address)
    const phone = joinContact(workspaceFooterContacts?.phone, '', '\n')
    const centerQr = !logoSrc && Boolean(qrValue)
    const field = (fieldKey: string, fallback = '') => (
        <TemplateField
            values={values}
            fieldKey={fieldKey}
            fallback={fallback}
            placeholder={fieldPlaceholders?.[fieldKey]}
            editable={editableFields}
            type={fieldTypes?.[fieldKey] || 'text'}
            onFieldChange={onFieldChange}
        />
    )
    const fieldWithLegacyFallback = (fieldKey: string, legacyFieldKey: string, fallback = '') => (
        <TemplateField
            values={values}
            fieldKey={fieldKey}
            fallback={String(values[fieldKey]?.trim() ? values[fieldKey] : values[legacyFieldKey] ?? fallback)}
            placeholder={fieldPlaceholders?.[fieldKey]}
            editable={editableFields}
            type={fieldTypes?.[fieldKey] || 'text'}
            onFieldChange={onFieldChange}
        />
    )

    return (
        <div
            dir="rtl"
            className="real-estate-buy-template relative mx-auto flex overflow-hidden bg-white text-black"
            style={{
                width: '210mm',
                height: '297mm',
                fontFamily: 'Arial, Tahoma, sans-serif',
                fontSize: '9px',
                lineHeight: 1.45,
                colorScheme: 'light'
            }}
        >
            <style dangerouslySetInnerHTML={{
                __html: `
.real-estate-buy-template {
  -webkit-print-color-adjust: exact !important;
  print-color-adjust: exact !important;
}
@media print {
  @page { margin: 0; size: A4; }
  .real-estate-buy-template {
    margin: 0 !important;
    box-shadow: none !important;
  }
}
`
            }} />

            <main className="flex h-full w-full flex-col">
                <header className="relative h-[53mm] border-b-2 border-black">
                    <div className="absolute left-[11mm] top-[9mm] flex items-start gap-[3mm]" dir="ltr">
                        {qrValue && !centerQr && (
                            <div className="bg-white" data-qr-sharp="true">
                                <ReactQRCode value={qrValue} size={51} level="M" />
                            </div>
                        )}
                        <div className="flex flex-col gap-[2mm] pt-[1mm]">
                            <span className="text-[8px] text-zinc-700">ژمارەی وصل</span>
                            <span className="flex h-[11mm] w-[11mm] items-center justify-center rounded bg-[#232439] text-base font-bold text-white">
                                {field('receiptNumber', '3')}
                            </span>
                        </div>
                    </div>

                    <div className="absolute left-1/2 top-[10mm] flex -translate-x-1/2 flex-col items-center gap-[4mm]">
                        {logoSrc ? (
                            <div className="flex h-[19mm] min-w-[50mm] items-center justify-center bg-white">
                                <img src={logoSrc} alt={workspaceName || 'Workspace Logo'} className="max-h-[19mm] max-w-[60mm] object-contain" />
                            </div>
                        ) : qrValue ? (
                            <div className="flex h-[19mm] min-w-[50mm] items-center justify-center bg-white">
                                <div className="bg-white" data-qr-sharp="true">
                                    <ReactQRCode value={qrValue} size={72} level="M" />
                                </div>
                            </div>
                        ) : (
                            <div className="flex h-[19mm] min-w-[50mm] items-center justify-center px-5 text-center text-[14px] font-bold leading-tight text-zinc-900">
                                {workspaceName}
                            </div>
                        )}
                        <div className="max-w-[68mm] px-4 py-[1mm] text-center text-[10px] font-bold leading-tight text-zinc-900">
                            {address}
                        </div>
                    </div>

                    <div className="absolute right-[18mm] top-[9mm] flex flex-col items-center gap-[2mm]">
                        <div className="flex h-[10mm] w-[10mm] items-center justify-center rounded-full bg-[#232439] text-white">
                            <Phone className="h-[5mm] w-[5mm]" />
                        </div>
                        <div className="flex min-h-[19mm] w-[22mm] items-center justify-center whitespace-pre-line px-1 text-center text-[8px] font-bold leading-tight text-zinc-900">
                            {phone}
                        </div>
                    </div>
                </header>

                <section className="px-[2mm] py-[4mm]">
                    <div className="grid grid-cols-2 gap-x-[12mm] text-[8.5px] font-bold">
                        <div className="grid grid-cols-[auto_1fr_auto_1fr] items-center gap-x-1 border-b border-black py-[1.5mm]">
                            <span>لایەنی یەکەم / فرۆشیار :</span>
                            <UnderlineValue>{field('sellerName', '')}</UnderlineValue>
                            <span>پێناس :</span>
                            <UnderlineValue>{field('sellerPhone', 'ناسراوه')}</UnderlineValue>
                        </div>
                        <div className="grid grid-cols-[auto_1fr_auto_1fr] items-center gap-x-1 border-b border-black py-[1.5mm]">
                            <span>لایەنی دووەم / کڕیار :</span>
                            <UnderlineValue>{field('buyerName', '')}</UnderlineValue>
                            <span>پێناس :</span>
                            <UnderlineValue>{field('buyerPhone', 'ناسراوه')}</UnderlineValue>
                        </div>
                    </div>
                </section>

                <section className="flex-1 px-[2mm] text-[9px] font-semibold">
                    {Array.from({ length: 11 }, (_, rowIndex) => (
                        <FreeWriteTermRow
                            key={`contract-row-${rowIndex + 1}`}
                            index={rowIndex + 1}
                            values={values}
                            fieldKey={`contractRow${rowIndex + 1}`}
                            editable={editableFields}
                            transactionKeys={transactionKeys}
                            onFieldChange={onFieldChange}
                        />
                    ))}
                </section>

                <footer className="border-t-2 border-black">
                    <div className="grid grid-cols-4 divide-x divide-zinc-400 divide-x-reverse">
                        <SignatureBox
                            title="شاهید:"
                            name={field('sellerWitnessName', '')}
                            address={fieldWithLegacyFallback('sellerWitnessAddress', 'sellerWitnessRole')}
                            phone={field('sellerWitnessPhone', '')}
                        />
                        <SignatureBox
                            title="لایەنی یەکەم (فرۆشیار):"
                            name={field('sellerSignatureName', '')}
                            address={fieldWithLegacyFallback('sellerSignatureAddress', 'sellerSignatureRole')}
                            phone={field('sellerSignaturePhone', '')}
                        />
                        <SignatureBox
                            title="لایەنی دووەم (کڕیار):"
                            name={field('buyerSignatureName', '')}
                            address={fieldWithLegacyFallback('buyerSignatureAddress', 'buyerSignatureRole')}
                            phone={field('buyerSignaturePhone', '')}
                        />
                        <SignatureBox
                            title="شاهید:"
                            name={field('buyerWitnessName', '')}
                            address={fieldWithLegacyFallback('buyerWitnessAddress', 'buyerWitnessRole')}
                            phone={field('buyerWitnessPhone', '')}
                        />
                    </div>
                    <div className="flex justify-start border-t border-zinc-300 px-[2mm] py-[2mm]">
                        <div className="min-w-[37mm] px-2 py-[1mm] text-left text-[16px] font-bold leading-none text-black" dir="ltr">
                            :{field('note', 'Note')}
                        </div>
                    </div>
                </footer>
            </main>
        </div>
    )
}
