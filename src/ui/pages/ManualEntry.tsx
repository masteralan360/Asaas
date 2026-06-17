import { createElement, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, FileText, Loader2, Printer, Save } from 'lucide-react'
import { useAuth } from '@/auth'
import { db } from '@/local-db'
import type { ManualEntryTemplate } from '@/local-db/models'
import { Button } from '@/ui/components/button'
import { Input } from '@/ui/components/input'
import {
  Card, CardContent, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
  useToast,
} from '@/ui/components'
import { generateTemplatePdf } from '@/services/pdfGenerator'
import { saveInvoicePdfToLocalAppData } from '@/services/localInvoiceStorage'

const ROW_COUNT = 20

type CellData = Record<string, string[]>

function generateId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `entry-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function renderTableElement(template: ManualEntryTemplate, data: CellData) {
  const sortedRows = [...template.rows]
    .filter((r) => r.label.trim())
    .sort((a, b) => a.sortOrder - b.sortOrder)

  const headerLines = [
    template.headerName,
    template.headerPhone1,
    template.headerPhone2,
  ].filter(Boolean)

  return createElement(
    'div',
    { style: { width: '210mm', background: '#ffffff', padding: '10mm 15mm', direction: 'rtl' } },
    headerLines.length > 0
      ? createElement(
          'div',
          {
            style: {
              marginBottom: 0,
              padding: '12px',
              border: '1px solid #d1d5db',
              borderBottom: 'none',
              borderTopLeftRadius: '8px',
              borderTopRightRadius: '8px',
              background: '#f9fafb',
              fontFamily: 'Arial, sans-serif',
              fontSize: '14px',
              lineHeight: '1.8',
            },
          },
          headerLines.map((line, idx) =>
            createElement('div', { key: idx, style: { marginBottom: '6px', fontWeight: 500 } }, line),
          ),
        )
      : null,
    createElement(
      'table',
      {
        style: {
          width: '100%', borderCollapse: 'collapse', border: '1px solid #d1d5db',
          fontFamily: 'Arial, sans-serif', fontSize: '12px',
        },
      },
      createElement(
        'thead',
        null,
        createElement(
          'tr',
          null,
          createElement(
            'th',
            {
              style: {
                border: '1px solid #d1d5db', background: '#f3f4f6', padding: 0,
                textAlign: 'center', fontWeight: 600, color: '#374151',
                width: '30px', whiteSpace: 'nowrap',
              },
            },
            createElement('div', {
              style: {
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                minHeight: '28px', padding: '0 10px',
              },
            }, '#'),
          ),
          ...sortedRows.map((row, idx) =>
            createElement(
              'th',
              {
                key: row.id,
                style: {
                  border: '1px solid #d1d5db', background: '#f3f4f6', padding: 0,
                  textAlign: 'center', fontWeight: 600, color: '#374151',
                  width: idx === 0 ? '40%' : undefined,
                },
              },
              createElement('div', {
                style: {
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  minHeight: '28px', padding: '0 10px',
                },
              }, row.label),
            ),
          ),
        ),
      ),
      createElement(
        'tbody',
        null,
        ...Array.from({ length: ROW_COUNT }, (_, rowIdx) =>
          createElement(
            'tr',
            { key: rowIdx },
            createElement(
              'td',
              {
                style: {
                  border: '1px solid #d1d5db', padding: 0,
                  textAlign: 'center', color: '#6b7280', fontSize: '12px',
                },
              },
              createElement('div', {
                style: {
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  minHeight: '28px', padding: '0 10px',
                },
              }, String(rowIdx + 1)),
            ),
            ...sortedRows.map((row) =>
              createElement(
                'td',
                {
                  key: row.id,
                  style: { border: '1px solid #d1d5db', padding: 0, fontSize: '12px' },
                  dir: 'rtl',
                },
                createElement('div', {
                  style: {
                    display: 'flex', alignItems: 'center',
                    minHeight: '28px', padding: '0 10px',
                  },
                }, data[row.id]?.[rowIdx] || ''),
              ),
            ),
          ),
        ),
      ),
    ),
  )
}

interface ManualEntryA4PreviewProps {
  template: ManualEntryTemplate
  onBack: () => void
  onSaveAndPrint: (data: CellData) => Promise<string | undefined>
}

function ManualEntryA4Preview({ template, onBack, onSaveAndPrint }: ManualEntryA4PreviewProps) {
  const { t } = useTranslation()
  const [isSaving, setIsSaving] = useState(false)

  const sortedRows = useMemo(
    () => [...template.rows]
      .filter((r) => r.label.trim())
      .sort((a, b) => a.sortOrder - b.sortOrder),
    [template.rows],
  )

  const [cellData, setCellData] = useState<CellData>(() => {
    const data: CellData = {}
    for (const row of sortedRows) {
      data[row.id] = Array.from({ length: ROW_COUNT }, () => '')
    }
    return data
  })

  const updateCell = useCallback((rowId: string, rowIndex: number, value: string) => {
    setCellData((prev) => {
      const col = [...(prev[rowId] || [])]
      col[rowIndex] = value
      return { ...prev, [rowId]: col }
    })
  }, [])

  const handleSaveAndPrint = useCallback(async () => {
    setIsSaving(true)
    try {
      await onSaveAndPrint(cellData)
    } finally {
      setIsSaving(false)
    }
  }, [cellData, onSaveAndPrint])

  return (
    <div className="mx-auto p-4 sm:p-6">
      <div className="no-print mb-4 flex items-center justify-between">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          {t('common.back') || 'Back'}
        </Button>
        <div className="text-lg font-semibold">{template.name}</div>
        <Button onClick={handleSaveAndPrint} disabled={isSaving}>
          {isSaving ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <>
              <Save className="mr-2 h-4 w-4" />
              <Printer className="mr-2 h-4 w-4" />
            </>
          )}
          {t('manualEntry.print.saveAndPrint') || 'Save & Print'}
        </Button>
      </div>

      <div className="overflow-auto max-w-full">
      <div className="mx-auto bg-white" style={{ width: '210mm' }}>
        <div style={{ padding: '10mm 15mm' }}>
          <div style={{ direction: 'rtl', marginBottom: 0 }}>
            {(() => {
              const lines = [
                template.headerName,
                template.headerPhone1,
                template.headerPhone2,
              ].filter(Boolean)
              if (lines.length === 0) return null
              return (
                <div className="border border-gray-300 border-b-0 bg-gray-50 rounded-t-lg p-3 mb-0" style={{ fontFamily: 'Arial, sans-serif' }}>
                  {lines.map((line, idx) => (
                    <div key={idx} className="text-sm font-medium leading-relaxed mb-1 last:mb-0">{line}</div>
                  ))}
                </div>
              )
            })()}
          </div>
          <div style={{ direction: 'rtl' }}>
            <table className="w-full border-collapse border border-gray-300 text-sm">
              <thead>
                <tr>
                  <th className="border border-gray-300 bg-gray-100 text-center text-xs font-semibold text-gray-700 w-[30px] whitespace-nowrap">
                    <div className="flex min-h-[28px] items-center justify-center px-2.5">#</div>
                  </th>
                  {sortedRows.map((row, idx) => (
                    <th key={row.id} className="border border-gray-300 bg-gray-100 text-center text-xs font-semibold text-gray-700" style={idx === 0 ? { width: '40%' } : {}}>
                      <div className="flex min-h-[28px] items-center justify-center px-2.5">{row.label}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: ROW_COUNT }, (_, rowIdx) => (
                  <tr key={rowIdx}>
                    <td className="border border-gray-300 p-0 text-center text-xs text-gray-500 whitespace-nowrap">
                      <div className="flex min-h-[28px] items-center justify-center px-2.5">
                        {rowIdx + 1}
                      </div>
                    </td>
                    {sortedRows.map((row) => (
                      <td key={row.id} className="border border-gray-300 p-0">
                        <div className="flex min-h-[28px] items-center px-2.5" style={{ direction: 'rtl' }}>
                          <Input
                            value={cellData[row.id]?.[rowIdx] || ''}
                            onChange={(e) => updateCell(row.id, rowIdx, e.target.value)}
                            className="min-w-0 flex-1 rounded-none border-0 bg-transparent p-0 text-xs shadow-none focus:bg-blue-50 focus:ring-0"
                          />
                        </div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      </div>
    </div>
  )
}

export function ManualEntry() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const { user } = useAuth()
  const workspaceId = user?.workspaceId

  const [templates, setTemplates] = useState<ManualEntryTemplate[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedTemplate, setSelectedTemplate] = useState<ManualEntryTemplate | null>(null)
  const [isSelectionOpen, setIsSelectionOpen] = useState(false)

  useEffect(() => {
    if (!workspaceId) return
    db.manual_entry_templates
      .where('workspaceId')
      .equals(workspaceId)
      .filter((t) => !t.isDeleted && t.status === 'active')
      .toArray()
      .then((all) => {
        setTemplates(all.sort((a, b) => a.createdAt.localeCompare(b.createdAt)))
      })
      .catch(console.error)
      .finally(() => setIsLoading(false))
  }, [workspaceId])

  const activeTemplates = useMemo(
    () => templates.filter((t) => !t.isDeleted && t.status === 'active'),
    [templates],
  )

  const handleCreateEntry = useCallback(() => {
    if (activeTemplates.length === 0) return
    if (activeTemplates.length === 1) {
      setSelectedTemplate(activeTemplates[0])
    } else {
      setIsSelectionOpen(true)
    }
  }, [activeTemplates])

  const handleSelectTemplate = useCallback((template: ManualEntryTemplate) => {
    setIsSelectionOpen(false)
    setSelectedTemplate(template)
  }, [])

  const handleSaveAndPrint = useCallback(async (data: CellData): Promise<string | undefined> => {
    if (!workspaceId || !selectedTemplate) return
    const now = new Date().toISOString()
    const entryId = generateId()
    const invoiceId = generateId()
    try {
      await db.manual_entries.add({
        id: entryId,
        workspaceId,
        templateId: selectedTemplate.id,
        templateName: selectedTemplate.name,
        rows: selectedTemplate.rows.map((r) => ({
          id: r.id,
          label: r.label,
          sortOrder: r.sortOrder,
        })),
        data,
        createdAt: now,
        updatedAt: now,
      })
    } catch (err) {
      console.error('Failed to save manual entry:', err)
      toast({ title: 'Error', description: 'Failed to save entry.', variant: 'destructive' })
      return
    }

    // Create invoice record first (without PDF blob)
    try {
      await db.invoices.add({
        id: invoiceId,
        invoiceid: invoiceId,
        workspaceId,
        totalAmount: 0,
        settlementCurrency: 'iqd',
        origin: 'manual',
        status: 'draft',
        printFormat: 'a4',
        createdAt: now,
        updatedAt: now,
        syncStatus: 'synced',
        lastSyncedAt: null,
        version: 1,
        isDeleted: false,
      })
    } catch (err) {
      console.error('Failed to create invoice record:', err)
      toast({ title: 'Error', description: 'Failed to create invoice record.', variant: 'destructive' })
      return
    }

    // Generate PDF blob and attach it to the invoice
    try {
      const tableElement = renderTableElement(selectedTemplate, data)
      const pdfBlob = await generateTemplatePdf({ element: tableElement })

      const localPath = await saveInvoicePdfToLocalAppData(workspaceId, invoiceId, 'a4', pdfBlob)

      await db.invoices.update(invoiceId, {
        localPathA4: localPath ?? undefined,
        pdfBlobA4: localPath ? undefined : pdfBlob,
      })
    } catch (err) {
      console.error('Failed to generate or save PDF:', err)
    }

    toast({
      title: (t('print.saveSuccess') as string) || 'Saved',
      description: (t('print.saveSuccessDesc') as string) || 'Manual entry saved successfully.',
    })

    return invoiceId
  }, [workspaceId, selectedTemplate, t, toast])

  if (selectedTemplate) {
    return (
      <ManualEntryA4Preview
        template={selectedTemplate}
        onBack={() => setSelectedTemplate(null)}
        onSaveAndPrint={handleSaveAndPrint}
      />
    )
  }

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="container mx-auto p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">{t('manualEntry.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('manualEntry.description')}</p>
      </div>

      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-12">
          <Button size="lg" onClick={handleCreateEntry} disabled={activeTemplates.length === 0}>
            <Printer className="mr-2 h-5 w-5" />
            {t('manualEntry.create')}
          </Button>
          {activeTemplates.length === 0 && (
            <p className="text-sm text-muted-foreground">{t('manualEntry.noTemplates')}</p>
          )}
        </CardContent>
      </Card>

      <Dialog open={isSelectionOpen} onOpenChange={(open) => !open && setIsSelectionOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              {t('manualEntry.selectTemplate')}
            </DialogTitle>
            <DialogDescription>{t('manualEntry.selectTemplateDescription')}</DialogDescription>
          </DialogHeader>
          <div className="grid max-h-[55vh] grid-cols-1 gap-3 overflow-y-auto py-2">
            {activeTemplates.map((template) => (
              <Button
                key={template.id}
                variant="outline"
                className="flex h-auto flex-col items-start gap-1 p-4 text-left"
                onClick={() => handleSelectTemplate(template)}
              >
                <span className="font-medium">{template.name}</span>
                <span className="text-xs text-muted-foreground">
                  {template.rows.length} {(t('manualEntry.rows') as string) || 'rows'}
                </span>
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
