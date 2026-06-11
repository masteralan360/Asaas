import { type FormEvent, useEffect, useState, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Printer, Loader2, Edit3, X, ZoomIn, ZoomOut, Maximize, ImagePlus, Trash2, PenTool, Brush, Palette, Eraser, Hand, Type, RotateCw, Scaling, Move, Languages, Check } from 'lucide-react'
import {
    getInvoicePreviewSource,
    clearInvoicePreviewSource,
    type CustomTemplateAnnotation,
    type CustomTemplateImage,
    type CustomTemplateLayout,
    type CustomTemplateText
} from '@/lib/pdfPreviewStore'
import { platformService } from '@/services/platformService'
import { EditableField } from '@/ui/components/EditableField'
import {
    A4InvoiceTemplate,
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Input,
    Label,
    ModernA4InvoiceTemplate,
    RefundA4InvoiceTemplate,
    RefundPrimaryA4InvoiceTemplate
} from '@/ui/components'
import { SaleReceiptBase } from '@/ui/components/SaleReceipt'
import { DeleteConfirmationModal } from '@/ui/components/DeleteConfirmationModal'
import { cn } from '@/lib/utils'
import type { UniversalInvoice } from '@/types'
import { useAuth } from '@/auth/AuthContext'
import { UiAccessGate } from '@/context/UiAccessContext'

const LanguageSelector = ({ value, onChange }: { value: string, onChange: (val: string) => void }) => {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const languages = [
        { id: 'auto', label: 'Auto Lang' },
        { id: 'en', label: 'English' },
        { id: 'ar', label: 'العربية' },
        { id: 'ku', label: 'Kurdish' }
    ];

    const currentLabel = languages.find(l => l.id === value)?.label || 'Auto Lang';

    return (
        <div className="relative" ref={containerRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={cn(
                    "h-7 px-2 flex items-center gap-2 rounded transition-all outline-none",
                    isOpen ? "bg-accent text-accent-foreground shadow-inner" : "hover:bg-accent text-muted-foreground"
                )}
                title="Temporary Print Language"
            >
                <Languages className="h-3.5 w-3.5" />
                <span className="text-[11px] font-bold whitespace-nowrap">{currentLabel}</span>
            </button>

            {isOpen && (
                <div className="absolute top-full left-0 mt-1.5 w-32 bg-card border rounded-lg shadow-xl py-1 z-50 animate-in fade-in zoom-in duration-100">
                    {languages.map((lang) => (
                        <button
                            key={lang.id}
                            onClick={() => {
                                onChange(lang.id);
                                setIsOpen(false);
                            }}
                            className={cn(
                                "w-full px-3 py-1.5 flex items-center justify-between text-[11px] transition-colors",
                                value === lang.id ? "bg-primary/10 text-primary font-bold" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                            )}
                        >
                            <span>{lang.label}</span>
                            {value === lang.id && <Check className="h-3 w-3" />}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};


function EditableInvoicePreview({
    data,
    features,
    workspaceId,
    workspaceName,
    workspaceFooterContacts,
    printFormat,
    onDataChange,
    drawingMode,
}: {
    data: UniversalInvoice
    features: any
    workspaceId?: string
    workspaceName?: string
    workspaceFooterContacts?: any
    printFormat: 'a4' | 'receipt'
    onDataChange?: (data: UniversalInvoice) => void
    drawingMode?: string
}) {
    const { i18n } = useTranslation()
    const printLang = features?.print_lang && features.print_lang !== 'auto' ? features.print_lang : i18n.language
    const isRTL = printLang === 'ar' || printLang === 'ku'


    if (printFormat === 'receipt') {
        return (
            <div className="mx-auto" style={{ width: '80mm', maxWidth: '100%' }}>
                <SaleReceiptBase
                    data={data}
                    features={features}
                    workspaceName={workspaceName || 'Atlas'}
                    workspaceId={workspaceId}
                />
            </div>
        )
    }

    if (data.is_refund_invoice) {
        if (features.a4_template === 'modern') {
            return (
                <div className="max-w-[900px] mx-auto">
                    <RefundA4InvoiceTemplate
                        data={data}
                        features={features}
                        workspaceId={workspaceId}
                        workspaceName={workspaceName || 'Atlas'}
                        drawingMode={drawingMode}
                    />
                </div>
            )
        }
        return (
            <div dir={isRTL ? 'rtl' : 'ltr'} className="bg-white text-black text-sm font-sans max-w-[900px] mx-auto shadow-sm border border-gray-200">
                <RefundPrimaryA4InvoiceTemplate
                    data={data}
                    features={features}
                    workspaceId={workspaceId}
                    workspaceName={workspaceName || 'Atlas'}
                    workspaceFooterContacts={workspaceFooterContacts}
                    drawingMode={drawingMode}
                />
            </div>
        )
    }

    if (features.a4_template === 'modern') {
        return (
            <div className="max-w-[900px] mx-auto">
                <ModernA4InvoiceTemplate
                    data={data}
                    features={features}
                    workspaceId={workspaceId}
                    workspaceName={workspaceName || 'Atlas'}
                    workspaceFooterContacts={workspaceFooterContacts}
                    onDataChange={onDataChange}
                    drawingMode={drawingMode}
                />
            </div>
        )
    }

    return (
        <div dir={isRTL ? 'rtl' : 'ltr'} className="bg-white text-black text-sm font-sans max-w-[900px] mx-auto shadow-sm border border-gray-200">
            <A4InvoiceTemplate
                data={data}
                features={features}
                workspaceId={workspaceId}
                workspaceName={workspaceName || 'Atlas'}
                workspaceFooterContacts={workspaceFooterContacts}
                onDataChange={onDataChange}
                drawingMode={drawingMode}
            />
        </div>
    )
}

export function PdfPreviewPage() {
    const { t } = useTranslation()
    const { hasRole } = useAuth()
    const isAdmin = hasRole(['admin'])
    const [isSaving, setIsSaving] = useState(false)
    const [tempPrintLang, setTempPrintLang] = useState<string>('auto')

    const sourceRef = useRef(getInvoicePreviewSource())
    const source = sourceRef.current
    const [editableData, setEditableData] = useState<UniversalInvoice | null>(null)
    const [zoom, setZoom] = useState(100)
    const [isFitToWidth, setIsFitToWidth] = useState(false)
    const [drawingMode, setDrawingMode] = useState<'none' | 'pen' | 'brush' | 'eraser'>('none')
    const [brushColor, setBrushColor] = useState('#ef4444')
    const [brushSize, setBrushSize] = useState(2)
    const [isDrawing, setIsDrawing] = useState(false)
    const [currentPath, setCurrentPath] = useState<{ x: number, y: number }[] | null>(null)
    const [isClearConfirmOpen, setIsClearConfirmOpen] = useState(false)
    const [isTemplateLabelDialogOpen, setIsTemplateLabelDialogOpen] = useState(false)
    const [templateSaveLabel, setTemplateSaveLabel] = useState('')
    const [pendingTemplateLayout, setPendingTemplateLayout] = useState<CustomTemplateLayout | null>(null)
    const title = source?.title || t('pdfPreview.title') || 'Invoice Preview'

    const handleZoomIn = useCallback(() => {
        setZoom(prev => Math.min(prev + 10, 200))
        setIsFitToWidth(false)
    }, [])

    const handleZoomOut = useCallback(() => {
        setZoom(prev => Math.max(prev - 10, 50))
        setIsFitToWidth(false)
    }, [])

    const handleZoomReset = useCallback(() => {
        setZoom(100)
        setIsFitToWidth(false)
    }, [])

    const handleFitToWidth = useCallback(() => {
        setIsFitToWidth(prev => !prev)
    }, [])

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
                e.preventDefault()
                return
            }
            if (e.ctrlKey || e.metaKey) {
                if (e.key === '=' || e.key === '+') {
                    e.preventDefault()
                    handleZoomIn()
                } else if (e.key === '-') {
                    e.preventDefault()
                    handleZoomOut()
                } else if (e.key === '0') {
                    e.preventDefault()
                    handleZoomReset()
                }
            }
        }

        const handleWheel = (e: WheelEvent) => {
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault()
                if (e.deltaY < 0) {
                    handleZoomIn()
                } else {
                    handleZoomOut()
                }
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        window.addEventListener('wheel', handleWheel, { passive: false })

        return () => {
            window.removeEventListener('keydown', handleKeyDown)
            window.removeEventListener('wheel', handleWheel)
        }
    }, [handleZoomIn, handleZoomOut, handleZoomReset])

    const initialized = useRef(false)
    if (source && source.data && !initialized.current) {
        editableData === null && setEditableData({ ...source.data })
        initialized.current = true
    }

    // Template preview mode (loans, orders, budget)
    const templatePreview = source?.templatePreview
    const fixedTemplatePrintLang = templatePreview?.fixedPrintLang
    const initialTemplateLayout = source?.initialTemplateLayout
    const templatePage = initialTemplateLayout?.page || templatePreview?.page || {
        widthMm: 210,
        heightMm: 297
    }
    const templatePageWidth = templatePage.widthMm
    const templatePageHeight = templatePage.heightMm
    const canEditTemplateFields = Boolean(source?.allowTemplateFieldEditing || isAdmin)
    const [fieldValues, setFieldValues] = useState<Record<string, string> | null>(
        () => {
            if (!templatePreview) return null
            return {
                ...Object.fromEntries(templatePreview.fields.map(f => [f.key, f.value])),
                ...(source?.templateFieldValues || {}),
                ...(initialTemplateLayout?.fields || {})
            }
        }
    )
    const [editPanelOpen, setEditPanelOpen] = useState(false)

    const [templateAnnotations, setTemplateAnnotations] = useState<CustomTemplateAnnotation[]>(() => initialTemplateLayout?.annotations || [])
    const [templateTexts, setTemplateTexts] = useState<CustomTemplateText[]>(() => initialTemplateLayout?.texts || [])
    const [templateImages, setTemplateImages] = useState<CustomTemplateImage[]>(() => initialTemplateLayout?.images || [])

    const showNativePdf = source?.url && !source?.data
    const hasTemplatePrimaryAction = Boolean(
        source?.onSaveTemplateLayout
        || source?.onSave
        || source?.generateTemplateLayoutBlob
    )

    const handleBack = useCallback(() => {
        clearInvoicePreviewSource()
        window.history.back()
    }, [])

    const handleSave = useCallback(async () => {
        if (!source || !editableData || isSaving) return
        setIsSaving(true)
        try {
            if (source.generatePdfBlob) {
                const langOverride = tempPrintLang !== 'auto' ? tempPrintLang : undefined
                const blob = await source.generatePdfBlob(editableData, langOverride)
                await source.onSave?.(blob)
            } else {
                await source.onSave?.(new Blob())
            }
        } catch (err) {
            console.error('Failed to save:', err)
        } finally {
            setIsSaving(false)
            clearInvoicePreviewSource()
            window.history.back()
        }
    }, [source, editableData, isSaving, tempPrintLang])

    if (!source) {
        return (
            <div className="flex h-screen items-center justify-center bg-background"
                style={{ marginTop: 'var(--titlebar-height)', height: 'calc(100vh - var(--titlebar-height))' }}>
                <p className="text-muted-foreground">{t('common.noData') || 'No data'}</p>
            </div>
        )
    }

    const handleNativeSave = useCallback(async () => {
        if (!source || isSaving) return
        setIsSaving(true)
        try {
            await source.onSave?.(new Blob([]))
        } catch (err) {
            console.error('Failed to save:', err)
        } finally {
            setIsSaving(false)
            clearInvoicePreviewSource()
            window.history.back()
        }
    }, [source, isSaving])

    const buildTemplateLayout = useCallback((): CustomTemplateLayout | null => {
        if (!source || !templatePreview || !fieldValues || !source.customTemplate?.moduleTypeKey) {
            return null
        }

        return {
            version: 1,
            label: source.customTemplate.label || initialTemplateLayout?.label,
            moduleTypeKey: source.customTemplate.moduleTypeKey,
            nativeTemplateKey: source.customTemplate.nativeTemplateKey,
            page: {
                widthMm: templatePageWidth,
                heightMm: templatePageHeight
            },
            fields: fieldValues,
            fieldTokenTemplates: initialTemplateLayout?.fieldTokenTemplates,
            annotations: templateAnnotations,
            texts: templateTexts,
            images: templateImages,
            updatedAt: new Date().toISOString()
        }
    }, [source, templatePreview, fieldValues, initialTemplateLayout?.label, templateAnnotations, templateTexts, templateImages, templatePageHeight, templatePageWidth])

    const saveTemplatePreview = useCallback(async (layout?: CustomTemplateLayout, label?: string) => {
        if (!source || !templatePreview || !fieldValues || isSaving) return
        let shouldCloseAfterAction = true
        setIsSaving(true)
        try {
            if (layout && source.onSaveTemplateLayout) {
                await source.onSaveTemplateLayout(layout, { label })
            }

            const shouldBuildPrintBlob = source.onSave || source.generateTemplateLayoutBlob
            if (shouldBuildPrintBlob) {
                const overrideLang = fixedTemplatePrintLang || (tempPrintLang !== 'auto' ? tempPrintLang : undefined)
                const layoutForBlob = source.generateTemplateLayoutBlob
                    ? layout || buildTemplateLayout()
                    : null
                if (source.generateTemplateLayoutBlob && !layoutForBlob) {
                    throw new Error('Missing template layout for print preview.')
                }
                const blob = source.generateTemplateLayoutBlob && layoutForBlob
                    ? await source.generateTemplateLayoutBlob(layoutForBlob, overrideLang, source.effectiveId)
                    : await templatePreview.buildPdf(
                        templatePreview.createElement(fieldValues, source.effectiveId, overrideLang),
                        overrideLang
                    )

                if (!source.onSave) {
                    const url = URL.createObjectURL(blob)
                    window.open(url, '_blank', 'noopener,noreferrer')
                    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
                    shouldCloseAfterAction = false
                    return
                }

                await source.onSave(blob)
            }
        } catch (err) {
            console.error('Failed to save template preview:', err)
            shouldCloseAfterAction = false
        } finally {
            setIsSaving(false)
            if (shouldCloseAfterAction) {
                setIsTemplateLabelDialogOpen(false)
                setPendingTemplateLayout(null)
                clearInvoicePreviewSource()
                window.history.back()
            }
        }
    }, [source, templatePreview, fieldValues, isSaving, fixedTemplatePrintLang, tempPrintLang, buildTemplateLayout])

    const handleTemplatePreviewSave = useCallback(async () => {
        if (!source || !templatePreview || !fieldValues || isSaving) return

        if (source.onSaveTemplateLayout) {
            const layout = buildTemplateLayout()
            if (!layout) {
                console.error('Failed to save template preview:', new Error('Missing custom template module/type key.'))
                return
            }

            const defaultLabel = layout.label?.trim()
                || source.customTemplate?.label?.trim()
                || title
            setPendingTemplateLayout(layout)
            setTemplateSaveLabel(defaultLabel)
            setIsTemplateLabelDialogOpen(true)
            return
        }

        await saveTemplatePreview()
    }, [source, templatePreview, fieldValues, isSaving, buildTemplateLayout, saveTemplatePreview, title])

    const handleConfirmTemplateLayoutSave = useCallback(async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        if (!pendingTemplateLayout || isSaving) return

        const label = templateSaveLabel.trim()
        if (!label) return

        await saveTemplatePreview({
            ...pendingTemplateLayout,
            label,
            updatedAt: new Date().toISOString()
        }, label)
    }, [pendingTemplateLayout, isSaving, saveTemplatePreview, templateSaveLabel])

    const handleFieldChange = useCallback((key: string, value: string) => {
        setFieldValues(prev => prev ? { ...prev, [key]: value } : null)
    }, [])

    const handleAddTemplateImage = useCallback(async () => {
        if (!source?.workspaceId) return
        try {
            const relPath = await platformService.pickAndSaveImage(source.workspaceId, 'attached-images')
            if (relPath) {
                setTemplateImages(prev => [...prev, {
                    path: relPath,
                    x: Math.max(5, templatePageWidth * 0.2),
                    y: 50,
                    width: Math.max(15, templatePageWidth * 0.3)
                }])
            }
        } catch (error) {
            error instanceof Error && console.error('Failed to add image:', error.message)
        }
    }, [source?.workspaceId, templatePageWidth])

    const handleAddTemplateText = useCallback(() => {
        setTemplateTexts(prev => [...prev, {
            id: Math.random().toString(36).substr(2, 9),
            text: 'NEW TEXT',
            x: Math.max(5, templatePageWidth * 0.2),
            y: 60,
            width: Math.max(20, templatePageWidth * 0.4),
            rotation: 0,
            fontSize: 16,
            color: brushColor
        }])
    }, [brushColor, templatePageWidth])

    const handleAddImage = useCallback(async () => {
        if (!source.workspaceId) return
        try {
            const relPath = await platformService.pickAndSaveImage(source.workspaceId, 'attached-images')
            if (relPath) {
                setEditableData(prev => {
                    if (!prev) return null
                    const current = prev.attached_images || []
                    return {
                        ...prev,
                        attached_images: [...current, {
                            path: relPath,
                            x: 50, // Default mid X (mm)
                            y: 50, // Default mid Y (mm)
                            width: 60, // Default width (mm)
                        }]
                    }
                })
            }
        } catch (error) {
            error instanceof Error && console.error('Failed to add image:', error.message)
        }
    }, [source.workspaceId])

    const handleRemoveImage = useCallback((path: string) => {
        setEditableData(prev => {
            if (!prev) return null
            const current = prev.attached_images || []
            return {
                ...prev,
                attached_images: current.filter(p => p.path !== path)
            }
        })
    }, [])

    const handleAddText = useCallback(() => {
        setEditableData(prev => {
            if (!prev) return null
            const current = prev.attached_texts || []
            return {
                ...prev,
                attached_texts: [...current, {
                    id: Math.random().toString(36).substr(2, 9),
                    text: 'NEW TEXT',
                    x: 60,
                    y: 60,
                    width: 80,
                    rotation: 0,
                    fontSize: 16,
                    color: brushColor
                }]
            }
        })
    }, [brushColor])

    const handlePointerDown = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
        if (drawingMode === 'none') return
        setIsDrawing(true)
        const svg = e.currentTarget
        const rect = svg.getBoundingClientRect()
        const x = (e.clientX - rect.left) * (templatePageWidth / rect.width)
        const y = (e.clientY - rect.top) * (templatePageHeight / rect.height)
        setCurrentPath([{ x, y }])
    }, [drawingMode, templatePageHeight, templatePageWidth])

    const handlePointerMove = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
        if (!isDrawing || !currentPath || drawingMode === 'none') return
        const svg = e.currentTarget
        const rect = svg.getBoundingClientRect()
        const x = (e.clientX - rect.left) * (templatePageWidth / rect.width)
        const y = (e.clientY - rect.top) * (templatePageHeight / rect.height)
        setCurrentPath(prev => prev ? [...prev, { x, y }] : [{ x, y }])
    }, [isDrawing, currentPath, drawingMode, templatePageHeight, templatePageWidth])

    const handlePointerUp = useCallback(() => {
        if (!isDrawing || !currentPath) return
        setIsDrawing(false)
        setEditableData(prev => {
            if (!prev) return null
            const newAnnotations = [...(prev.annotations || []), {
                type: drawingMode as 'pen' | 'brush',
                points: currentPath,
                color: brushColor,
                brushSize: brushSize
            }]
            return { ...prev, annotations: newAnnotations }
        })
        setCurrentPath(null)
    }, [isDrawing, currentPath, drawingMode, brushColor, brushSize])

    if (templatePreview && fieldValues) {
        return (
            <div className="flex h-screen w-screen flex-col bg-gray-50 overflow-hidden"
                style={{ marginTop: 'var(--titlebar-height)', height: 'calc(100vh - var(--titlebar-height))' }}>
                <header className="flex items-center justify-between border-b px-4 py-2 shrink-0 bg-card z-20">
                    <div className="flex items-center gap-3 min-w-0">
                        <button
                            className="inline-flex items-center justify-center rounded-md h-8 w-8 hover:bg-accent transition-colors shrink-0"
                            onClick={handleBack}
                        >
                            <ArrowLeft className="h-4 w-4" />
                        </button>
                        <h1 className="text-sm font-semibold truncate">{title}</h1>
                    </div>

                    <div className="flex items-center gap-1 bg-secondary/50 rounded-md p-0.5 border border-border">
                        {isAdmin && (
                            <>
                                {!fixedTemplatePrintLang && (
                                    <UiAccessGate>
                                        <LanguageSelector
                                            value={tempPrintLang}
                                            onChange={(val) => setTempPrintLang(val)}
                                        />
                                        <div className="w-px h-4 bg-border mx-0.5" />
                                    </UiAccessGate>
                                )}
                                <button
                                    onClick={handleAddTemplateImage}
                                    className="h-7 px-2 inline-flex items-center gap-1.5 rounded hover:bg-accent text-primary text-[11px] font-bold"
                                    title="Add Picture"
                                >
                                    <ImagePlus className="h-3.5 w-3.5" />
                                    <span>Add Photo</span>
                                </button>
                                <div className="w-px h-4 bg-border mx-0.5" />
                                <button
                                    onClick={handleAddTemplateText}
                                    className="h-7 px-2 inline-flex items-center gap-1.5 rounded hover:bg-accent text-primary text-[11px] font-bold"
                                    title="Add Text Field"
                                >
                                    <Type className="h-3.5 w-3.5" />
                                    <span>Add Text</span>
                                </button>
                                <div className="w-px h-4 bg-border mx-0.5" />
                            </>
                        )}
                        <button
                            onClick={handleZoomOut}
                            className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-accent text-muted-foreground"
                            title={t('preview.zoomOut') || 'Zoom Out'}
                        >
                            <ZoomOut className="h-3.5 w-3.5" />
                        </button>
                        <button
                            onClick={handleZoomReset}
                            className="h-7 px-2 inline-flex items-center justify-center rounded hover:bg-accent text-[11px] font-medium min-w-[45px]"
                            title={t('preview.zoomReset') || 'Reset Zoom'}
                        >
                            {zoom}%
                        </button>
                        <button
                            onClick={handleZoomIn}
                            className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-accent text-muted-foreground"
                            title={t('preview.zoomIn') || 'Zoom In'}
                        >
                            <ZoomIn className="h-3.5 w-3.5" />
                        </button>
                        <div className="w-px h-4 bg-border mx-0.5" />
                        <button
                            onClick={handleFitToWidth}
                            className={cn(
                                "h-7 w-7 inline-flex items-center justify-center rounded transition-colors",
                                isFitToWidth ? "bg-primary text-primary-foreground" : "hover:bg-accent text-muted-foreground"
                            )}
                            title={t('preview.fitToWidth') || 'Fit to Width'}
                        >
                            <Maximize className="h-3.5 w-3.5" />
                        </button>
                        <div className="w-px h-4 bg-border mx-0.5" />
                        <div className="flex items-center gap-0.5">
                            <button
                                onClick={() => setDrawingMode('none')}
                                className={cn(
                                    "h-7 w-7 inline-flex items-center justify-center rounded transition-colors",
                                    drawingMode === 'none' ? "bg-primary text-primary-foreground" : "hover:bg-accent text-muted-foreground"
                                )}
                                title="Hand Mode (Edit Fields)"
                            >
                                <Hand className="h-3.5 w-3.5" />
                            </button>
                            <div className="w-px h-3 bg-border mx-0.5" />
                            {isAdmin && (
                                <>
                                    <div className="relative group/tool">
                                        <button
                                            onClick={() => {
                                                setDrawingMode(prev => prev === 'pen' ? 'none' : 'pen')
                                                setBrushSize(2)
                                            }}
                                            className={cn(
                                                "h-7 w-7 inline-flex items-center justify-center rounded transition-colors",
                                                drawingMode === 'pen' ? "bg-primary text-primary-foreground" : "hover:bg-accent text-muted-foreground"
                                            )}
                                            title="Pen Tool"
                                        >
                                            <PenTool className="h-3.5 w-3.5" />
                                        </button>
                                        <div className="absolute top-full left-1/2 -translate-x-1/2 pt-1.5 opacity-0 pointer-events-none group-hover/tool:opacity-100 group-hover/tool:pointer-events-auto transition-all z-50">
                                            <div className="bg-card border rounded-lg shadow-xl p-1 flex flex-col gap-0.5 min-w-[40px] items-center">
                                                {[1, 2, 3, 5].map(size => (
                                                    <button
                                                        key={size}
                                                        onClick={() => {
                                                            setBrushSize(size)
                                                            setDrawingMode('pen')
                                                        }}
                                                        className={cn(
                                                            "w-8 h-6 flex items-center justify-center rounded hover:bg-accent text-[10px] font-bold transition-colors",
                                                            brushSize === size && drawingMode === 'pen' ? "text-primary" : "text-muted-foreground"
                                                        )}
                                                    >
                                                        {size}px
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="relative group/tool">
                                        <button
                                            onClick={() => {
                                                setDrawingMode(prev => prev === 'brush' ? 'none' : 'brush')
                                                setBrushSize(10)
                                            }}
                                            className={cn(
                                                "h-7 w-7 inline-flex items-center justify-center rounded transition-colors",
                                                drawingMode === 'brush' ? "bg-primary text-primary-foreground" : "hover:bg-accent text-muted-foreground"
                                            )}
                                            title="Brush Tool"
                                        >
                                            <Brush className="h-3.5 w-3.5" />
                                        </button>
                                        <div className="absolute top-full left-1/2 -translate-x-1/2 pt-1.5 opacity-0 pointer-events-none group-hover/tool:opacity-100 group-hover/tool:pointer-events-auto transition-all z-50">
                                            <div className="bg-card border rounded-lg shadow-xl p-1 flex flex-col gap-0.5 min-w-[40px] items-center">
                                                {[8, 12, 16, 24].map(size => (
                                                    <button
                                                        key={size}
                                                        onClick={() => {
                                                            setBrushSize(size)
                                                            setDrawingMode('brush')
                                                        }}
                                                        className={cn(
                                                            "w-8 h-6 flex items-center justify-center rounded hover:bg-accent text-[10px] font-bold transition-colors",
                                                            brushSize === size && drawingMode === 'brush' ? "text-primary" : "text-muted-foreground"
                                                        )}
                                                    >
                                                        {size}px
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="relative group">
                                        <button className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-accent text-muted-foreground transition-colors group-hover:bg-accent">
                                            <Palette className="h-3.5 w-3.5" style={{ color: brushColor }} />
                                        </button>
                                        <div className="absolute top-full left-0 pt-1.5 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-all z-50">
                                            <div className="p-2 bg-card border rounded-md shadow-lg flex gap-1 items-center">
                                                {['#ef4444', '#22c55e', '#3b82f6', '#f59e0b', '#000000'].map(c => (
                                                    <button
                                                        key={c}
                                                        onClick={() => setBrushColor(c)}
                                                        className="w-5 h-5 rounded-full border border-border hover:scale-110 transition-transform"
                                                        style={{ backgroundColor: c }}
                                                    />
                                                ))}
                                                <div className="w-px h-4 bg-border mx-1" />
                                                <input
                                                    type="color"
                                                    value={brushColor}
                                                    onChange={(e) => setBrushColor(e.target.value)}
                                                    className="w-5 h-5 border-none p-0 cursor-pointer bg-transparent"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                    <div className="relative group/tool">
                                        <button
                                            onClick={() => {
                                                setDrawingMode(prev => prev === 'eraser' ? 'none' : 'eraser')
                                            }}
                                            className={cn(
                                                "h-7 w-7 inline-flex items-center justify-center rounded transition-colors",
                                                drawingMode === 'eraser' ? "bg-primary text-primary-foreground" : "hover:bg-accent text-muted-foreground"
                                            )}
                                            title="Eraser Tool"
                                        >
                                            <Eraser className="h-3.5 w-3.5" />
                                        </button>
                                    </div>
                                    <button
                                        onClick={() => setIsClearConfirmOpen(true)}
                                        className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-accent text-muted-foreground hover:text-destructive"
                                        title="Clear All Annotations"
                                    >
                                        <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                </>
                            )}
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        {templatePreview.fields.length > 0 && canEditTemplateFields && (
                            <button
                                className="inline-flex items-center justify-center rounded-md h-8 px-3 text-xs font-medium transition-colors gap-1.5 bg-secondary text-secondary-foreground hover:bg-secondary/80"
                                onClick={() => setEditPanelOpen(o => !o)}
                            >
                                <Edit3 className="h-3.5 w-3.5" />
                                {editPanelOpen ? (t('common.close') || 'Close') : (t('common.fields') || 'Editable Fields')}
                            </button>
                        )}
                        {hasTemplatePrimaryAction && (
                            <button
                                className="inline-flex items-center justify-center rounded-md h-8 px-3 text-xs font-medium transition-colors gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                                onClick={handleTemplatePreviewSave}
                                disabled={isSaving}
                            >
                                {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : source.onSaveTemplateLayout ? <Check className="h-3.5 w-3.5" /> : <Printer className="h-3.5 w-3.5" />}
                                {source.onSaveTemplateLayout
                                    ? t('customTemplates.saveLayout', { defaultValue: 'Save Layout' })
                                    : source.templatePrimaryActionLabel || (source.onSave ? (t('print.printAndSave') || 'Print & Save') : (t('common.print') || 'Print'))}
                            </button>
                        )}
                    </div>
                </header>
                <div className="flex flex-1 overflow-hidden">
                    <div className="flex-1 overflow-hidden light" style={{ colorScheme: 'light' }}>
                        <div className="h-full w-full overflow-auto p-6 bg-slate-100/50 flex flex-col items-center">
                            <div
                                className={cn(
                                    "mx-auto transition-all duration-200 ease-in-out origin-top relative group",
                                    isFitToWidth ? "w-full" : "w-fit"
                                )}
                                style={{
                                    transform: isFitToWidth ? 'none' : `scale(${zoom / 100})`,
                                }}
                            >
                                {/* Drawing Overlay for templatePreview */}
                                <svg
                                    className={cn(
                                        "absolute inset-0 z-[40] touch-none",
                                        drawingMode !== 'none' ? "cursor-crosshair" : "pointer-events-none"
                                    )}
                                    viewBox={`0 0 ${templatePageWidth} ${templatePageHeight}`}
                                    onPointerDown={handlePointerDown}
                                    onPointerMove={handlePointerMove}
                                    onPointerUp={() => {
                                        if (!isDrawing || !currentPath) return
                                        setIsDrawing(false)
                                        setTemplateAnnotations(prev => [...prev, {
                                            type: drawingMode as 'pen' | 'brush',
                                            points: currentPath,
                                            color: brushColor,
                                            brushSize: brushSize
                                        }])
                                        setCurrentPath(null)
                                    }}
                                    onPointerLeave={() => {
                                        if (!isDrawing || !currentPath) return
                                        setIsDrawing(false)
                                        setTemplateAnnotations(prev => [...prev, {
                                            type: drawingMode as 'pen' | 'brush',
                                            points: currentPath,
                                            color: brushColor,
                                            brushSize: brushSize
                                        }])
                                        setCurrentPath(null)
                                    }}
                                >
                                    {/* Saved annotations */}
                                    {templateAnnotations.map((ann, idx) => (
                                        <path
                                            key={idx}
                                            d={`M ${ann.points.map(p => `${p.x},${p.y}`).join(' L ')}`}
                                            stroke={ann.color}
                                            strokeWidth={ann.brushSize}
                                            fill="none"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            opacity={ann.type === 'brush' ? 0.5 : 1}
                                            onPointerDown={(e) => {
                                                if (drawingMode === 'eraser') {
                                                    e.stopPropagation();
                                                    setTemplateAnnotations(prev => prev.filter((_, i) => i !== idx));
                                                }
                                            }}
                                            className={cn(drawingMode === 'eraser' && "cursor-pointer hover:stroke-destructive transition-colors")}
                                            style={{ pointerEvents: drawingMode === 'eraser' ? 'all' : 'auto' }}
                                        />
                                    ))}
                                    {/* Current active path preview */}
                                    {currentPath && (
                                        <path
                                            d={`M ${currentPath.map(p => `${p.x},${p.y}`).join(' L ')}`}
                                            stroke={brushColor}
                                            strokeWidth={brushSize}
                                            fill="none"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            opacity={drawingMode === 'brush' ? 0.5 : 1}
                                            style={{ pointerEvents: 'none' }}
                                        />
                                    )}
                                </svg>

                                {/* Attached images overlay */}
                                {templateImages.map((img, idx) => (
                                    <div
                                        key={`timg-${idx}`}
                                        className="absolute z-[35] cursor-move group/img"
                                        style={{
                                            left: `${(img.x / templatePageWidth) * 100}%`,
                                            top: `${(img.y / templatePageHeight) * 100}%`,
                                            width: `${(img.width / templatePageWidth) * 100}%`,
                                            transform: `rotate(${img.rotation || 0}deg)`,
                                            transformOrigin: 'top left',
                                            zIndex: 50 + idx,
                                        }}
                                        onPointerDown={(e) => {
                                            if (drawingMode !== 'none') return
                                            e.preventDefault()
                                            e.stopPropagation()
                                            const startX = e.clientX
                                            const startY = e.clientY
                                            const origX = img.x
                                            const origY = img.y
                                            const container = (e.currentTarget.parentElement as HTMLElement)
                                            const cRect = container.getBoundingClientRect()
                                            const scaleX = templatePageWidth / cRect.width
                                            const scaleY = templatePageHeight / cRect.height
                                            const onMove = (ev: PointerEvent) => {
                                                const dx = (ev.clientX - startX) * scaleX
                                                const dy = (ev.clientY - startY) * scaleY
                                                setTemplateImages(prev => prev.map((im, i) => i === idx ? { ...im, x: origX + dx, y: origY + dy } : im))
                                            }
                                            const onUp = () => {
                                                window.removeEventListener('pointermove', onMove)
                                                window.removeEventListener('pointerup', onUp)
                                            }
                                            window.addEventListener('pointermove', onMove)
                                            window.addEventListener('pointerup', onUp)
                                        }}
                                    >
                                        <img
                                            src={platformService.convertFileSrc(img.path)}
                                            alt=""
                                            className="w-full h-auto block select-none pointer-events-none ring-1 ring-transparent group-hover/img:ring-primary transition-shadow"
                                            draggable={false}
                                        />
                                        {/* Rotation Handle */}
                                        <div
                                            className="absolute -top-8 left-1/2 -translate-x-1/2 w-6 h-6 bg-white border border-slate-200 rounded-full shadow-sm flex items-center justify-center cursor-alias opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity hover:bg-slate-50 active:bg-slate-100"
                                            onPointerDown={(e) => {
                                                e.stopPropagation()
                                                e.preventDefault()
                                                const rect = e.currentTarget.parentElement?.getBoundingClientRect()
                                                if (!rect) return
                                                const centerX = rect.left + rect.width / 2
                                                const centerY = rect.top + rect.height / 2
                                                const startAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX)
                                                const initialRotation = img.rotation || 0
                                                const onPointerMove = (mE: PointerEvent) => {
                                                    const currentAngle = Math.atan2(mE.clientY - centerY, mE.clientX - centerX)
                                                    const delta = (currentAngle - startAngle) * (180 / Math.PI)
                                                    setTemplateImages(prev => prev.map((im, i) => i === idx ? { ...im, rotation: initialRotation + delta } : im))
                                                }
                                                const onPointerUp = () => {
                                                    window.removeEventListener('pointermove', onPointerMove)
                                                    window.removeEventListener('pointerup', onPointerUp)
                                                }
                                                window.addEventListener('pointermove', onPointerMove)
                                                window.addEventListener('pointerup', onPointerUp)
                                            }}
                                        >
                                            <RotateCw className="w-3 h-3 text-primary" />
                                        </div>
                                        {/* Resize Handle */}
                                        <div
                                            className="absolute -bottom-2 -right-2 w-5 h-5 bg-white border border-slate-200 rounded shadow-sm flex items-center justify-center cursor-nwse-resize opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity hover:bg-slate-50 active:bg-slate-100"
                                            onPointerDown={(e) => {
                                                e.stopPropagation()
                                                e.preventDefault()
                                                const startX = e.clientX
                                                const initialWidth = img.width
                                                const container = (e.currentTarget.parentElement?.parentElement as HTMLElement)
                                                const cRect = container.getBoundingClientRect()
                                                const scaleX = templatePageWidth / cRect.width
                                                const onPointerMove = (mE: PointerEvent) => {
                                                    const dx = (mE.clientX - startX) * scaleX
                                                    const newWidth = Math.max(10, initialWidth + dx)
                                                    setTemplateImages(prev => prev.map((im, i) => i === idx ? { ...im, width: newWidth } : im))
                                                }
                                                const onPointerUp = () => {
                                                    window.removeEventListener('pointermove', onPointerMove)
                                                    window.removeEventListener('pointerup', onPointerUp)
                                                }
                                                window.addEventListener('pointermove', onPointerMove)
                                                window.addEventListener('pointerup', onPointerUp)
                                            }}
                                        >
                                            <Scaling className="w-3 h-3 text-primary" />
                                        </div>
                                        {/* Delete Handle */}
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation()
                                                setTemplateImages(prev => prev.filter((_, i) => i !== idx))
                                            }}
                                            className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity shadow-md hover:bg-red-600 active:scale-95 z-10"
                                        >
                                            <X className="w-3 h-3" />
                                        </button>
                                    </div>
                                ))}

                                {/* Attached texts overlay */}
                                {templateTexts.map((txt, idx) => (
                                    <div
                                        key={`ttxt-${txt.id}`}
                                        className="absolute z-[35] group/txt"
                                        style={{
                                            left: `${(txt.x / templatePageWidth) * 100}%`,
                                            top: `${(txt.y / templatePageHeight) * 100}%`,
                                            width: `${(txt.width / templatePageWidth) * 100}%`,
                                            transform: `rotate(${txt.rotation}deg)`,
                                            transformOrigin: 'top left',
                                            zIndex: 100 + idx,
                                        }}
                                    >
                                        <textarea
                                            value={txt.text}
                                            onChange={(e) => setTemplateTexts(prev => prev.map((t, i) => i === idx ? { ...t, text: e.target.value } : t))}
                                            onBlur={() => {
                                                if (!txt.text.trim()) {
                                                    setTemplateTexts(prev => prev.filter((_, i) => i !== idx))
                                                }
                                            }}
                                            className="w-full bg-transparent border-none outline-none resize-none p-1 block ring-1 ring-transparent group-hover/txt:ring-primary transition-shadow text-inherit font-bold overflow-hidden"
                                            style={{
                                                height: 'auto',
                                                fontSize: `${txt.fontSize || 16}px`,
                                                color: txt.color,
                                                lineHeight: 1.3,
                                            }}
                                            rows={1}
                                            spellCheck={false}
                                        />
                                        {/* Font Size Handle */}
                                        <div
                                            className="absolute -top-16 left-1/2 -translate-x-1/2 h-7 bg-white border border-slate-200 rounded-md shadow-sm flex items-center justify-center opacity-0 group-hover/txt:opacity-100 group-focus-within:opacity-100 transition-opacity z-10 px-1"
                                            onPointerDown={(e) => e.stopPropagation()}
                                        >
                                            <input
                                                type="number"
                                                min="8"
                                                max="72"
                                                value={txt.fontSize === '' ? '' : (txt.fontSize ?? 16)}
                                                onChange={(e) => {
                                                    const newTexts = [...templateTexts]
                                                    const val = e.target.value
                                                    newTexts[idx] = { ...txt, fontSize: val === '' ? '' : parseInt(val) }
                                                    setTemplateTexts(newTexts)
                                                }}
                                                className="w-12 h-5 text-center text-xs outline-none font-medium text-slate-700 bg-transparent"
                                            />
                                            <span className="text-[10px] text-slate-400 font-medium pr-1 select-none pointer-events-none">px</span>
                                        </div>
                                        {/* Move Handle */}
                                        <div
                                            className="absolute -bottom-7 left-1/2 -translate-x-1/2 w-6 h-6 bg-white border border-slate-200 rounded-full shadow-sm flex items-center justify-center cursor-move opacity-0 group-hover/txt:opacity-100 group-focus-within:opacity-100 transition-opacity hover:bg-slate-50 active:bg-slate-100"
                                            onPointerDown={(e) => {
                                                if (drawingMode !== 'none') return
                                                e.preventDefault()
                                                e.stopPropagation()
                                                const startX = e.clientX
                                                const startY = e.clientY
                                                const origX = txt.x
                                                const origY = txt.y
                                                const container = (e.currentTarget.parentElement?.parentElement as HTMLElement)
                                                const cRect = container.getBoundingClientRect()
                                                const scaleX = templatePageWidth / cRect.width
                                                const scaleY = templatePageHeight / cRect.height
                                                const onMoveEv = (ev: PointerEvent) => {
                                                    const dx = (ev.clientX - startX) * scaleX
                                                    const dy = (ev.clientY - startY) * scaleY
                                                    setTemplateTexts(prev => prev.map((t, i) => i === idx ? { ...t, x: origX + dx, y: origY + dy } : t))
                                                }
                                                const onUp = () => {
                                                    window.removeEventListener('pointermove', onMoveEv)
                                                    window.removeEventListener('pointerup', onUp)
                                                }
                                                window.addEventListener('pointermove', onMoveEv)
                                                window.addEventListener('pointerup', onUp)
                                            }}
                                        >
                                            <Move className="w-3 h-3 text-primary" />
                                        </div>
                                        {/* Rotation Handle */}
                                        <div
                                            className="absolute -top-8 left-1/2 -translate-x-1/2 w-6 h-6 bg-white border border-slate-200 rounded-full shadow-sm flex items-center justify-center cursor-alias opacity-0 group-hover/txt:opacity-100 transition-opacity hover:bg-slate-50 active:bg-slate-100"
                                            onPointerDown={(e) => {
                                                e.stopPropagation()
                                                e.preventDefault()
                                                const rect = e.currentTarget.parentElement?.getBoundingClientRect()
                                                if (!rect) return
                                                const centerX = rect.left + rect.width / 2
                                                const centerY = rect.top + rect.height / 2
                                                const startAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX)
                                                const initialRotation = txt.rotation || 0
                                                const onPointerMove = (mE: PointerEvent) => {
                                                    const currentAngle = Math.atan2(mE.clientY - centerY, mE.clientX - centerX)
                                                    const delta = (currentAngle - startAngle) * (180 / Math.PI)
                                                    setTemplateTexts(prev => prev.map((t, i) => i === idx ? { ...t, rotation: initialRotation + delta } : t))
                                                }
                                                const onPointerUp = () => {
                                                    window.removeEventListener('pointermove', onPointerMove)
                                                    window.removeEventListener('pointerup', onPointerUp)
                                                }
                                                window.addEventListener('pointermove', onPointerMove)
                                                window.addEventListener('pointerup', onPointerUp)
                                            }}
                                        >
                                            <RotateCw className="w-3 h-3 text-primary" />
                                        </div>
                                        {/* Resize Handle */}
                                        <div
                                            className="absolute -bottom-2 -right-2 w-5 h-5 bg-white border border-slate-200 rounded shadow-sm flex items-center justify-center cursor-nwse-resize opacity-0 group-hover/txt:opacity-100 transition-opacity hover:bg-slate-50 active:bg-slate-100"
                                            onPointerDown={(e) => {
                                                e.stopPropagation()
                                                e.preventDefault()
                                                const startX = e.clientX
                                                const initialWidth = txt.width
                                                const container = (e.currentTarget.parentElement?.parentElement as HTMLElement)
                                                const cRect = container.getBoundingClientRect()
                                                const scaleX = templatePageWidth / cRect.width
                                                const onPointerMove = (mE: PointerEvent) => {
                                                    const dx = (mE.clientX - startX) * scaleX
                                                    const newWidth = Math.max(20, initialWidth + dx)
                                                    setTemplateTexts(prev => prev.map((t, i) => i === idx ? { ...t, width: newWidth } : t))
                                                }
                                                const onPointerUp = () => {
                                                    window.removeEventListener('pointermove', onPointerMove)
                                                    window.removeEventListener('pointerup', onPointerUp)
                                                }
                                                window.addEventListener('pointermove', onPointerMove)
                                                window.addEventListener('pointerup', onPointerUp)
                                            }}
                                        >
                                            <Scaling className="w-3 h-3 text-primary" />
                                        </div>
                                        {/* Delete Handle */}
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation()
                                                setTemplateTexts(prev => prev.filter((_, i) => i !== idx))
                                            }}
                                            className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover/txt:opacity-100 transition-opacity shadow-md hover:bg-red-600 active:scale-95"
                                        >
                                            <X className="w-3 h-3" />
                                        </button>
                                    </div>
                                ))}

                                {templatePreview.createElement(
                                    fieldValues,
                                    source.effectiveId,
                                    fixedTemplatePrintLang || (tempPrintLang !== 'auto' ? tempPrintLang : undefined),
                                    {
                                        editableFields: canEditTemplateFields && drawingMode === 'none',
                                        dataKeys: templatePreview.dataKeys,
                                        onFieldChange: handleFieldChange
                                    }
                                )}
                            </div>
                        </div>
                    </div>
                    {editPanelOpen && canEditTemplateFields && (
                        <div className="w-72 shrink-0 border-l bg-card overflow-y-auto p-4 space-y-4">
                            <div className="flex items-center justify-between">
                                <h3 className="text-sm font-semibold">{t('common.fields') || 'Editable Fields'}</h3>
                                <button
                                    className="inline-flex items-center justify-center rounded-md h-6 w-6 hover:bg-accent transition-colors"
                                    onClick={() => setEditPanelOpen(false)}
                                >
                                    <X className="h-3.5 w-3.5" />
                                </button>
                            </div>
                            {templatePreview.fields.map(f => (
                                <div key={f.key} className="space-y-1">
                                    <label className="text-[11px] font-medium text-muted-foreground">{f.label}</label>
                                    <EditableField
                                        value={fieldValues[f.key] ?? ''}
                                        onChange={(v) => handleFieldChange(f.key, v)}
                                        type={f.type}
                                        className="text-sm"
                                        inputClassName="w-full"
                                        placeholder={f.placeholder}
                                    />
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <DeleteConfirmationModal
                    isOpen={isClearConfirmOpen}
                    onClose={() => setIsClearConfirmOpen(false)}
                    onConfirm={() => {
                        setTemplateAnnotations([])
                        setTemplateTexts([])
                        setTemplateImages([])
                        setIsClearConfirmOpen(false)
                    }}
                    title="Clear All Annotations"
                    description="This will permanently delete all hand-drawn notes, text fields, and images from this document. Are you sure you want to clear everything?"
                    itemName="Annotations Layer"
                />

                <Dialog
                    open={isTemplateLabelDialogOpen}
                    onOpenChange={(open) => {
                        if (isSaving) return
                        setIsTemplateLabelDialogOpen(open)
                        if (!open) {
                            setPendingTemplateLayout(null)
                        }
                    }}
                >
                    <DialogContent className="sm:max-w-md">
                        <form onSubmit={handleConfirmTemplateLayoutSave}>
                            <DialogHeader>
                                <DialogTitle>{t('customTemplates.labelDialogTitle', { defaultValue: 'Name Custom Template' })}</DialogTitle>
                                <DialogDescription>
                                    {t('customTemplates.labelDialogDescription', {
                                        defaultValue: 'Enter a label to identify this custom print layout later.'
                                    })}
                                </DialogDescription>
                            </DialogHeader>

                            <div className="grid gap-2 py-4">
                                <Label htmlFor="custom-template-label">
                                    {t('customTemplates.labelField', { defaultValue: 'Template Label' })}
                                </Label>
                                <Input
                                    id="custom-template-label"
                                    value={templateSaveLabel}
                                    onChange={(event) => setTemplateSaveLabel(event.target.value)}
                                    placeholder={t('customTemplates.labelPlaceholder', { defaultValue: 'Enter template label' })}
                                    disabled={isSaving}
                                    autoFocus
                                />
                            </div>

                            <DialogFooter>
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => {
                                        setIsTemplateLabelDialogOpen(false)
                                        setPendingTemplateLayout(null)
                                    }}
                                    disabled={isSaving}
                                >
                                    {t('common.cancel', { defaultValue: 'Cancel' })}
                                </Button>
                                <Button type="submit" disabled={!templateSaveLabel.trim() || isSaving}>
                                    {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                    {t('customTemplates.saveLayout', { defaultValue: 'Save Layout' })}
                                </Button>
                            </DialogFooter>
                        </form>
                    </DialogContent>
                </Dialog>
            </div>
        )
    }

    if (showNativePdf) {
        return (
            <div className="flex h-screen w-screen flex-col bg-background overflow-hidden"
                style={{ marginTop: 'var(--titlebar-height)', height: 'calc(100vh - var(--titlebar-height))' }}>
                <header className="flex items-center justify-between border-b px-4 py-2 shrink-0 bg-card z-10">
                    <div className="flex items-center gap-3 min-w-0">
                        <button
                            className="inline-flex items-center justify-center rounded-md h-8 w-8 hover:bg-accent transition-colors shrink-0"
                            onClick={handleBack}
                        >
                            <ArrowLeft className="h-4 w-4" />
                        </button>
                        <h1 className="text-sm font-semibold truncate">{title}</h1>
                    </div>
                    {source.onSave && (
                        <button
                            className="inline-flex items-center justify-center rounded-md h-8 px-3 text-xs font-medium transition-colors gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                            onClick={handleNativeSave}
                            disabled={isSaving}
                        >
                            {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Printer className="h-3.5 w-3.5" />}
                            {t('print.printAndSave') || 'Print & Save'}
                        </button>
                    )}
                </header>
                <div className="flex-1">
                    <object data={source.url} type="application/pdf" className="w-full h-full">
                        <iframe src={source.url} className="w-full h-full" title={title} />
                    </object>
                </div>
            </div>
        )
    }

    return (
        <div className="flex h-screen w-screen flex-col bg-gray-50 overflow-hidden"
            style={{ marginTop: 'var(--titlebar-height)', height: 'calc(100vh - var(--titlebar-height))' }}>
            <header className="flex items-center justify-between border-b px-4 py-2 shrink-0 bg-card z-10">
                <div className="flex items-center gap-3 min-w-0">
                    <button
                        className="inline-flex items-center justify-center rounded-md h-8 w-8 hover:bg-accent transition-colors shrink-0"
                        onClick={handleBack}
                    >
                        <ArrowLeft className="h-4 w-4" />
                    </button>
                    <h1 className="text-sm font-semibold truncate">{title}</h1>
                </div>

                <div className="flex items-center gap-1 bg-secondary/50 rounded-md p-0.5 border border-border">
                    {isAdmin && (
                        <>
                            <UiAccessGate>
                                <LanguageSelector
                                    value={tempPrintLang}
                                    onChange={(val) => setTempPrintLang(val)}
                                />
                                <div className="w-px h-4 bg-border mx-0.5" />
                            </UiAccessGate>
                            <button
                                onClick={handleAddImage}
                                className="h-7 px-2 inline-flex items-center gap-1.5 rounded hover:bg-accent text-primary text-[11px] font-bold"
                                title="Add Picture"
                            >
                                <ImagePlus className="h-3.5 w-3.5" />
                                <span>Add Photo</span>
                            </button>
                            <div className="w-px h-4 bg-border mx-0.5" />
                            <button
                                onClick={handleAddText}
                                className="h-7 px-2 inline-flex items-center gap-1.5 rounded hover:bg-accent text-primary text-[11px] font-bold"
                                title="Add Text Field"
                            >
                                <Type className="h-3.5 w-3.5" />
                                <span>Add Text</span>
                            </button>
                            <div className="w-px h-4 bg-border mx-0.5" />
                        </>
                    )}
                    <button
                        onClick={handleZoomOut}
                        className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-accent text-muted-foreground"
                        title={t('preview.zoomOut') || 'Zoom Out'}
                    >
                        <ZoomOut className="h-3.5 w-3.5" />
                    </button>
                    <button
                        onClick={handleZoomReset}
                        className="h-7 px-2 inline-flex items-center justify-center rounded hover:bg-accent text-[11px] font-medium min-w-[45px]"
                        title={t('preview.zoomReset') || 'Reset Zoom'}
                    >
                        {zoom}%
                    </button>
                    <button
                        onClick={handleZoomIn}
                        className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-accent text-muted-foreground"
                        title={t('preview.zoomIn') || 'Zoom In'}
                    >
                        <ZoomIn className="h-3.5 w-3.5" />
                    </button>
                    <div className="w-px h-4 bg-border mx-0.5" />
                    <button
                        onClick={handleFitToWidth}
                        className={cn(
                            "h-7 w-7 inline-flex items-center justify-center rounded transition-colors",
                            isFitToWidth ? "bg-primary text-primary-foreground" : "hover:bg-accent text-muted-foreground"
                        )}
                        title={t('preview.fitToWidth') || 'Fit to Width'}
                    >
                        <Maximize className="h-3.5 w-3.5" />
                    </button>
                    <div className="w-px h-4 bg-border mx-0.5" />
                    <div className="flex items-center gap-0.5">
                        <button
                            onClick={() => setDrawingMode('none')}
                            className={cn(
                                "h-7 w-7 inline-flex items-center justify-center rounded transition-colors",
                                drawingMode === 'none' ? "bg-primary text-primary-foreground" : "hover:bg-accent text-muted-foreground"
                            )}
                            title="Hand Mode (Edit Fields)"
                        >
                            <Hand className="h-3.5 w-3.5" />
                        </button>
                        <div className="w-px h-3 bg-border mx-0.5" />
                        {isAdmin && (
                            <>

                                <div className="relative group/tool">
                                    <button
                                        onClick={() => {
                                            setDrawingMode(prev => prev === 'pen' ? 'none' : 'pen')
                                            setBrushSize(2)
                                        }}
                                        className={cn(
                                            "h-7 w-7 inline-flex items-center justify-center rounded transition-colors",
                                            drawingMode === 'pen' ? "bg-primary text-primary-foreground" : "hover:bg-accent text-muted-foreground"
                                        )}
                                        title="Pen Tool"
                                    >
                                        <PenTool className="h-3.5 w-3.5" />
                                    </button>
                                    <div className="absolute top-full left-1/2 -translate-x-1/2 pt-1.5 opacity-0 pointer-events-none group-hover/tool:opacity-100 group-hover/tool:pointer-events-auto transition-all z-50">
                                        <div className="bg-card border rounded-lg shadow-xl p-1 flex flex-col gap-0.5 min-w-[40px] items-center">
                                            {[1, 2, 3, 5].map(size => (
                                                <button
                                                    key={size}
                                                    onClick={() => {
                                                        setBrushSize(size)
                                                        setDrawingMode('pen')
                                                    }}
                                                    className={cn(
                                                        "w-8 h-6 flex items-center justify-center rounded hover:bg-accent text-[10px] font-bold transition-colors",
                                                        brushSize === size && drawingMode === 'pen' ? "text-primary" : "text-muted-foreground"
                                                    )}
                                                >
                                                    {size}px
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                <div className="relative group/tool">
                                    <button
                                        onClick={() => {
                                            setDrawingMode(prev => prev === 'brush' ? 'none' : 'brush')
                                            setBrushSize(10)
                                        }}
                                        className={cn(
                                            "h-7 w-7 inline-flex items-center justify-center rounded transition-colors",
                                            drawingMode === 'brush' ? "bg-primary text-primary-foreground" : "hover:bg-accent text-muted-foreground"
                                        )}
                                        title="Brush Tool"
                                    >
                                        <Brush className="h-3.5 w-3.5" />
                                    </button>
                                    <div className="absolute top-full left-1/2 -translate-x-1/2 pt-1.5 opacity-0 pointer-events-none group-hover/tool:opacity-100 group-hover/tool:pointer-events-auto transition-all z-50">
                                        <div className="bg-card border rounded-lg shadow-xl p-1 flex flex-col gap-0.5 min-w-[40px] items-center">
                                            {[8, 12, 16, 24].map(size => (
                                                <button
                                                    key={size}
                                                    onClick={() => {
                                                        setBrushSize(size)
                                                        setDrawingMode('brush')
                                                    }}
                                                    className={cn(
                                                        "w-8 h-6 flex items-center justify-center rounded hover:bg-accent text-[10px] font-bold transition-colors",
                                                        brushSize === size && drawingMode === 'brush' ? "text-primary" : "text-muted-foreground"
                                                    )}
                                                >
                                                    {size}px
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                <div className="relative group">
                                    <button className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-accent text-muted-foreground transition-colors group-hover:bg-accent">
                                        <Palette className="h-3.5 w-3.5" style={{ color: brushColor }} />
                                    </button>
                                    <div className="absolute top-full left-0 pt-1.5 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-all z-50">
                                        <div className="p-2 bg-card border rounded-md shadow-lg flex gap-1 items-center">
                                            {['#ef4444', '#22c55e', '#3b82f6', '#f59e0b', '#000000'].map(c => (
                                                <button
                                                    key={c}
                                                    onClick={() => setBrushColor(c)}
                                                    className="w-5 h-5 rounded-full border border-border hover:scale-110 transition-transform"
                                                    style={{ backgroundColor: c }}
                                                />
                                            ))}
                                            <div className="w-px h-4 bg-border mx-1" />
                                            <input
                                                type="color"
                                                value={brushColor}
                                                onChange={(e) => setBrushColor(e.target.value)}
                                                className="w-5 h-5 border-none p-0 cursor-pointer bg-transparent"
                                            />
                                        </div>
                                    </div>
                                </div>
                                <div className="relative group/tool">
                                    <button
                                        onClick={() => {
                                            setDrawingMode(prev => prev === 'eraser' ? 'none' : 'eraser')
                                        }}
                                        className={cn(
                                            "h-7 w-7 inline-flex items-center justify-center rounded transition-colors",
                                            drawingMode === 'eraser' ? "bg-primary text-primary-foreground" : "hover:bg-accent text-muted-foreground"
                                        )}
                                        title="Eraser Tool"
                                    >
                                        <Eraser className="h-3.5 w-3.5" />
                                    </button>
                                </div>
                                <button
                                    onClick={() => setIsClearConfirmOpen(true)}
                                    className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-accent text-muted-foreground hover:text-destructive"
                                    title="Clear All Annotations"
                                >
                                    <Trash2 className="h-3.5 w-3.5" />
                                </button>
                            </>
                        )}
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    {editableData && isAdmin && (
                        <button
                            className="inline-flex items-center justify-center rounded-md h-8 px-3 text-xs font-medium transition-colors gap-1.5 bg-secondary text-secondary-foreground hover:bg-secondary/80"
                            onClick={() => setEditPanelOpen(o => !o)}
                        >
                            <Edit3 className="h-3.5 w-3.5" />
                            {editPanelOpen ? (t('common.close') || 'Close') : (t('common.edit') || 'Edit')}
                        </button>
                    )}
                    <button
                        className="inline-flex items-center justify-center rounded-md h-8 px-3 text-xs font-medium transition-colors gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                        onClick={handleSave}
                        disabled={isSaving}
                    >
                        {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Printer className="h-3.5 w-3.5" />}
                        {t('print.printAndSave') || 'Print & Save'}
                    </button>
                </div>
            </header>
            <div className="flex flex-1 overflow-hidden light" style={{ colorScheme: 'light' }}>
                <div className="flex-1 overflow-auto p-6 bg-slate-100/50 flex flex-col items-center">
                    <div
                        className={cn(
                            "mx-auto transition-all duration-200 ease-in-out origin-top relative group",
                            isFitToWidth ? "w-full" : "w-fit"
                        )}
                        style={{
                            transform: isFitToWidth ? 'none' : `scale(${zoom / 100})`,
                        }}
                    >
                        {/* Drawing Overlay */}
                        {source.printFormat === 'a4' && (
                            <svg
                                className={cn(
                                    "absolute inset-0 z-[40] touch-none",
                                    drawingMode === 'eraser' ? "pointer-events-none cursor-crosshair" :
                                        drawingMode !== 'none' ? "cursor-crosshair" : "pointer-events-none"
                                )}
                                viewBox="0 0 210 297"
                                onPointerDown={handlePointerDown}
                                onPointerMove={handlePointerMove}
                                onPointerUp={handlePointerUp}
                                onPointerLeave={handlePointerUp}
                            >
                                {/* Current active path preview */}
                                {currentPath && (
                                    <path
                                        d={`M ${currentPath.map(p => `${p.x},${p.y}`).join(' L ')}`}
                                        stroke={brushColor}
                                        strokeWidth={brushSize}
                                        fill="none"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    />
                                )}
                            </svg>
                        )}

                        {editableData && source.features && source.printFormat && (
                            <EditableInvoicePreview
                                data={editableData}
                                features={{
                                    ...source.features,
                                    print_lang: tempPrintLang !== 'auto' ? tempPrintLang : source.features.print_lang
                                }}
                                workspaceId={source.workspaceId}
                                workspaceName={source.workspaceName}
                                workspaceFooterContacts={source.workspaceFooterContacts}
                                printFormat={source.printFormat}
                                onDataChange={isAdmin ? setEditableData : undefined}
                                drawingMode={drawingMode}
                            />
                        )}
                    </div>
                </div>
                {editPanelOpen && editableData && (
                    <div className="w-72 shrink-0 border-l bg-card overflow-y-auto p-4 space-y-4">
                        <div className="flex items-center justify-between z-10 sticky top-0 bg-card pb-2">
                            <h3 className="text-sm font-semibold">{t('common.fields') || 'Editable Fields'}</h3>
                            <button
                                className="inline-flex items-center justify-center rounded-md h-6 w-6 hover:bg-accent transition-colors"
                                onClick={() => setEditPanelOpen(false)}
                            >
                                <X className="h-3.5 w-3.5" />
                            </button>
                        </div>

                        <div className="space-y-3">

                            <div className="space-y-1">
                                <label className="text-[11px] font-medium text-muted-foreground">{t('invoice.soldTo')}</label>
                                <EditableField
                                    value={editableData.customer_name || ''}
                                    onChange={(v) => setEditableData(prev => prev ? { ...prev, customer_name: v } : null)}
                                    type="text"
                                    className="text-sm w-full block border border-transparent hover:border-blue-400"
                                    inputClassName="w-full"
                                />
                            </div>
                            <div className="space-y-1">
                                <label className="text-[11px] font-medium text-muted-foreground">{t('invoice.terms')}</label>
                                <EditableField
                                    value={editableData.terms || ''}
                                    onChange={(v) => setEditableData(prev => prev ? { ...prev, terms: v } : null)}
                                    type="textarea"
                                    className="text-sm w-full block border border-transparent hover:border-blue-400 min-h-[60px]"
                                    inputClassName="w-full min-h-[60px]"
                                />
                            </div>

                            <div className="pt-2">
                                <div className="flex items-center justify-between mb-2">
                                    <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-tight">
                                        Current Pictures
                                    </label>
                                    <span className="text-[10px] bg-secondary px-1.5 py-0.5 rounded-full font-mono font-bold">
                                        {editableData.attached_images?.length || 0}
                                    </span>
                                </div>
                                <div className="space-y-2">
                                    {(editableData.attached_images || []).map((img, idx) => (
                                        <div key={idx} className="flex items-center gap-2 p-2 rounded-md bg-secondary/20 border border-border/50 group">
                                            <div className="h-8 w-8 rounded border border-border overflow-hidden bg-white shrink-0">
                                                <img
                                                    src={platformService.convertFileSrc(img.path)}
                                                    alt=""
                                                    className="h-full w-full object-cover"
                                                />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-[9px] text-muted-foreground font-mono">
                                                    {Math.round(img.x)},{Math.round(img.y)} | {Math.round(img.rotation || 0)}°
                                                </p>
                                            </div>
                                            <button
                                                onClick={() => handleRemoveImage(img.path)}
                                                className="p-1 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                                            >
                                                <Trash2 className="h-3 w-3" />
                                            </button>
                                        </div>
                                    ))}
                                    {(editableData.attached_images?.length === 0 || !editableData.attached_images) && (
                                        <div className="py-4 border border-dashed rounded-md flex flex-col items-center justify-center text-muted-foreground text-[10px] gap-1">
                                            <ImagePlus className="h-4 w-4 opacity-20" />
                                            <span>No pictures added</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            <DeleteConfirmationModal
                isOpen={isClearConfirmOpen}
                onClose={() => setIsClearConfirmOpen(false)}
                onConfirm={() => {
                    setEditableData(prev => prev ? { ...prev, annotations: [] } : null)
                    setIsClearConfirmOpen(false)
                }}
                title="Clear All Annotations"
                description="This will permanently delete all hand-drawn notes and markings from this document. Are you sure you want to clear everything?"
                itemName="Annotations Layer"
            />
        </div>
    )
}
