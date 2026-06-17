import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowUp, GripVertical, Loader2, Plus, Save, Trash2, X } from 'lucide-react'
import { useAuth } from '@/auth'
import { db } from '@/local-db'
import type { ManualEntryTemplate, ManualEntryTemplateRow } from '@/local-db/models'
import { Button } from '@/ui/components/button'
import { Input } from '@/ui/components/input'
import {
  Card, CardContent,
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
  useToast,
} from '@/ui/components'
import { DeleteConfirmationModal } from '@/ui/components/DeleteConfirmationModal'
import { cn } from '@/lib/utils'

function generateId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `row-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function createEmptyRow(sortOrder: number): ManualEntryTemplateRow {
  return { id: generateId(), label: '', sortOrder }
}

export function ManualEntryTemplates() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const { user } = useAuth()
  const workspaceId = user?.workspaceId

  const [templates, setTemplates] = useState<ManualEntryTemplate[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<ManualEntryTemplate | null>(null)
  const [formName, setFormName] = useState('')
  const [formHeaderName, setFormHeaderName] = useState('')
  const [formHeaderPhone1, setFormHeaderPhone1] = useState('')
  const [formHeaderPhone2, setFormHeaderPhone2] = useState('')
  const [formDetailsLabel1, setFormDetailsLabel1] = useState('')
  const [formDetailsLabel2, setFormDetailsLabel2] = useState('')
  const [formDetailsLabel3, setFormDetailsLabel3] = useState('')
  const [formRows, setFormRows] = useState<ManualEntryTemplateRow[]>([])
  const [isSaving, setIsSaving] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<ManualEntryTemplate | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const dragItemRef = useRef<number | null>(null)
  const dragOverRef = useRef<number | null>(null)

  const fetchTemplates = useCallback(async () => {
    if (!workspaceId) return
    setIsLoading(true)
    try {
      const all = await db.manual_entry_templates
        .where('workspaceId')
        .equals(workspaceId)
        .filter((t) => !t.isDeleted)
        .toArray()
      setTemplates(all.sort((a, b) => a.createdAt.localeCompare(b.createdAt)))
    } catch (err) {
      console.error('Failed to fetch templates:', err)
    } finally {
      setIsLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    fetchTemplates()
  }, [fetchTemplates])

  const openCreateForm = useCallback(() => {
    setEditingTemplate(null)
    setFormName('')
    setFormHeaderName('')
    setFormHeaderPhone1('')
    setFormHeaderPhone2('')
    setFormDetailsLabel1('')
    setFormDetailsLabel2('')
    setFormDetailsLabel3('')
    setFormRows([createEmptyRow(1)])
    setIsFormOpen(true)
  }, [])

  const openEditForm = useCallback((template: ManualEntryTemplate) => {
    setEditingTemplate(template)
    setFormName(template.name)
    setFormHeaderName(template.headerName || '')
    setFormHeaderPhone1(template.headerPhone1 || '')
    setFormHeaderPhone2(template.headerPhone2 || '')
    setFormDetailsLabel1(template.detailsLabel1 || '')
    setFormDetailsLabel2(template.detailsLabel2 || '')
    setFormDetailsLabel3(template.detailsLabel3 || '')
    setFormRows([...template.rows].sort((a, b) => a.sortOrder - b.sortOrder))
    setIsFormOpen(true)
  }, [])

  const addRow = useCallback(() => {
    const maxSort = formRows.reduce((max, r) => Math.max(max, r.sortOrder), 0)
    setFormRows([...formRows, createEmptyRow(maxSort + 1)])
  }, [formRows])

  const removeRow = useCallback((rowId: string) => {
    setFormRows((prev) => {
      const filtered = prev.filter((r) => r.id !== rowId)
      return filtered.map((r, i) => ({ ...r, sortOrder: i + 1 }))
    })
  }, [])

  const updateRow = useCallback((rowId: string, label: string) => {
    setFormRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, label } : r)))
  }, [])

  const moveRow = useCallback((index: number, direction: 'up' | 'down') => {
    setFormRows((prev) => {
      const target = direction === 'up' ? index - 1 : index + 1
      if (target < 0 || target >= prev.length) return prev
      const next = [...prev]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next.map((r, i) => ({ ...r, sortOrder: i + 1 }))
    })
  }, [])

  const handleDragStart = useCallback((index: number) => {
    dragItemRef.current = index
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault()
    dragOverRef.current = index
  }, [])

  const handleDrop = useCallback(() => {
    const from = dragItemRef.current
    const to = dragOverRef.current
    if (from === null || to === null || from === to) {
      dragItemRef.current = null
      dragOverRef.current = null
      return
    }
    setFormRows((prev) => {
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      const adjustedTo = from < to ? to - 1 : to
      next.splice(adjustedTo, 0, moved)
      return next.map((r, i) => ({ ...r, sortOrder: i + 1 }))
    })
    dragItemRef.current = null
    dragOverRef.current = null
  }, [])

  const handleSave = useCallback(async () => {
    if (!workspaceId || !formName.trim()) return
    setIsSaving(true)
    try {
      const now = new Date().toISOString()
      const rows = formRows
        .filter((r) => r.label.trim())
        .map((r, i) => ({ ...r, sortOrder: i + 1 }))

      const headerData = {
        headerName: formHeaderName.trim(),
        headerPhone1: formHeaderPhone1.trim(),
        headerPhone2: formHeaderPhone2.trim(),
        detailsLabel1: formDetailsLabel1.trim() || undefined,
        detailsLabel2: formDetailsLabel2.trim() || undefined,
        detailsLabel3: formDetailsLabel3.trim() || undefined,
      }

      if (editingTemplate) {
        await db.manual_entry_templates.update(editingTemplate.id, {
          name: formName.trim(),
          rows,
          ...headerData,
          updatedAt: now,
        })
      } else {
        await db.manual_entry_templates.add({
          id: generateId(),
          workspaceId,
          name: formName.trim(),
          rows,
          ...headerData,
          status: 'active',
          createdBy: user?.id || null,
          createdAt: now,
          updatedAt: now,
          syncStatus: 'synced',
          lastSyncedAt: null,
          version: 1,
          isDeleted: false,
        })
      }
      toast({ title: t('manualEntry.templateSaved') })
      setIsFormOpen(false)
      await fetchTemplates()
    } catch (err) {
      console.error('Failed to save template:', err)
    } finally {
      setIsSaving(false)
    }
  }, [workspaceId, formName, formHeaderName, formHeaderPhone1, formHeaderPhone2, formDetailsLabel1, formDetailsLabel2, formDetailsLabel3, formRows, editingTemplate, user?.id, t, toast, fetchTemplates])

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return
    setIsDeleting(true)
    try {
      await db.manual_entry_templates.update(deleteTarget.id, {
        isDeleted: true,
        updatedAt: new Date().toISOString(),
      })
      toast({ title: t('manualEntry.templateDeleted') })
      setDeleteTarget(null)
      await fetchTemplates()
    } catch (err) {
      console.error('Failed to delete template:', err)
    } finally {
      setIsDeleting(false)
    }
  }, [deleteTarget, t, toast, fetchTemplates])

  const sortedFormRows = useMemo(
    () => [...formRows].sort((a, b) => a.sortOrder - b.sortOrder),
    [formRows],
  )

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="container mx-auto p-4 sm:p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('manualEntry.templates')}</h1>
          <p className="text-sm text-muted-foreground">{t('manualEntry.description')}</p>
        </div>
        <Button onClick={openCreateForm}>
          <Plus className="mr-2 h-4 w-4" />
          {t('manualEntry.createTemplate')}
        </Button>
      </div>

      {templates.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12">
            <p className="text-lg font-medium text-muted-foreground">{t('manualEntry.empty')}</p>
            <p className="text-sm text-muted-foreground">{t('manualEntry.emptyDescription')}</p>
            <Button onClick={openCreateForm}>
              <Plus className="mr-2 h-4 w-4" />
              {t('manualEntry.createTemplate')}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('manualEntry.templateName')}</TableHead>
                <TableHead>{t('manualEntry.rows')}</TableHead>
                <TableHead className="w-24">{t('common.actions') || 'Actions'}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.map((template) => (
                <TableRow key={template.id}>
                  <TableCell className="font-medium">{template.name}</TableCell>
                  <TableCell>{template.rows.length}</TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => openEditForm(template)}>
                        {t('manualEntry.editTemplate') || 'Edit'}
                      </Button>
                      <Button variant="destructive" size="sm" onClick={() => setDeleteTarget(template)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <Dialog open={isFormOpen} onOpenChange={(open) => !open && setIsFormOpen(false)}>
        <DialogContent
          className="top-[calc(50%+var(--titlebar-height)/2+var(--safe-area-top)/2)]
                     flex max-h-[calc(100dvh-var(--titlebar-height)-var(--safe-area-top)-var(--safe-area-bottom)-0.75rem)]
                     w-[calc(100vw-0.75rem)] max-w-3xl flex-col overflow-hidden
                     rounded-[1.25rem] border-border/60 p-0
                     sm:w-full sm:max-h-[min(calc(100dvh-var(--titlebar-height)-var(--safe-area-top)-var(--safe-area-bottom)-2rem),820px)]
                     sm:rounded-[1.75rem]"
        >
          <DialogHeader className="border-b bg-muted/30 px-4 py-4 pr-14 text-start sm:px-6 sm:py-5">
            <DialogTitle>
              {editingTemplate ? t('manualEntry.editTemplate') : t('manualEntry.createTemplate')}
            </DialogTitle>
            <DialogDescription>
              {t('manualEntry.templateDescription') || 'Configure the entry template fields and layout.'}
            </DialogDescription>
          </DialogHeader>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4 sm:p-6">
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium">
                  {t('manualEntry.templateName')}
                </label>
                <Input
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder={t('manualEntry.templateNamePlaceholder')}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    {t('manualEntry.headerName')}
                  </label>
                  <Input
                    value={formHeaderName}
                    onChange={(e) => setFormHeaderName(e.target.value)}
                    placeholder={t('manualEntry.headerNamePlaceholder')}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    {t('manualEntry.headerPhone1')}
                  </label>
                  <Input
                    value={formHeaderPhone1}
                    onChange={(e) => setFormHeaderPhone1(e.target.value)}
                    placeholder={t('manualEntry.headerPhonePlaceholder')}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    {t('manualEntry.headerPhone2')}
                  </label>
                  <Input
                    value={formHeaderPhone2}
                    onChange={(e) => setFormHeaderPhone2(e.target.value)}
                    placeholder={t('manualEntry.headerPhonePlaceholder')}
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    {t('manualEntry.detailsLabel1')}
                  </label>
                  <Input
                    value={formDetailsLabel1}
                    onChange={(e) => setFormDetailsLabel1(e.target.value)}
                    placeholder={t('manualEntry.detailsLabelPlaceholder')}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    {t('manualEntry.detailsLabel2')}
                  </label>
                  <Input
                    value={formDetailsLabel2}
                    onChange={(e) => setFormDetailsLabel2(e.target.value)}
                    placeholder={t('manualEntry.detailsLabelPlaceholder')}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    {t('manualEntry.detailsLabel3')}
                  </label>
                  <Input
                    value={formDetailsLabel3}
                    onChange={(e) => setFormDetailsLabel3(e.target.value)}
                    placeholder={t('manualEntry.detailsLabelPlaceholder')}
                  />
                </div>
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label className="text-sm font-medium">{t('manualEntry.rows')}</label>
                  <Button variant="outline" size="sm" onClick={addRow}>
                    <Plus className="mr-1 h-3 w-3" />
                    {t('manualEntry.addRow')}
                  </Button>
                </div>
                {sortedFormRows.length === 0 ? (
                  <p className="py-4 text-center text-sm text-muted-foreground">
                    {t('manualEntry.noRows')}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {sortedFormRows.map((row, index) => (
                      <div
                        key={row.id}
                        draggable
                        onDragStart={() => handleDragStart(index)}
                        onDragOver={(e) => handleDragOver(e, index)}
                        onDrop={handleDrop}
                        onDragEnd={() => { dragItemRef.current = null; dragOverRef.current = null }}
                        className={cn(
                          'flex items-center gap-2 rounded-lg border bg-card p-2 transition-opacity',
                          dragOverRef.current === index && 'opacity-60'
                        )}
                      >
                        <div className="flex items-center gap-1">
                          <div className="flex flex-col gap-0.5">
                            <button
                              type="button"
                              onClick={() => moveRow(index, 'up')}
                              disabled={index === 0}
                              className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
                            >
                              <ArrowUp className="h-3 w-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => moveRow(index, 'down')}
                              disabled={index === sortedFormRows.length - 1}
                              className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
                            >
                              <ArrowDown className="h-3 w-3" />
                            </button>
                          </div>
                          <div className="cursor-grab touch-none rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground active:cursor-grabbing">
                            <GripVertical className="h-4 w-4" />
                          </div>
                        </div>
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-muted text-xs font-medium">
                          {row.sortOrder}
                        </span>
                        <Input
                          value={row.label}
                          onChange={(e) => updateRow(row.id, e.target.value)}
                          placeholder={t('manualEntry.rowLabelPlaceholder')}
                          className="flex-1"
                        />
                        <button
                          type="button"
                          onClick={() => removeRow(row.id)}
                          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-destructive"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
          <DialogFooter className="border-t bg-muted/20 px-4 py-4 pb-[calc(1rem+var(--safe-area-bottom))] sm:justify-between sm:px-6">
            <Button variant="outline" className="w-full sm:w-auto" onClick={() => setIsFormOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button className="w-full sm:w-auto" onClick={handleSave} disabled={isSaving || !formName.trim()}>
              {isSaving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              {t('manualEntry.saveTemplate')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeleteConfirmationModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        itemName={deleteTarget?.name || ''}
        isLoading={isDeleting}
        title={t('manualEntry.confirmDelete')}
        description={t('manualEntry.confirmDeleteDescription')}
      />
    </div>
  )
}
