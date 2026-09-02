import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import {
    buildProductExportPrintTableChunks,
    shouldUseSingleLineProductExportRows,
    type ExportPreviewTable
} from '@/lib/productExportPrintTable'

type ProductExportPrintTemplateProps = {
    workspaceName?: string | null
    printLang: string
    table: ExportPreviewTable
    generatedAt: string
}

function getPrintText(
    t: (key: string, options?: Record<string, unknown>) => string,
    key: string,
    fallbackKey: string,
    options?: Record<string, unknown>
) {
    const translated = t(key, options)
    return translated === key ? t(fallbackKey, options) : translated
}

function isRtl(language: string) {
    const baseLanguage = language.split('-')[0]
    return baseLanguage === 'ar' || baseLanguage === 'ku'
}

function displayValue(value: unknown) {
    if (value === null || value === undefined || value === '') return '—'
    return String(value)
}

export function ProductExportPrintTemplate({
    workspaceName,
    printLang,
    table,
    generatedAt
}: ProductExportPrintTemplateProps) {
    const { i18n } = useTranslation()
    const t = i18n.getFixedT(printLang)
    const chunks = useMemo(() => buildProductExportPrintTableChunks(table), [table])
    const useSingleLineRows = shouldUseSingleLineProductExportRows(table.columns.length)
    const rtl = isRtl(printLang)
    const businessName = workspaceName?.trim() || getPrintText(
        t,
        'products.export.print.workspaceFallback',
        'products.title'
    )
    const title = `${t('products.title')} · ${t('sales.export.previewTitle')}`
    const rowsLabel = `${table.rows.length} ${t('sales.export.recordsCount')}`
    const generatedAtLabel = new Intl.DateTimeFormat(printLang, {
        dateStyle: 'medium',
        timeStyle: 'short'
    }).format(new Date(generatedAt))
    const generatedLabel = getPrintText(
        t,
        'products.export.print.generatedAt',
        'invoice.generated',
        { date: generatedAtLabel }
    )
    const generatedFallbackLabel = t('invoice.generated')

    return (
        <div
            dir={rtl ? 'rtl' : 'ltr'}
            className="bg-white text-black"
            style={{ width: '210mm' }}
            data-order-print-page
            data-page-width-mm="210"
            data-page-padding-mm="9"
            data-product-export-print
        >
            <style
                dangerouslySetInnerHTML={{
                    __html: `
@media print {
    @page { margin: 0; size: A4; }
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; margin: 0; padding: 0; }
    [data-product-export-print] tr,
    [data-product-export-print] [data-pdf-keep-together] { break-inside: avoid; page-break-inside: avoid; }
    [data-product-export-print] thead { display: table-header-group; }
}
`
                }}
            />
            <section className="bg-white" style={{ minHeight: '297mm', padding: '9mm', boxSizing: 'border-box' }}>
                <header className="flex items-start justify-between gap-4 border-b-2 border-slate-800 pb-3" data-pdf-keep-together>
                    <div>
                        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{businessName}</p>
                        <h1 className="mt-1 text-[18px] font-bold">{title}</h1>
                    </div>
                    <div className="text-end text-[9px] text-slate-600">
                        <p>{rowsLabel}</p>
                        <p className="mt-1">
                            {generatedLabel === generatedFallbackLabel ? `${generatedLabel} ${generatedAtLabel}` : generatedLabel}
                        </p>
                    </div>
                </header>

                {chunks.length === 0 ? (
                    <div className="mt-8 rounded border border-dashed border-slate-400 px-4 py-8 text-center text-[11px] text-slate-600">
                        {getPrintText(t, 'products.export.print.empty', 'common.noData')}
                    </div>
                ) : chunks.map((chunk, chunkIndex) => (
                    <table
                        key={`${chunk.columnStart}-${chunkIndex}`}
                        data-pdf-page-chunk
                        data-centered-table={chunkIndex > 0 ? '' : undefined}
                        className={`mt-4 w-full table-fixed border-collapse ${useSingleLineRows ? 'text-[6px]' : 'text-[8px]'}`}
                    >
                        <thead>
                            <tr className="bg-slate-200 font-bold">
                                {chunk.columns.map((column) => (
                                    <th
                                        key={column}
                                        title={column}
                                        className={`border border-slate-400 text-start align-top ${
                                            useSingleLineRows
                                                ? 'overflow-hidden text-ellipsis whitespace-nowrap px-1 py-0.5'
                                                : 'break-words px-1.5 py-1'
                                        }`}
                                    >
                                        {column}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {chunk.rows.map((row, rowIndex) => (
                                <tr key={`${chunkIndex}-${rowIndex}`} style={{ height: useSingleLineRows ? '5mm' : '8mm' }}>
                                    {row.map((value, columnIndex) => {
                                        const valueLabel = displayValue(value)
                                        return (
                                        <td
                                            key={`${chunkIndex}-${rowIndex}-${columnIndex}`}
                                            title={valueLabel}
                                            className={`border border-slate-300 align-top ${
                                                useSingleLineRows
                                                    ? 'overflow-hidden text-ellipsis whitespace-nowrap px-1 py-0.5'
                                                    : 'break-words px-1.5 py-1'
                                            }`}
                                        >
                                            {valueLabel}
                                        </td>
                                        )
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                ))}
            </section>
        </div>
    )
}
