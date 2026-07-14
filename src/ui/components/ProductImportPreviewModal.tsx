import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, ArrowLeft, CheckCircle2, FileSpreadsheet, Loader2, RotateCcw } from 'lucide-react'

import { cn } from '@/lib/utils'
import {
    PRODUCT_IMPORT_FIELDS,
    revalidateProductImportRows,
    type ProductImportProgress,
    type ProductImportPreviewRow,
    type ProductImportSubmissionResult,
    type ProductImportValidationContext,
    type ProductImportField
} from '@/lib/productImport'

import { Button } from './button'
import { Input } from './input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table'
import { Progress } from './ui/progress'

interface ProductImportPreviewModalProps {
    isOpen: boolean
    fileName: string
    initialRows: ProductImportPreviewRow[]
    fileErrors: { message: string }[]
    validationContext: ProductImportValidationContext
    onClose: () => void
    onImport: (
        rows: ProductImportPreviewRow[],
        onProgress: (progress: ProductImportProgress) => void
    ) => Promise<ProductImportSubmissionResult>
}

function clonePreviewRow(row: ProductImportPreviewRow): ProductImportPreviewRow {
    return {
        ...row,
        originalValues: { ...row.originalValues },
        values: { ...row.values },
        errors: row.errors.map((error) => ({ ...error }))
    }
}

function getFieldErrors(row: ProductImportPreviewRow, field: ProductImportField) {
    return row.errors.filter((error) => error.field === field).map((error) => error.message)
}

export function ProductImportPreviewModal({
    isOpen,
    fileName,
    initialRows,
    fileErrors,
    validationContext,
    onClose,
    onImport
}: ProductImportPreviewModalProps) {
    const [rows, setRows] = useState<ProductImportPreviewRow[]>([])
    const [isImporting, setIsImporting] = useState(false)
    const [backendFailures, setBackendFailures] = useState<Map<number, string>>(new Map())
    const [importedRowNumbers, setImportedRowNumbers] = useState<Set<number>>(new Set())
    const [importProgress, setImportProgress] = useState<ProductImportProgress | null>(null)
    const [submissionError, setSubmissionError] = useState<string | null>(null)

    useEffect(() => {
        if (!isOpen) {
            setRows([])
            setBackendFailures(new Map())
            setImportedRowNumbers(new Set())
            setImportProgress(null)
            setSubmissionError(null)
            return
        }

        setRows(initialRows.map(clonePreviewRow))
        setBackendFailures(new Map())
        setImportedRowNumbers(new Set())
        setImportProgress(null)
        setSubmissionError(null)
    }, [initialRows, isOpen])

    useEffect(() => {
        if (!isOpen) {
            return
        }

        setRows((currentRows) => revalidateProductImportRows(currentRows, validationContext))
    }, [isOpen, validationContext])

    const validCount = useMemo(
        () => rows.filter((row) => row.isValid).length,
        [rows]
    )
    const invalidCount = rows.length - validCount
    const remainingRows = useMemo(
        () => rows.filter((row) => !importedRowNumbers.has(row.excelRowNumber)),
        [importedRowNumbers, rows]
    )
    const completedCount = importedRowNumbers.size
    const isComplete = rows.length > 0 && completedCount === rows.length && backendFailures.size === 0
    const canImport = fileErrors.length === 0
        && invalidCount === 0
        && remainingRows.length > 0
        && !isImporting
    const progressCompletedTotal = importProgress
        ? completedCount + importProgress.completedRows
        : completedCount
    const progressImportedTotal = importProgress
        ? completedCount + importProgress.importedRows
        : completedCount
    const progressPendingTotal = Math.max(rows.length - progressCompletedTotal, 0)
    const progressPercent = rows.length > 0 ? (progressCompletedTotal / rows.length) * 100 : 0

    const updateCell = (excelRowNumber: number, field: ProductImportField, value: string) => {
        setRows((currentRows) => revalidateProductImportRows(
            currentRows.map((row) => row.excelRowNumber === excelRowNumber
                ? { ...row, values: { ...row.values, [field]: value } }
                : row
            ),
            validationContext
        ))
        setBackendFailures((current) => {
            if (!current.has(excelRowNumber)) {
                return current
            }
            const next = new Map(current)
            next.delete(excelRowNumber)
            return next
        })
        setSubmissionError(null)
    }

    const retryValidation = () => {
        setRows((currentRows) => revalidateProductImportRows(currentRows, validationContext))
        setSubmissionError(null)
    }

    const handleImport = async () => {
        if (!canImport) {
            return
        }

        setIsImporting(true)
        setBackendFailures(new Map())
        setImportProgress({
            totalRows: remainingRows.length,
            completedRows: 0,
            importedRows: 0,
            failedRows: 0,
            currentExcelRowNumber: null
        })
        setSubmissionError(null)
        try {
            const result = await onImport(remainingRows, (progress) => setImportProgress(progress))
            setImportedRowNumbers((current) => new Set([
                ...current,
                ...result.importedRowNumbers
            ]))
            setBackendFailures(() => new Map(
                result.failures.map((failure) => [failure.excelRowNumber, failure.message])
            ))

            if (result.importedRowNumbers.length === 0 && result.failures.length === 0) {
                setSubmissionError('No rows were imported. Please review the rows and try again.')
            }
        } catch (error) {
            console.error('[Products] Product import failed:', error)
            setSubmissionError(error instanceof Error ? error.message : 'The import could not be completed. Please try again.')
        } finally {
            setIsImporting(false)
            setImportProgress(null)
        }
    }

    if (!isOpen) {
        return null
    }

    return (
        <div className="min-h-screen space-y-6">
            <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
                <div className="flex items-center gap-4">
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={onClose}
                        disabled={isImporting}
                        className="shrink-0 rounded-full hover:bg-muted"
                        aria-label="Close product import preview"
                    >
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-primary/20 bg-primary/10">
                        <FileSpreadsheet className="h-6 w-6 text-primary" />
                    </div>
                    <div>
                        <h1 className="text-xl font-black tracking-tight">Import Products Preview</h1>
                        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{fileName}</p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <Button variant="ghost" onClick={onClose} disabled={isImporting} className="h-10 rounded-xl px-6 font-bold">
                        {isComplete ? 'Close' : 'Cancel'}
                    </Button>
                    {!isComplete && (
                        <Button
                            onClick={handleImport}
                            disabled={!canImport}
                            className="flex h-10 items-center justify-center gap-2 rounded-xl bg-emerald-500 px-6 font-black text-white shadow-lg shadow-emerald-500/20 transition-all hover:bg-emerald-600 active:scale-95"
                        >
                            {isImporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                            {isImporting
                                ? 'Importing…'
                                : completedCount > 0
                                    ? `Retry ${remainingRows.length} remaining row${remainingRows.length === 1 ? '' : 's'}`
                                    : `Import ${rows.length} product${rows.length === 1 ? '' : 's'}`}
                        </Button>
                    )}
                </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-2xl border border-border/60 bg-card p-4">
                    <div className="text-[11px] font-black uppercase tracking-[0.18em] text-muted-foreground">Total rows</div>
                    <div className="mt-1 text-2xl font-black">{rows.length}</div>
                </div>
                <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4">
                    <div className="text-[11px] font-black uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-400">Valid rows</div>
                    <div className="mt-1 text-2xl font-black text-emerald-700 dark:text-emerald-400">{validCount}</div>
                </div>
                <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-4">
                    <div className="text-[11px] font-black uppercase tracking-[0.18em] text-destructive">Invalid rows</div>
                    <div className="mt-1 text-2xl font-black text-destructive">{invalidCount}</div>
                </div>
                <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4">
                    <div className="text-[11px] font-black uppercase tracking-[0.18em] text-primary">Imported this session</div>
                    <div className="mt-1 text-2xl font-black text-primary">{completedCount}</div>
                </div>
            </div>

            {isImporting && importProgress && (
                <div className="rounded-2xl border border-primary/25 bg-primary/5 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <div className="flex items-center gap-2 font-bold text-primary">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Importing products
                            </div>
                            <p className="mt-1 text-sm text-muted-foreground">
                                {importProgress.currentExcelRowNumber === null
                                    ? 'Preparing the next product…'
                                    : `Saving Excel row ${importProgress.currentExcelRowNumber}…`}
                            </p>
                        </div>
                        <div className="text-left sm:text-right">
                            <div className="text-lg font-black tabular-nums">{progressCompletedTotal} / {rows.length}</div>
                            <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">rows completed</div>
                        </div>
                    </div>
                    <Progress value={progressPercent} className="mt-4 h-2.5 bg-primary/15" indicatorClassName="bg-primary" />
                    <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
                        <div><span className="block text-xs font-bold uppercase tracking-wider text-muted-foreground">Imported</span><span className="font-black text-emerald-700 dark:text-emerald-400">{progressImportedTotal}</span></div>
                        <div><span className="block text-xs font-bold uppercase tracking-wider text-muted-foreground">Failed</span><span className="font-black text-destructive">{importProgress.failedRows}</span></div>
                        <div><span className="block text-xs font-bold uppercase tracking-wider text-muted-foreground">Pending</span><span className="font-black">{progressPendingTotal}</span></div>
                    </div>
                </div>
            )}

            {isComplete && (
                <div className="flex items-start gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-emerald-800 dark:text-emerald-300">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
                    <div>
                        <div className="font-bold">Import complete</div>
                        <p className="mt-1 text-sm">Successfully imported {completedCount} product{completedCount === 1 ? '' : 's'} and assigned their initial inventory to the selected storage locations.</p>
                    </div>
                </div>
            )}

            {fileErrors.length > 0 && (
                <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-destructive">
                    <div className="flex items-center gap-2 font-bold">
                        <AlertCircle className="h-5 w-5" />
                        File validation errors
                    </div>
                    <ul className="mt-2 list-disc space-y-1 pl-6 text-sm">
                        {fileErrors.map((error) => <li key={error.message}>{error.message}</li>)}
                    </ul>
                    <p className="mt-3 text-sm">Fix the worksheet headers, then select the file again. Importing is disabled until these errors are resolved.</p>
                </div>
            )}

            {submissionError && (
                <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                    {submissionError}
                </div>
            )}

            {backendFailures.size > 0 && (
                <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-amber-900 dark:text-amber-200">
                    <div className="flex items-center gap-2 font-bold">
                        <AlertCircle className="h-5 w-5" />
                        Some rows could not be imported
                    </div>
                    <ul className="mt-2 list-disc space-y-1 pl-6 text-sm">
                        {Array.from(backendFailures.entries()).map(([excelRowNumber, message]) => (
                            <li key={excelRowNumber}>Excel row {excelRowNumber}: {message}</li>
                        ))}
                    </ul>
                    <p className="mt-3 text-sm">Edit a failed row if needed, then retry the remaining rows. Already imported rows will not be submitted again.</p>
                </div>
            )}

            <div className="rounded-2xl border border-border/50 bg-background/50 p-4">
                <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h2 className="font-bold">Editable import data</h2>
                        <p className="text-sm text-muted-foreground">Changes are kept only in this preview and never overwrite the uploaded Excel file. Each cell is revalidated immediately.</p>
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={retryValidation} disabled={isImporting} className="gap-2 self-start">
                        <RotateCcw className="h-4 w-4" />
                        Revalidate all
                    </Button>
                </div>

                <div className="overflow-auto rounded-xl border border-border/50">
                    <Table className="min-w-[1900px]">
                        <TableHeader>
                            <TableRow className="bg-muted/40 hover:bg-muted/40">
                                <TableHead className="min-w-20">Excel row</TableHead>
                                <TableHead className="min-w-28">Status</TableHead>
                                {PRODUCT_IMPORT_FIELDS.map((field) => <TableHead key={field} className="min-w-44 font-mono text-xs">{field}</TableHead>)}
                                <TableHead className="min-w-[360px]">Validation details</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {rows.map((row) => {
                                const isImported = importedRowNumbers.has(row.excelRowNumber)
                                const backendFailure = backendFailures.get(row.excelRowNumber)
                                return (
                                    <TableRow
                                        key={row.excelRowNumber}
                                        className={cn(
                                            !row.isValid && 'bg-destructive/5 hover:bg-destructive/10',
                                            isImported && 'bg-emerald-500/5 opacity-70 hover:bg-emerald-500/10'
                                        )}
                                    >
                                        <TableCell className="font-mono font-bold">{row.excelRowNumber}</TableCell>
                                        <TableCell>
                                            {isImported ? (
                                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-1 text-xs font-bold text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5" /> Imported</span>
                                            ) : row.isValid ? (
                                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-1 text-xs font-bold text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5" /> Valid</span>
                                            ) : (
                                                <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-1 text-xs font-bold text-destructive"><AlertCircle className="h-3.5 w-3.5" /> Invalid</span>
                                            )}
                                        </TableCell>
                                        {PRODUCT_IMPORT_FIELDS.map((field) => {
                                            const fieldErrors = getFieldErrors(row, field)
                                            return (
                                                <TableCell key={field} className="align-top">
                                                    <Input
                                                        value={row.values[field]}
                                                        onChange={(event) => updateCell(row.excelRowNumber, field, event.target.value)}
                                                        disabled={isImporting || isImported}
                                                        aria-invalid={fieldErrors.length > 0}
                                                        className={cn(
                                                            'h-9 min-w-40 font-medium',
                                                            fieldErrors.length > 0 && 'border-destructive focus-visible:ring-destructive'
                                                        )}
                                                    />
                                                    {fieldErrors.map((message) => <p key={message} className="mt-1 text-xs leading-snug text-destructive">{message}</p>)}
                                                </TableCell>
                                            )
                                        })}
                                        <TableCell className="align-top">
                                            {row.errors.length === 0 && !backendFailure ? (
                                                <span className="text-sm text-muted-foreground">Ready to import.</span>
                                            ) : (
                                                <ul className="space-y-1 text-sm">
                                                    {row.errors.map((error, index) => <li key={`${error.field}-${index}`} className="text-destructive"><span className="font-mono font-bold">{error.field}:</span> {error.message}</li>)}
                                                    {backendFailure && <li className="text-amber-700 dark:text-amber-300"><span className="font-bold">Import error:</span> {backendFailure}</li>}
                                                </ul>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                )
                            })}
                        </TableBody>
                    </Table>
                </div>
            </div>

            {!isComplete && (fileErrors.length > 0 || invalidCount > 0) && (
                <p className="text-center text-sm font-medium text-muted-foreground">Resolve every file and row validation error before importing.</p>
            )}
        </div>
    )
}
