import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation } from 'wouter'
import { useTranslation } from 'react-i18next'
import { ArrowRight, FileText, Loader2, Plus, RefreshCw } from 'lucide-react'

import { isSupabaseConfigured, supabase, useAuth } from '@/auth'
import { Button } from '@/ui/components/button'
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectLabel,
    SelectTrigger,
    SelectValue,
    Switch,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
    useToast
} from '@/ui/components'
import {
    CUSTOM_TEMPLATE_TARGETS,
    createCustomTemplatePreview,
    getCustomTemplateDisplayName,
    getCustomTemplateTarget
} from '@/lib/customTemplates'
import { setInvoicePreviewSource, type CustomTemplateLayout } from '@/lib/pdfPreviewStore'
import { formatDateTime } from '@/lib/utils'
import { normalizeSupabaseActionError, runSupabaseAction } from '@/lib/supabaseRequest'
import { useWorkspace } from '@/workspace'
import { useWorkspaceContacts } from '@/local-db/hooks'
import { r2Service } from '@/services/r2Service'
import {
    listLocalCustomTemplates,
    replaceMirroredCustomTemplates,
    saveLocalCustomTemplate,
    updateLocalCustomTemplateStatus,
    type LocalCustomTemplateRow as CustomTemplateRow
} from '@/local-db'

function readStoredLayout(row?: CustomTemplateRow | null): CustomTemplateLayout | null {
    if (!row || !row.layout_json || typeof row.layout_json !== 'object') return null

    const layout = row.layout_json as Partial<CustomTemplateLayout>

    return {
        version: 1,
        label: row.label?.trim() || (typeof layout.label === 'string' ? layout.label : undefined),
        moduleTypeKey: typeof layout.moduleTypeKey === 'string' ? layout.moduleTypeKey : row.module_type_key,
        nativeTemplateKey: typeof layout.nativeTemplateKey === 'string' ? layout.nativeTemplateKey : undefined,
        page: {
            widthMm: layout.page?.widthMm || 210,
            heightMm: layout.page?.heightMm || 297
        },
        fields: layout.fields || {},
        annotations: layout.annotations || [],
        texts: layout.texts || [],
        images: layout.images || [],
        updatedAt: typeof layout.updatedAt === 'string' ? layout.updatedAt : row.updated_at
    }
}

function countLayoutItems(row: CustomTemplateRow) {
    const layout = readStoredLayout(row)
    if (!layout) return 0
    return layout.annotations.length + layout.texts.length + layout.images.length + Object.keys(layout.fields).length
}

function collectLayoutImagePaths(layout?: CustomTemplateLayout | null) {
    const paths = new Set<string>()
    for (const image of layout?.images || []) {
        const path = typeof image?.path === 'string' ? image.path.trim() : ''
        if (!path || path.startsWith('http') || path.startsWith('data:') || path.startsWith('blob:')) {
            continue
        }
        paths.add(path.replace(/\\/g, '/'))
    }
    return paths
}

function getR2KeyForStoredMediaPath(path: string, workspaceId: string) {
    const parts = path.replace(/\\/g, '/').split('/').filter(Boolean)
    if (parts.length < 3) return null

    const [folderPart, wsPart, ...restPath] = parts
    if (wsPart !== workspaceId || restPath.length === 0) return null

    return `${wsPart}/${folderPart}/${restPath.join('/')}`
}

export function CustomTemplates() {
    const { t, i18n } = useTranslation()
    const { toast } = useToast()
    const { user } = useAuth()
    const {
        features,
        hasFeature,
        workspaceName,
        isLocalMode,
        isDemoMode,
        isHybridMode
    } = useWorkspace()
    const [, setLocation] = useLocation()
    const [templates, setTemplates] = useState<CustomTemplateRow[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [isAddOpen, setIsAddOpen] = useState(false)
    const [selectedModuleTypeKey, setSelectedModuleTypeKey] = useState(CUSTOM_TEMPLATE_TARGETS[0]?.moduleTypeKey || '')

    const workspaceId = user?.workspaceId
    const canPersistTemplates = isLocalMode || isSupabaseConfigured
    const workspaceContacts = useWorkspaceContacts(workspaceId)
    const canManageTemplates = user?.role === 'admin'
    const workspaceFooterContacts = useMemo(() => {
        const pickContactPair = (type: 'address' | 'email' | 'phone') => {
            const contactsOfType = workspaceContacts.filter((contact) =>
                contact.type === type
                && typeof contact.value === 'string'
                && contact.value.trim().length > 0
            )

            if (contactsOfType.length === 0) return {}

            const primaryContact = contactsOfType.find((contact) => contact.isPrimary) || contactsOfType[0]
            const nonPrimaryContact = contactsOfType.find((contact) => contact.id !== primaryContact.id)

            return {
                primary: primaryContact.value.trim(),
                nonPrimary: nonPrimaryContact?.value.trim()
            }
        }

        return {
            address: pickContactPair('address'),
            email: pickContactPair('email'),
            phone: pickContactPair('phone')
        }
    }, [workspaceContacts])
    const availableTargets = useMemo(
        () => CUSTOM_TEMPLATE_TARGETS.filter((target) => hasFeature(target.workspaceModuleKey)),
        [hasFeature]
    )
    const selectedTarget = useMemo(
        () => availableTargets.find((target) => target.moduleTypeKey === selectedModuleTypeKey),
        [availableTargets, selectedModuleTypeKey]
    )

    useEffect(() => {
        if (availableTargets.length === 0) return
        if (!availableTargets.some((target) => target.moduleTypeKey === selectedModuleTypeKey)) {
            setSelectedModuleTypeKey(availableTargets[0].moduleTypeKey)
        }
    }, [availableTargets, selectedModuleTypeKey])

    const loadCloudTemplates = useCallback(async () => {
        if (!workspaceId) {
            throw new Error('Missing workspace context.')
        }

        const { data, error: fetchError } = await runSupabaseAction('customTemplates.fetch', () =>
            supabase
                .from('custom_templates')
                .select('id, workspace_id, module_type_key, label, layout_json, active, primary, created_by, updated_by, created_at, updated_at')
                .eq('workspace_id', workspaceId)
                .order('primary', { ascending: false })
                .order('updated_at', { ascending: false })
        )
        if (fetchError) throw normalizeSupabaseActionError(fetchError)

        const cloudTemplates = (data || []) as CustomTemplateRow[]
        if (isHybridMode) {
            await replaceMirroredCustomTemplates(workspaceId, cloudTemplates)
        }
        return cloudTemplates
    }, [isHybridMode, workspaceId])

    const fetchTemplates = useCallback(async () => {
        if (!workspaceId || (!isLocalMode && !isSupabaseConfigured)) {
            setTemplates([])
            setIsLoading(false)
            return
        }

        setIsLoading(true)
        setError(null)
        try {
            if (isLocalMode) {
                setTemplates(await listLocalCustomTemplates(workspaceId))
            } else {
                setTemplates(await loadCloudTemplates())
            }
        } catch (err) {
            const message = isLocalMode
                ? (err instanceof Error ? err.message : String(err))
                : normalizeSupabaseActionError(err).message
            setError(message)
            if (isHybridMode && workspaceId) {
                try {
                    setTemplates(await listLocalCustomTemplates(workspaceId))
                } catch {
                    setTemplates([])
                }
            } else {
                setTemplates([])
            }
        } finally {
            setIsLoading(false)
        }
    }, [isHybridMode, isLocalMode, loadCloudTemplates, workspaceId])

    useEffect(() => {
        void fetchTemplates()
    }, [fetchTemplates])

    const saveTemplateLayout = useCallback(async (
        layout: CustomTemplateLayout,
        options?: { label?: string },
        templateId?: string
    ) => {
        if (!workspaceId || !user?.id) {
            throw new Error('Missing workspace context.')
        }

        const label = options?.label?.trim() || layout.label?.trim() || getCustomTemplateDisplayName(layout.moduleTypeKey)
        const layoutWithLabel: CustomTemplateLayout = {
            ...layout,
            label
        }

        if (isLocalMode) {
            await saveLocalCustomTemplate({
                id: templateId,
                workspaceId,
                moduleTypeKey: layout.moduleTypeKey,
                label,
                layoutJson: layoutWithLabel,
                userId: user.id
            })
        } else {
            if (!isSupabaseConfigured) {
                throw new Error('Supabase must be configured before custom templates can be saved.')
            }

            const existingTemplate = templateId
                ? templates.find((template) => template.id === templateId)
                : undefined
            const previousImagePaths = collectLayoutImagePaths(readStoredLayout(existingTemplate))
            const nextImagePaths = collectLayoutImagePaths(layoutWithLabel)
            const pathsUsedByOtherTemplates = new Set<string>()
            for (const template of templates) {
                if (template.id === existingTemplate?.id) continue
                for (const path of collectLayoutImagePaths(readStoredLayout(template))) {
                    pathsUsedByOtherTemplates.add(path)
                }
            }
            const removedImagePaths = Array.from(previousImagePaths).filter((path) =>
                !nextImagePaths.has(path) && !pathsUsedByOtherTemplates.has(path)
            )
            const payload = {
                workspace_id: workspaceId,
                module_type_key: layout.moduleTypeKey,
                label,
                layout_json: layoutWithLabel,
                updated_by: user.id
            }
            const { error: saveError } = existingTemplate
                ? await runSupabaseAction('customTemplates.update', () =>
                    supabase
                        .from('custom_templates')
                        .update(payload)
                        .eq('id', existingTemplate.id)
                        .eq('workspace_id', workspaceId)
                )
                : await runSupabaseAction('customTemplates.create', () =>
                    supabase
                        .from('custom_templates')
                        .insert({
                            ...payload,
                            created_by: user.id,
                            active: true,
                            primary: false
                        })
                )
            if (saveError) throw normalizeSupabaseActionError(saveError)

            if (removedImagePaths.length > 0 && r2Service.isConfigured()) {
                const deleteResults = await Promise.allSettled(
                    removedImagePaths.map(async (path) => {
                        const r2Key = getR2KeyForStoredMediaPath(path, workspaceId)
                        if (r2Key) await r2Service.delete(r2Key)
                    })
                )
                deleteResults.forEach((result, index) => {
                    if (result.status === 'rejected') {
                        console.error('[CustomTemplates] Failed to delete removed template image from R2:', removedImagePaths[index], result.reason)
                    }
                })
            }
        }

        if (isLocalMode) {
            await fetchTemplates()
        } else {
            setTemplates(await loadCloudTemplates())
        }

        toast({
            title: t('customTemplates.savedTitle', { defaultValue: 'Template saved' }),
            description: isDemoMode
                ? t('customTemplates.savedDemoDescription', {
                    defaultValue: 'The custom print layout was saved in IndexedDB for this demo session.'
                })
                : isLocalMode
                ? t('customTemplates.savedLocalDescription', {
                    defaultValue: 'The custom print layout was saved to atlas-local-mode.db.'
                })
                : isHybridMode
                    ? t('customTemplates.savedHybridDescription', {
                        defaultValue: 'The custom print layout was saved to Supabase and mirrored to atlas-local-mode.db.'
                    })
                : t('customTemplates.savedDescription', {
                    defaultValue: 'The custom print layout was saved to Supabase.'
                })
        })
    }, [fetchTemplates, isDemoMode, isHybridMode, isLocalMode, loadCloudTemplates, t, templates, toast, user?.id, workspaceId])

    const openPreview = useCallback((moduleTypeKey: string, template?: CustomTemplateRow) => {
        const target = availableTargets.find((item) => item.moduleTypeKey === moduleTypeKey)
        if (!target || !workspaceId) return

        setInvoicePreviewSource({
            title: t('customTemplates.previewTitle', {
                defaultValue: '{{name}} Custom Template',
                name: getCustomTemplateDisplayName(moduleTypeKey)
            }),
            workspaceId,
            templatePreview: createCustomTemplatePreview(target, {
                workspaceId,
                workspaceName,
                features,
                workspaceFooterContacts,
                printLang: features.print_lang && features.print_lang !== 'auto'
                    ? features.print_lang
                    : i18n.language
            }),
            customTemplate: {
                moduleTypeKey,
                nativeTemplateKey: target.nativeTemplateKey,
                templateId: template?.id,
                label: template?.label?.trim() || readStoredLayout(template)?.label || getCustomTemplateDisplayName(moduleTypeKey)
            },
            effectiveId: template?.id || `custom-template-${moduleTypeKey}`,
            initialTemplateLayout: readStoredLayout(template),
            onSaveTemplateLayout: (layout, options) => saveTemplateLayout(layout, options, template?.id)
        })

        setIsAddOpen(false)
        setLocation('/pdf-preview')
    }, [availableTargets, features, i18n.language, saveTemplateLayout, setLocation, t, workspaceFooterContacts, workspaceId, workspaceName])

    const updateTemplateStatus = useCallback(async (
        template: CustomTemplateRow,
        changes: Partial<Pick<CustomTemplateRow, 'active' | 'primary'>>
    ) => {
        if (!workspaceId || !canManageTemplates) return

        if (changes.primary && !(changes.active ?? template.active)) {
            toast({
                title: t('customTemplates.statusErrorTitle', { defaultValue: 'Invalid template status' }),
                description: t('customTemplates.primaryRequiresActive', {
                    defaultValue: 'Activate the template before making it primary.'
                }),
                variant: 'destructive'
            })
            return
        }

        if (changes.active === false && template.primary) {
            const hasReplacement = templates.some((candidate) =>
                candidate.id !== template.id
                && candidate.module_type_key === template.module_type_key
                && candidate.active
            )
            if (!hasReplacement) {
                toast({
                    title: t('customTemplates.statusErrorTitle', { defaultValue: 'Invalid template status' }),
                    description: t('customTemplates.primaryReplacementRequired', {
                        defaultValue: 'Create or activate another template before deactivating the current primary template.'
                    }),
                    variant: 'destructive'
                })
                return
            }
        }

        try {
            const nextChanges = changes.active === false
                ? { ...changes, primary: false }
                : changes
            if (isLocalMode) {
                await updateLocalCustomTemplateStatus(workspaceId, template.id, nextChanges, user?.id)
            } else {
                const { error: updateError } = await runSupabaseAction('customTemplates.updateStatus', () =>
                    supabase
                        .from('custom_templates')
                        .update({
                            ...nextChanges,
                            updated_by: user?.id || null
                        })
                        .eq('id', template.id)
                        .eq('workspace_id', workspaceId)
                )
                if (updateError) throw normalizeSupabaseActionError(updateError)
            }
            if (isLocalMode) {
                await fetchTemplates()
            } else {
                setTemplates(await loadCloudTemplates())
            }
        } catch (statusError) {
            toast({
                title: t('customTemplates.statusErrorTitle', { defaultValue: 'Could not update template' }),
                description: isLocalMode
                    ? (statusError instanceof Error ? statusError.message : String(statusError))
                    : normalizeSupabaseActionError(statusError).message,
                variant: 'destructive'
            })
        }
    }, [canManageTemplates, fetchTemplates, isLocalMode, loadCloudTemplates, t, templates, toast, user?.id, workspaceId])

    return (
        <div className="space-y-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                    <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
                        <FileText className="h-7 w-7" />
                        {t('customTemplates.title', { defaultValue: 'Custom Templates' })}
                    </h1>
                    <p className="text-sm text-muted-foreground">
                        {t('customTemplates.subtitle', {
                            defaultValue: 'Manage workspace print layout customizations by module and print type.'
                        })}
                    </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <Button variant="outline" className="gap-2" onClick={() => void fetchTemplates()} disabled={isLoading || !canPersistTemplates}>
                        {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                        {t('common.refresh', { defaultValue: 'Refresh' })}
                    </Button>
                    <Button className="gap-2" onClick={() => setIsAddOpen(true)} disabled={!canPersistTemplates || !canManageTemplates || availableTargets.length === 0}>
                        <Plus className="h-4 w-4" />
                        {t('customTemplates.addNew', { defaultValue: 'Add New Template' })}
                    </Button>
                </div>
            </div>

            {!isLocalMode && !isSupabaseConfigured && (
                <Card>
                    <CardContent className="py-6 text-sm text-muted-foreground">
                        {t('customTemplates.supabaseRequired', {
                            defaultValue: 'Supabase must be configured before custom templates can be saved in cloud or hybrid mode.'
                        })}
                    </CardContent>
                </Card>
            )}

            {error && (
                <Card className="border-destructive/40">
                    <CardContent className="py-4 text-sm text-destructive">{error}</CardContent>
                </Card>
            )}

            <Card>
                <CardHeader>
                    <CardTitle>{t('customTemplates.existingTitle', { defaultValue: 'Existing Custom Templates' })}</CardTitle>
                    <CardDescription>
                        {t('customTemplates.existingDescription', {
                            defaultValue: 'Saved layout JSON is scoped to the current workspace and module/type key.'
                        })}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {isLoading ? (
                        <div className="flex min-h-48 items-center justify-center">
                            <Loader2 className="h-6 w-6 animate-spin text-primary" />
                        </div>
                    ) : templates.length === 0 ? (
                        <div className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-md border border-dashed text-center">
                            <FileText className="h-8 w-8 text-muted-foreground" />
                            <div>
                                <p className="font-medium">
                                    {t('customTemplates.emptyTitle', { defaultValue: 'No custom templates yet' })}
                                </p>
                                <p className="text-sm text-muted-foreground">
                                    {t('customTemplates.emptyDescription', {
                                        defaultValue: 'Create a print customization to save the first layout.'
                                    })}
                                </p>
                            </div>
                        </div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>{t('customTemplates.table.template', { defaultValue: 'Template' })}</TableHead>
                                    <TableHead>{t('customTemplates.table.key', { defaultValue: 'Module/Type Key' })}</TableHead>
                                    <TableHead>{t('customTemplates.table.layout', { defaultValue: 'Layout Items' })}</TableHead>
                                    <TableHead>{t('customTemplates.table.active', { defaultValue: 'Active' })}</TableHead>
                                    <TableHead>{t('customTemplates.table.primary', { defaultValue: 'Primary' })}</TableHead>
                                    <TableHead>{t('customTemplates.table.updated', { defaultValue: 'Updated' })}</TableHead>
                                    <TableHead className="text-end">{t('common.actions', { defaultValue: 'Actions' })}</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {templates.map((template) => {
                                    const target = getCustomTemplateTarget(template.module_type_key)
                                    const targetAvailable = availableTargets.some((item) => item.moduleTypeKey === template.module_type_key)
                                    const storedLayout = readStoredLayout(template)
                                    const templateLabel = template.label?.trim() || storedLayout?.label || getCustomTemplateDisplayName(template.module_type_key)
                                    return (
                                        <TableRow key={template.id}>
                                            <TableCell>
                                                <div className="font-medium">{templateLabel}</div>
                                                <div className="text-xs text-muted-foreground">
                                                    {getCustomTemplateDisplayName(template.module_type_key)}
                                                    {target?.description
                                                        ? ` - ${target.description}`
                                                        : ` - ${t('customTemplates.unknownTarget', { defaultValue: 'Custom print layout' })}`}
                                                </div>
                                            </TableCell>
                                            <TableCell className="font-mono text-xs">{template.module_type_key}</TableCell>
                                            <TableCell>{countLayoutItems(template)}</TableCell>
                                            <TableCell>
                                                <Switch
                                                    checked={template.active}
                                                    onCheckedChange={(checked) => void updateTemplateStatus(template, { active: checked })}
                                                    disabled={!canPersistTemplates || !canManageTemplates}
                                                    aria-label={`Toggle ${templateLabel} active status`}
                                                />
                                            </TableCell>
                                            <TableCell>
                                                <Switch
                                                    checked={template.primary}
                                                    onCheckedChange={(checked) => {
                                                        if (checked) void updateTemplateStatus(template, { primary: true })
                                                    }}
                                                    disabled={!canPersistTemplates || !canManageTemplates || !template.active || template.primary}
                                                    aria-label={`Make ${templateLabel} primary`}
                                                />
                                            </TableCell>
                                            <TableCell>{formatDateTime(template.updated_at)}</TableCell>
                                            <TableCell className="text-end">
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    className="gap-2"
                                                    onClick={() => openPreview(template.module_type_key, template)}
                                                    disabled={!canPersistTemplates || !canManageTemplates || !targetAvailable}
                                                >
                                                    <FileText className="h-4 w-4" />
                                                    {t('customTemplates.customize', { defaultValue: 'Customize' })}
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    )
                                })}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>

            <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t('customTemplates.addTitle', { defaultValue: 'Add New Template' })}</DialogTitle>
                        <DialogDescription>
                            {t('customTemplates.addDescription', {
                                defaultValue: 'Select the module and print type to customize.'
                            })}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4">
                        <div className="space-y-2">
                            <p className="text-sm font-medium">
                                {t('customTemplates.moduleTypeLabel', { defaultValue: 'Module / Print Type' })}
                            </p>
                            <Select value={selectedModuleTypeKey} onValueChange={setSelectedModuleTypeKey}>
                                <SelectTrigger>
                                    <SelectValue placeholder={t('customTemplates.selectPlaceholder', { defaultValue: 'Select module/type' })} />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectGroup>
                                        <SelectLabel>{t('customTemplates.availableTypes', { defaultValue: 'Available Print Types' })}</SelectLabel>
                                        {availableTargets.map((target) => (
                                            <SelectItem key={target.moduleTypeKey} value={target.moduleTypeKey}>
                                                {target.moduleLabel} - {target.typeLabel}
                                            </SelectItem>
                                        ))}
                                    </SelectGroup>
                                </SelectContent>
                            </Select>
                        </div>

                        {availableTargets.length === 0 && (
                            <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                                {t('customTemplates.noSupportedTargets', {
                                    defaultValue: 'No supported print template types are available for this workspace.'
                                })}
                            </div>
                        )}

                        {selectedTarget && (
                            <div className="rounded-md border bg-muted/30 p-3 text-sm">
                                <div className="font-medium">{selectedTarget.moduleTypeKey}</div>
                                <div className="mt-1 text-muted-foreground">{selectedTarget.description}</div>
                            </div>
                        )}
                    </div>

                    <DialogFooter>
                        {selectedTarget && (
                            <Button className="gap-2" onClick={() => openPreview(selectedTarget.moduleTypeKey)}>
                                {t('customTemplates.openPreview', { defaultValue: 'Open Print Preview' })}
                                <ArrowRight className="h-4 w-4" />
                            </Button>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
