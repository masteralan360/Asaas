import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { createPluginRegistration } from '@embedpdf/core'
import { EmbedPDF } from '@embedpdf/core/react'
import { usePdfiumEngine } from '@embedpdf/engines/react'
import { Viewport, ViewportPluginPackage } from '@embedpdf/plugin-viewport/react'
import { Scroller, ScrollPluginPackage } from '@embedpdf/plugin-scroll/react'
import { DocumentContent, DocumentManagerPluginPackage } from '@embedpdf/plugin-document-manager/react'
import { RenderLayer, RenderPluginPackage } from '@embedpdf/plugin-render/react'
import { ZoomPluginPackage, ZoomMode, useZoom } from '@embedpdf/plugin-zoom/react'
import { ArrowLeft, Maximize2, Printer, Loader2, Minus, Plus } from 'lucide-react'
import { getPdfPreviewSource } from '@/lib/pdfPreviewStore'

function ZoomToolbar({ documentId }: { documentId: string }) {
    const { provides: zoomProvides, state: zoomState } = useZoom(documentId)
    const { t } = useTranslation()

    if (!zoomProvides) return null

    return (
        <div className="flex items-center gap-1.5">
            <button
                className="inline-flex items-center justify-center rounded-md h-8 w-8 hover:bg-accent transition-colors"
                onClick={zoomProvides.zoomOut}
                title={t('pdfPreview.zoomOut') || 'Zoom Out'}
            >
                <Minus className="h-4 w-4" />
            </button>
            <span className="min-w-[3rem] text-center text-xs font-medium tabular-nums">
                {Math.round(zoomState.currentZoomLevel * 100)}%
            </span>
            <button
                className="inline-flex items-center justify-center rounded-md h-8 w-8 hover:bg-accent transition-colors"
                onClick={zoomProvides.zoomIn}
                title={t('pdfPreview.zoomIn') || 'Zoom In'}
            >
                <Plus className="h-4 w-4" />
            </button>
            <button
                className="inline-flex items-center justify-center rounded-md h-8 px-2 text-xs hover:bg-accent transition-colors gap-1"
                onClick={() => zoomProvides.requestZoom(ZoomMode.FitPage)}
            >
                <Maximize2 className="h-3.5 w-3.5" />
                {t('pdfPreview.fitPage') || 'Fit'}
            </button>
        </div>
    )
}

export function PdfPreviewPage() {
    const { t } = useTranslation()

    const source = useMemo(() => getPdfPreviewSource(), [])
    const pdfUrl = source?.url || ''
    const title = source?.title || t('pdfPreview.title') || 'PDF Preview'

    const { engine, isLoading: engineLoading, error: engineError } = usePdfiumEngine()

    const handleBack = useCallback(() => {
        window.history.back()
    }, [])

    const handleSave = useCallback(async () => {
        await source?.onSave?.()
        window.history.back()
    }, [source])

    const plugins = useMemo(() => [
        createPluginRegistration(DocumentManagerPluginPackage, {
            initialDocuments: pdfUrl ? [{ url: pdfUrl }] : [],
        }),
        createPluginRegistration(ViewportPluginPackage),
        createPluginRegistration(ScrollPluginPackage),
        createPluginRegistration(RenderPluginPackage),
        createPluginRegistration(ZoomPluginPackage, {
            defaultZoomLevel: ZoomMode.FitPage,
        }),
    ], [pdfUrl])

    if (!pdfUrl) return null

    if (engineError) {
        return (
            <div className="flex h-screen items-center justify-center bg-background"
                style={{ marginTop: 'var(--titlebar-height)', height: 'calc(100vh - var(--titlebar-height))' }}>
                <div className="text-center space-y-4">
                    <p className="text-destructive font-medium">{t('pdfPreview.engineError') || 'Failed to load PDF engine'}</p>
                    <button
                        className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm hover:bg-accent transition-colors"
                        onClick={handleBack}
                    >
                        <ArrowLeft className="h-4 w-4 mr-2" />
                        {t('common.back') || 'Back'}
                    </button>
                </div>
            </div>
        )
    }

    if (engineLoading || !engine) {
        return (
            <div className="flex h-screen items-center justify-center bg-background"
                style={{ marginTop: 'var(--titlebar-height)', height: 'calc(100vh - var(--titlebar-height))' }}>
                <div className="flex items-center gap-3 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    <span>{t('pdfPreview.loadingEngine') || 'Loading PDF engine...'}</span>
                </div>
            </div>
        )
    }

    return (
        <EmbedPDF engine={engine} plugins={plugins}>
            {({ activeDocumentId }) => (
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

                        {activeDocumentId && <ZoomToolbar documentId={activeDocumentId} />}

                        <div className="flex items-center gap-1.5">
                            <button
                                className="inline-flex items-center justify-center rounded-md h-8 px-3 text-xs font-medium hover:bg-accent transition-colors gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90"
                                onClick={handleSave}
                            >
                                <Printer className="h-3.5 w-3.5" />
                                {t('print.printAndSave') || 'Print & Save'}
                            </button>
                        </div>
                    </header>

                    <div className="flex-1 min-h-0">
                        {activeDocumentId && (
                            <DocumentContent documentId={activeDocumentId}>
                                {({ isLoaded }) =>
                                    isLoaded ? (
                                        <Viewport
                                            documentId={activeDocumentId}
                                            className="h-full w-full"
                                            style={{ backgroundColor: '#f1f3f5' }}
                                        >
                                            <Scroller
                                                documentId={activeDocumentId}
                                                renderPage={({ width, height, pageIndex }) => (
                                                    <div
                                                        style={{ width, height }}
                                                        className="shadow-sm"
                                                    >
                                                        <RenderLayer
                                                            documentId={activeDocumentId}
                                                            pageIndex={pageIndex}
                                                        />
                                                    </div>
                                                )}
                                            />
                                        </Viewport>
                                    ) : (
                                        <div className="flex h-full items-center justify-center">
                                            <div className="flex items-center gap-2 text-muted-foreground">
                                                <Loader2 className="h-4 w-4 animate-spin" />
                                                <span className="text-sm">{t('common.loading') || 'Loading...'}</span>
                                            </div>
                                        </div>
                                    )
                                }
                            </DocumentContent>
                        )}
                    </div>
                </div>
            )}
        </EmbedPDF>
    )
}
