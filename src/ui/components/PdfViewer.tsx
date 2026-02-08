import { useEffect, useRef, useState } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'

pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()

interface PdfViewerProps {
    file: string | Blob | ArrayBuffer
    className?: string
    onLoadError?: (error: Error) => void
}

export function PdfViewer({ file, className, onLoadError }: PdfViewerProps) {
    const containerRef = useRef<HTMLDivElement>(null)
    const [numPages, setNumPages] = useState(0)
    const [pageWidth, setPageWidth] = useState(720)

    useEffect(() => {
        setNumPages(0)
    }, [file])

    useEffect(() => {
        const element = containerRef.current
        if (!element) return

        const updateWidth = () => {
            const nextWidth = Math.max(320, element.clientWidth - 32)
            setPageWidth(nextWidth)
        }

        updateWidth()

        const resizeObserver = new ResizeObserver(updateWidth)
        resizeObserver.observe(element)

        return () => {
            resizeObserver.disconnect()
        }
    }, [])

    return (
        <div ref={containerRef} className={className}>
            <Document
                file={file}
                onLoadSuccess={({ numPages }) => setNumPages(numPages)}
                onLoadError={onLoadError}
                loading={null}
                error={null}
            >
                <div className="flex flex-col items-center gap-4 p-4">
                    {Array.from({ length: numPages }, (_, index) => (
                        <Page
                            key={`page_${index + 1}`}
                            pageNumber={index + 1}
                            width={pageWidth}
                            renderAnnotationLayer
                            renderTextLayer
                        />
                    ))}
                </div>
            </Document>
        </div>
    )
}
