import type { ReactNode } from 'react'
import { Phone } from 'lucide-react'
import { ReactQRCode } from '@lglab/react-qr-code'

import { platformService } from '@/services/platformService'

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
    onFieldChange?: (key: string, value: string) => void
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
    editable,
    type = 'text',
    onFieldChange
}: {
    values: RealEstateBuyTemplateValues
    fieldKey: string
    fallback?: string
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
    onFieldChange
}: {
    index: number
    values: RealEstateBuyTemplateValues
    fieldKey: string
    editable?: boolean
    onFieldChange?: (key: string, value: string) => void
}) {
    const text = values[fieldKey] || ''
    const showIndex = index === 1 || text.trim().length > 0

    return (
        <div className="grid min-h-[11.8mm] grid-cols-[1fr_auto] gap-1 border-b border-dotted border-zinc-300 py-[1.6mm] leading-[1.8]">
            <div className="min-w-0">
                {editable ? (
                    <textarea
                        value={text}
                        aria-label={`contract row ${index}`}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => onFieldChange?.(fieldKey, event.target.value)}
                        className="block h-[8.4mm] w-full resize-none bg-transparent p-0 text-right font-semibold leading-[1.8] text-black outline-none ring-1 ring-transparent transition-shadow hover:ring-primary/30 focus:ring-2 focus:ring-primary print:ring-0"
                        dir="rtl"
                        rows={1}
                    />
                ) : (
                    <div className="min-h-[8.4mm] whitespace-pre-wrap text-right">{text}</div>
                )}
            </div>
            <div className={showIndex ? 'font-bold' : 'font-bold opacity-0'}>{index} -</div>
        </div>
    )
}

function SignatureBox({
    title,
    name,
    role,
    phone
}: {
    title: string
    name: ReactNode
    role: ReactNode
    phone: ReactNode
}) {
    return (
        <div className="flex min-h-[29mm] flex-col items-center justify-center gap-[2mm] px-2 text-center">
            <div className="text-[8.5px] font-bold">{title}</div>
            <UnderlineValue width="34mm">{name}</UnderlineValue>
            <UnderlineValue width="34mm">{role}</UnderlineValue>
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
                            <span>لەیەنی یەکەم / فرۆشیار :</span>
                            <UnderlineValue>{field('sellerName', '')}</UnderlineValue>
                            <span>پەیاس :</span>
                            <UnderlineValue>{field('sellerPhone', 'ناسراوه')}</UnderlineValue>
                        </div>
                        <div className="grid grid-cols-[auto_1fr_auto_1fr] items-center gap-x-1 border-b border-black py-[1.5mm]">
                            <span>لەیەنی دووەم / کڕیار :</span>
                            <UnderlineValue>{field('buyerName', '')}</UnderlineValue>
                            <span>پەیاس :</span>
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
                            onFieldChange={onFieldChange}
                        />
                    ))}
                </section>

                <footer className="border-t-2 border-black">
                    <div className="grid grid-cols-4 divide-x divide-zinc-400 divide-x-reverse">
                        <SignatureBox
                            title="شاهید:"
                            name={field('sellerWitnessName', 'چیوار ئەسعد احمد')}
                            role={field('sellerWitnessRole', 'قەفازی')}
                            phone={field('sellerWitnessPhone', '07501114345')}
                        />
                        <SignatureBox
                            title="لەیەنی یەکەم (فرۆشیار):"
                            name={field('sellerSignatureName', '')}
                            role={field('sellerSignatureRole', 'ڕایە')}
                            phone={field('sellerSignaturePhone', '07571112545')}
                        />
                        <SignatureBox
                            title="لەیەنی دووەم (کڕیار):"
                            name={field('buyerSignatureName', '')}
                            role={field('buyerSignatureRole', 'ڕایە')}
                            phone={field('buyerSignaturePhone', '07501199745')}
                        />
                        <SignatureBox
                            title="شاهید:"
                            name={field('buyerWitnessName', 'ئه‌حمه‌د حه‌سه‌ن عه‌لی')}
                            role={field('buyerWitnessRole', 'قەفازی')}
                            phone={field('buyerWitnessPhone', '07501112345')}
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
