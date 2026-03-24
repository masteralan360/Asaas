import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { Camera, Loader2, RefreshCw, Upload } from 'lucide-react'
import { parse, type ParseResult } from 'mrz'
import Tesseract from 'tesseract.js'

import { cn } from '@/lib/utils'
import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    useToast
} from '@/ui/components'

export type TouristMrzScanMode = 'upload' | 'camera'

export type TouristMrzScanResult = {
    fullName?: string
    surname?: string
    dateOfBirth?: string
    rawMrz: string
}

type TouristMrzScanDialogProps = {
    open: boolean
    onOpenChange: (open: boolean) => void
    touristLabel: string
    initialMode?: TouristMrzScanMode
    onScanned: (result: TouristMrzScanResult) => void
}

type ParsedCandidate = {
    parsed: ParseResult
    rawMrz: string
    score: number
    criticalFieldCount: number
}

const OCR_WHITELIST = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<'
const MRZ_LINE_LENGTHS = [30, 36, 44] as const
const OCR_TARGET_WIDTH = 2600
const OCR_TARGET_HEIGHT = 900
const MAX_UPSCALE_FACTOR = 2.75
const MIN_ACCEPTED_CANDIDATE_SCORE = 20
const MIN_ACCEPTED_CRITICAL_FIELDS = 4
const MRZ_CROP_WINDOWS: Array<{
    label: string
    topRatio: number
    heightRatio: number
    lineCounts: Array<2 | 3>
}> = [
    { label: 'tight-passport', topRatio: 0.78, heightRatio: 0.18, lineCounts: [2] },
    { label: 'balanced-passport', topRatio: 0.73, heightRatio: 0.24, lineCounts: [2] },
    { label: 'document-band', topRatio: 0.68, heightRatio: 0.30, lineCounts: [2, 3] }
]

type OcrSource =
    | {
        kind: 'block'
        label: string
        canvas: HTMLCanvasElement
    }
    | {
        kind: 'lines'
        label: string
        canvases: HTMLCanvasElement[]
    }

function getLocalMrzLangPath() {
    if (typeof window === 'undefined') {
        return ''
    }

    return `${window.location.origin.replace(/\/$/, '')}/tessdata`
}

async function createMrzWorker(logger: (message: string, progress: number) => void) {
    const localLangPath = getLocalMrzLangPath()

    try {
        return await Tesseract.createWorker('ocrb_int', 1, {
            logger: (message) => logger(message.status, message.progress),
            langPath: localLangPath,
            gzip: false
        })
    } catch {
        return Tesseract.createWorker('eng', 1, {
            logger: (message) => logger(message.status, message.progress)
        })
    }
}

function normalizeBirthDate(value: string | null | undefined) {
    if (!value || !/^\d{6}$/.test(value)) {
        return ''
    }

    const yearPart = Number(value.slice(0, 2))
    const month = Number(value.slice(2, 4))
    const day = Number(value.slice(4, 6))
    const today = new Date()
    let year = 2000 + yearPart

    const candidate = new Date(Date.UTC(year, month - 1, day))
    if (
        Number.isNaN(candidate.getTime()) ||
        candidate.getUTCMonth() !== month - 1 ||
        candidate.getUTCDate() !== day
    ) {
        return ''
    }

    const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
    if (candidate.getTime() > todayUtc) {
        year -= 100
    }

    return `${year}-${value.slice(2, 4)}-${value.slice(4, 6)}`
}

function normalizeMrzLine(value: string) {
    return value
        .toUpperCase()
        .replace(/[Â«â€¹Ë‚_=\-–—]/g, '<')
        .replace(/[ \t]/g, '')
        .replace(/[^A-Z0-9<]/g, '')
}

function countMatches(value: string, pattern: RegExp) {
    return value.match(pattern)?.length || 0
}

function clampByte(value: number) {
    return Math.max(0, Math.min(255, Math.round(value)))
}

function extractMrzLikeLines(text: string) {
    return text
        .split(/\r?\n/)
        .map(normalizeMrzLine)
        .filter((line) => {
            if (line.length < 24) {
                return false
            }

            const mrzCharacterCount = countMatches(line, /[A-Z0-9<]/g)
            const fillerCount = countMatches(line, /</g)
            return mrzCharacterCount >= 24 && fillerCount >= 1
        })
}

function buildExactLineCandidates(line: string) {
    const variants = new Set<string>()

    for (const exactLength of MRZ_LINE_LENGTHS) {
        if (line.length === exactLength) {
            variants.add(line)
        } else if (line.length > exactLength) {
            for (let start = 0; start <= line.length - exactLength; start += 1) {
                variants.add(line.slice(start, start + exactLength))
            }
        } else if (line.length >= exactLength - 2 && line.includes('<')) {
            variants.add(line.padEnd(exactLength, '<'))
        }
    }

    return Array.from(variants).filter((candidate) => {
        const fillerCount = countMatches(candidate, /</g)
        const digitCount = countMatches(candidate, /\d/g)
        return fillerCount >= 1 && digitCount + fillerCount >= Math.floor(candidate.length * 0.28)
    })
}

function parseMrzCandidates(text: string) {
    const lines = extractMrzLikeLines(text)
    const lineVariants = lines.map((line) => buildExactLineCandidates(line))
    const candidates = new Set<string>()

    for (let index = 0; index < lineVariants.length - 1; index += 1) {
        for (const firstLine of lineVariants[index]) {
            for (const secondLine of lineVariants[index + 1]) {
                if (
                    (firstLine.length === 44 && secondLine.length === 44) ||
                    (firstLine.length === 36 && secondLine.length === 36)
                ) {
                    candidates.add([firstLine, secondLine].join('\n'))
                }
            }
        }
    }

    for (let index = 0; index < lineVariants.length - 2; index += 1) {
        for (const firstLine of lineVariants[index]) {
            for (const secondLine of lineVariants[index + 1]) {
                for (const thirdLine of lineVariants[index + 2]) {
                    if (firstLine.length === 30 && secondLine.length === 30 && thirdLine.length === 30) {
                        candidates.add([firstLine, secondLine, thirdLine].join('\n'))
                    }
                }
            }
        }
    }

    const compact = lines.join('')
    const compactLengths = [
        { totalLength: 88, rows: [44, 44] },
        { totalLength: 72, rows: [36, 36] },
        { totalLength: 90, rows: [30, 30, 30] }
    ] as const

    for (const { totalLength, rows } of compactLengths) {
        if (compact.length < totalLength) {
            continue
        }

        for (let start = 0; start <= compact.length - totalLength; start += 1) {
            const slice = compact.slice(start, start + totalLength)
            let offset = 0
            const nextLines = rows.map((lineLength) => {
                const line = slice.slice(offset, offset + lineLength)
                offset += lineLength
                return line
            })
            candidates.add(nextLines.join('\n'))
        }
    }

    return Array.from(candidates)
    /*
    const normalized = text
        .toUpperCase()
        .replace(/[«‹˂]/g, '<')
        .replace(/[ \t]/g, '')
        .replace(/[^A-Z0-9<\n]/g, '\n')

    const lines = normalized
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length >= 20)

    const candidates = new Set<string>()

    for (let index = 0; index < lines.length - 1; index += 1) {
        candidates.add([lines[index], lines[index + 1]].join('\n'))
    }

    for (let index = 0; index < lines.length - 2; index += 1) {
        candidates.add([lines[index], lines[index + 1], lines[index + 2]].join('\n'))
    }

    const compact = lines.join('')
    if (compact.length >= 88) {
        candidates.add([compact.slice(0, 44), compact.slice(44, 88)].join('\n'))
    }
    if (compact.length >= 90) {
        candidates.add([compact.slice(0, 30), compact.slice(30, 60), compact.slice(60, 90)].join('\n'))
    }

    return Array.from(candidates)
    */
}

function countCriticalFields(parsed: ParseResult) {
    const { fields } = parsed

    return [
        fields.lastName,
        fields.firstName,
        parsed.documentNumber || fields.documentNumber,
        fields.birthDate,
        fields.expirationDate
    ].filter(Boolean).length
}

function scoreParsedCandidate(parsed: ParseResult, rawMrz: string) {
    const validFields = new Set(parsed.details.filter((detail) => detail.valid && detail.field).map((detail) => detail.field))
    const lines = rawMrz.split('\n')

    return [
        parsed.valid ? 14 : 0,
        validFields.has('lastName') ? 3 : 0,
        validFields.has('firstName') ? 3 : 0,
        validFields.has('documentNumber') || parsed.documentNumber ? 3 : 0,
        validFields.has('birthDate') ? 3 : 0,
        validFields.has('expirationDate') ? 2 : 0,
        (lines[0] || '').includes('<<') ? 1 : 0
    ].reduce((sum, value) => sum + value, 0)
    /*

    const { fields } = parsed

    return [
        parsed.valid ? 4 : 0,
        fields.lastName ? 2 : 0,
        fields.firstName ? 2 : 0,
        parsed.documentNumber || fields.documentNumber ? 2 : 0,
        fields.birthDate ? 2 : 0,
        fields.nationality ? 1 : 0,
        parsed.format === 'TD1' || parsed.format === 'TD2' || parsed.format === 'TD3' ? 1 : 0
    ].reduce((sum, value) => sum + value, 0)
    */
}

function parseMrzText(text: string): ParsedCandidate | null {
    const candidates = parseMrzCandidates(text)
    let bestCandidate: ParsedCandidate | null = null

    for (const candidate of candidates) {
        try {
            const parsed = parse(candidate, { autocorrect: true })
            const criticalFieldCount = countCriticalFields(parsed)
            const scored = {
                parsed,
                rawMrz: candidate,
                score: scoreParsedCandidate(parsed, candidate),
                criticalFieldCount
            }

            if (!bestCandidate || scored.score > bestCandidate.score) {
                bestCandidate = scored
            }
        } catch {
            continue
        }
    }

    if (
        !bestCandidate ||
        (
            !bestCandidate.parsed.valid &&
            (
                bestCandidate.score < MIN_ACCEPTED_CANDIDATE_SCORE ||
                bestCandidate.criticalFieldCount < MIN_ACCEPTED_CRITICAL_FIELDS
            )
        )
    ) {
        return null
    }

    return bestCandidate
}

function mapParsedMrz(parsedCandidate: ParsedCandidate): TouristMrzScanResult {
    const { parsed, rawMrz } = parsedCandidate
    return {
        fullName: parsed.fields.firstName || '',
        surname: parsed.fields.lastName || '',
        dateOfBirth: normalizeBirthDate(parsed.fields.birthDate),
        rawMrz
    }
}

function createScaledCanvas(
    image: CanvasImageSource,
    sourceWidth: number,
    sourceHeight: number,
    options?: {
        sx?: number
        sy?: number
        sw?: number
        sh?: number
        targetWidth?: number
        targetHeight?: number
        maxScale?: number
    }
) {
    const sx = options?.sx ?? 0
    const sy = options?.sy ?? 0
    const sw = options?.sw ?? sourceWidth
    const sh = options?.sh ?? sourceHeight
    const targetWidth = options?.targetWidth ?? OCR_TARGET_WIDTH
    const targetHeight = options?.targetHeight ?? OCR_TARGET_HEIGHT
    const maxScale = options?.maxScale ?? MAX_UPSCALE_FACTOR
    const scale = Math.min(maxScale, Math.min(targetWidth / sw, targetHeight / sh))
    const canvas = document.createElement('canvas')

    canvas.width = Math.max(1, Math.round(sw * scale))
    canvas.height = Math.max(1, Math.round(sh * scale))

    const context = canvas.getContext('2d')
    if (!context) {
        throw new Error('Canvas is not available in this browser.')
    }

    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
    return canvas
}

function cloneCanvas(source: HTMLCanvasElement) {
    const canvas = document.createElement('canvas')
    canvas.width = source.width
    canvas.height = source.height

    const context = canvas.getContext('2d')
    if (!context) {
        throw new Error('Canvas is not available in this browser.')
    }

    context.drawImage(source, 0, 0)
    return canvas
}

function createProcessedCanvas(source: HTMLCanvasElement, mode: 'raw' | 'grayscale' | 'binary') {
    const canvas = cloneCanvas(source)
    if (mode === 'raw') {
        return canvas
    }

    const context = canvas.getContext('2d')
    if (!context) {
        throw new Error('Canvas is not available in this browser.')
    }

    const imageData = context.getImageData(0, 0, canvas.width, canvas.height)
    const { data } = imageData
    let grayscaleTotal = 0

    for (let index = 0; index < data.length; index += 4) {
        const grayscale = data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114
        grayscaleTotal += grayscale
    }

    const average = grayscaleTotal / Math.max(1, data.length / 4)
    const threshold = average * 0.92

    for (let index = 0; index < data.length; index += 4) {
        const grayscale = data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114

        if (mode === 'binary') {
            const binary = grayscale < threshold ? 0 : 255
            data[index] = binary
            data[index + 1] = binary
            data[index + 2] = binary
        } else {
            const boosted = clampByte((grayscale - average) * 1.85 + 128)
            data[index] = boosted
            data[index + 1] = boosted
            data[index + 2] = boosted
        }
    }

    context.putImageData(imageData, 0, 0)
    return canvas
}

function createEnhancedCanvas(source: HTMLCanvasElement) {
    return createProcessedCanvas(source, 'binary')
    /*
    const canvas = document.createElement('canvas')
    canvas.width = source.width
    canvas.height = source.height

    const context = canvas.getContext('2d')
    if (!context) {
        throw new Error('Canvas is not available in this browser.')
    }

    context.drawImage(source, 0, 0)
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height)
    const { data } = imageData

    for (let index = 0; index < data.length; index += 4) {
        const grayscale = data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114
        const contrast = grayscale < 165 ? 0 : 255
        data[index] = contrast
        data[index + 1] = contrast
        data[index + 2] = contrast
    }

    context.putImageData(imageData, 0, 0)
    return canvas
    */
}

function splitCanvasIntoLines(source: HTMLCanvasElement, lineCount: 2 | 3) {
    const slices: HTMLCanvasElement[] = []
    const baseHeight = source.height / lineCount
    const overlap = Math.round(baseHeight * 0.14)

    for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
        const sy = Math.max(0, Math.floor(lineIndex * baseHeight - overlap))
        const sh = Math.min(source.height - sy, Math.ceil(baseHeight + overlap * 2))

        slices.push(createScaledCanvas(source, source.width, source.height, {
            sx: 0,
            sy,
            sw: source.width,
            sh,
            targetWidth: OCR_TARGET_WIDTH,
            targetHeight: 260,
            maxScale: 3.1
        }))
    }

    return slices
}

async function recognizeOcrSource(
    worker: Awaited<ReturnType<typeof Tesseract.createWorker>>,
    source: OcrSource
) {
    await worker.setParameters({
        tessedit_pageseg_mode: source.kind === 'lines' ? Tesseract.PSM.SINGLE_LINE : Tesseract.PSM.SINGLE_BLOCK,
        tessedit_char_whitelist: OCR_WHITELIST,
        preserve_interword_spaces: '0',
        load_system_dawg: '0',
        load_freq_dawg: '0',
        load_unambig_dawg: '0',
        load_punc_dawg: '0',
        load_number_dawg: '0',
        load_bigram_dawg: '0',
        user_defined_dpi: '300'
    })

    if (source.kind === 'block') {
        const result = await worker.recognize(source.canvas, { rotateAuto: false })
        return result.data.text || ''
    }

    const lines: string[] = []
    for (const lineCanvas of source.canvases) {
        const result = await worker.recognize(lineCanvas, { rotateAuto: false })
        lines.push(result.data.text || '')
    }

    return lines.join('\n')
}

function buildOcrVariants(image: HTMLImageElement): OcrSource[] {
    const sources: OcrSource[] = []

    for (const window of MRZ_CROP_WINDOWS) {
        const sy = Math.floor(image.naturalHeight * window.topRatio)
        const sh = Math.max(Math.floor(image.naturalHeight * window.heightRatio), 1)
        const crop = createScaledCanvas(image, image.naturalWidth, image.naturalHeight, {
            sx: 0,
            sy,
            sw: image.naturalWidth,
            sh,
            targetWidth: OCR_TARGET_WIDTH,
            targetHeight: OCR_TARGET_HEIGHT
        })

        const variants = [
            { label: 'raw', canvas: createProcessedCanvas(crop, 'raw') },
            { label: 'grayscale', canvas: createProcessedCanvas(crop, 'grayscale') },
            { label: 'binary', canvas: createEnhancedCanvas(crop) }
        ] as const

        for (const variant of variants) {
            for (const lineCount of window.lineCounts) {
                sources.push({
                    kind: 'lines',
                    label: `${window.label}-${variant.label}-${lineCount}-lines`,
                    canvases: splitCanvasIntoLines(variant.canvas, lineCount)
                })
            }

            sources.push({
                kind: 'block',
                label: `${window.label}-${variant.label}-block`,
                canvas: variant.canvas
            })
        }
    }

    return sources
    /*

    const full = createScaledCanvas(image, image.naturalWidth, image.naturalHeight)
    const mrzCropTop = Math.floor(image.naturalHeight * 0.55)
    const mrzCropHeight = Math.max(image.naturalHeight - mrzCropTop, 1)
    const crop = createScaledCanvas(image, image.naturalWidth, image.naturalHeight, {
        sx: 0,
        sy: mrzCropTop,
        sw: image.naturalWidth,
        sh: mrzCropHeight
    })

    return [
        createEnhancedCanvas(crop),
        crop,
        createEnhancedCanvas(full),
        full
    ]
    */
}

function loadImage(blob: Blob) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
        const url = URL.createObjectURL(blob)
        const image = new Image()

        image.onload = () => {
            URL.revokeObjectURL(url)
            resolve(image)
        }
        image.onerror = () => {
            URL.revokeObjectURL(url)
            reject(new Error('The selected image could not be loaded.'))
        }
        image.src = url
    })
}

async function recognizeMrzFromImage(
    blob: Blob,
    onProgress: (message: string, progress: number) => void,
    onWorkerReady: (worker: Awaited<ReturnType<typeof Tesseract.createWorker>> | null) => void
) {
    const image = await loadImage(blob)
    const variants = buildOcrVariants(image)
    const worker = await createMrzWorker(onProgress)

    onWorkerReady(worker)

    try {
        let bestText = ''

        for (const variant of variants) {
            const text = await recognizeOcrSource(worker, variant)

            if (text.length > bestText.length) {
                bestText = text
            }

            const parsed = parseMrzText(text)
            if (parsed) {
                return mapParsedMrz(parsed)
            }
        }

        const fallbackParsed = parseMrzText(bestText)
        if (fallbackParsed) {
            return mapParsedMrz(fallbackParsed)
        }

        throw new Error('MRZ was not detected clearly enough. Try a sharper image with the MRZ area fully visible.')
        /*
        await worker.setParameters({
            tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK,
            tessedit_char_whitelist: OCR_WHITELIST,
            preserve_interword_spaces: '0'
        })

        let legacyBestText = ''

        for (const variant of variants) {
            const result = await worker.recognize(variant as unknown as HTMLCanvasElement, { rotateAuto: true })
            const text = result.data.text || ''

            if (text.length > legacyBestText.length) {
                legacyBestText = text
            }

            const parsed = parseMrzText(text)
            if (parsed) {
                return mapParsedMrz(parsed)
            }
        }

        const fallbackLegacyParsed = parseMrzText(legacyBestText)
        if (fallbackLegacyParsed) {
            return mapParsedMrz(fallbackLegacyParsed)
        }

        throw new Error('MRZ was not detected clearly enough. Try a sharper image with the MRZ area fully visible.')
        */
    } finally {
        await worker.terminate()
        onWorkerReady(null)
    }
}

export function TouristMrzScanDialog({
    open,
    onOpenChange,
    touristLabel,
    initialMode = 'upload',
    onScanned
}: TouristMrzScanDialogProps) {
    const { toast } = useToast()
    const fileInputRef = useRef<HTMLInputElement | null>(null)
    const videoRef = useRef<HTMLVideoElement | null>(null)
    const streamRef = useRef<MediaStream | null>(null)
    const workerRef = useRef<Awaited<ReturnType<typeof Tesseract.createWorker>> | null>(null)
    const scanSequenceRef = useRef(0)
    const [mode, setMode] = useState<TouristMrzScanMode>(initialMode)
    const [previewUrl, setPreviewUrl] = useState('')
    const [isDragging, setIsDragging] = useState(false)
    const [isScanning, setIsScanning] = useState(false)
    const [isCameraLoading, setIsCameraLoading] = useState(false)
    const [progressLabel, setProgressLabel] = useState('Ready')
    const [progressValue, setProgressValue] = useState(0)
    const [errorMessage, setErrorMessage] = useState('')

    useEffect(() => {
        setMode(initialMode)
    }, [initialMode, open])

    useEffect(() => {
        return () => {
            if (previewUrl) {
                URL.revokeObjectURL(previewUrl)
            }
        }
    }, [previewUrl])

    useEffect(() => {
        if (!open) {
            scanSequenceRef.current += 1
            if (streamRef.current) {
                streamRef.current.getTracks().forEach((track) => track.stop())
                streamRef.current = null
            }
            if (workerRef.current) {
                void workerRef.current.terminate().catch(() => undefined)
                workerRef.current = null
            }
            setIsDragging(false)
            setIsScanning(false)
            setIsCameraLoading(false)
            setProgressLabel('Ready')
            setProgressValue(0)
            setErrorMessage('')
            if (previewUrl) {
                URL.revokeObjectURL(previewUrl)
                setPreviewUrl('')
            }
        }
    }, [open, previewUrl])

    useEffect(() => {
        if (!open) {
            return
        }

        function handlePaste(event: ClipboardEvent) {
            const imageItem = Array.from(event.clipboardData?.items || []).find((item) => item.type.startsWith('image/'))
            const file = imageItem?.getAsFile()
            if (!file) {
                return
            }

            event.preventDefault()
            void scanBlob(file)
        }

        window.addEventListener('paste', handlePaste)
        return () => window.removeEventListener('paste', handlePaste)
    }, [open])

    useEffect(() => {
        if (!open || mode !== 'camera') {
            if (streamRef.current) {
                streamRef.current.getTracks().forEach((track) => track.stop())
                streamRef.current = null
            }
            return
        }

        let cancelled = false

        async function startCamera() {
            if (!navigator.mediaDevices?.getUserMedia) {
                setErrorMessage('Camera access is not available in this environment.')
                return
            }

            setIsCameraLoading(true)
            setErrorMessage('')

            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: {
                        facingMode: { ideal: 'environment' }
                    },
                    audio: false
                })

                if (cancelled) {
                    stream.getTracks().forEach((track) => track.stop())
                    return
                }

                if (streamRef.current) {
                    streamRef.current.getTracks().forEach((track) => track.stop())
                }

                streamRef.current = stream
                if (videoRef.current) {
                    videoRef.current.srcObject = stream
                    await videoRef.current.play().catch(() => undefined)
                }
            } catch (error) {
                setErrorMessage(error instanceof Error ? error.message : 'Unable to access the camera.')
            } finally {
                if (!cancelled) {
                    setIsCameraLoading(false)
                }
            }
        }

        void startCamera()

        return () => {
            cancelled = true
            if (streamRef.current) {
                streamRef.current.getTracks().forEach((track) => track.stop())
                streamRef.current = null
            }
        }
    }, [mode, open])

    async function scanBlob(blob: Blob) {
        const scanId = scanSequenceRef.current + 1
        scanSequenceRef.current = scanId

        if (previewUrl) {
            URL.revokeObjectURL(previewUrl)
        }

        setPreviewUrl(URL.createObjectURL(blob))
        setIsScanning(true)
        setErrorMessage('')
        setProgressLabel('Preparing image')
        setProgressValue(0)

        try {
            const result = await recognizeMrzFromImage(
                blob,
                (message, progress) => {
                    if (scanSequenceRef.current !== scanId) {
                        return
                    }

                    setProgressLabel(message)
                    setProgressValue(progress)
                },
                (worker) => {
                    workerRef.current = worker
                }
            )

            if (scanSequenceRef.current !== scanId) {
                return
            }

            onScanned(result)
            toast({
                title: 'MRZ scanned',
                description: `${touristLabel} details were filled from the detected MRZ.`
            })
            onOpenChange(false)
        } catch (error) {
            if (scanSequenceRef.current !== scanId) {
                return
            }

            const message = error instanceof Error ? error.message : 'The scan did not complete.'
            setErrorMessage(message)
            toast({
                title: 'Scan failed',
                description: message,
                variant: 'destructive'
            })
        } finally {
            if (scanSequenceRef.current === scanId) {
                setIsScanning(false)
            }
        }
    }

    function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0]
        if (!file) {
            return
        }

        void scanBlob(file)
        event.target.value = ''
    }

    function handleDrop(event: DragEvent<HTMLDivElement>) {
        event.preventDefault()
        setIsDragging(false)

        const file = Array.from(event.dataTransfer.files).find((entry) => entry.type.startsWith('image/'))
        if (!file) {
            setErrorMessage('Drop an image file to scan the MRZ.')
            return
        }

        void scanBlob(file)
    }

    async function handleCaptureClick() {
        const video = videoRef.current
        if (!video || !video.videoWidth || !video.videoHeight) {
            setErrorMessage('The camera is not ready yet. Wait a moment and try again.')
            return
        }

        const canvas = createScaledCanvas(video, video.videoWidth, video.videoHeight)
        const blob = await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob(
                (capturedBlob) => {
                    if (capturedBlob) {
                        resolve(capturedBlob)
                    } else {
                        reject(new Error('Failed to capture the current camera frame.'))
                    }
                },
                'image/jpeg',
                0.92
            )
        })

        void scanBlob(blob)
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="w-[96vw] max-w-5xl overflow-hidden rounded-[2rem] border border-border/60 p-0">
                <div className="flex max-h-[92vh] flex-col overflow-hidden">
                    <DialogHeader className="border-b border-border/60 px-6 py-5 sm:px-8">
                        <DialogTitle>Scan MRZ for {touristLabel}</DialogTitle>
                        <DialogDescription>
                            Upload or capture a passport or ID image. The scanner also accepts drag-and-drop and clipboard images with Ctrl+V.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="flex flex-wrap gap-2 border-b border-border/60 px-6 py-4 sm:px-8">
                        <Button
                            type="button"
                            variant={mode === 'upload' ? 'default' : 'outline'}
                            className="gap-2"
                            onClick={() => setMode('upload')}
                        >
                            <Upload className="h-4 w-4" />
                            Upload
                        </Button>
                        <Button
                            type="button"
                            variant={mode === 'camera' ? 'default' : 'outline'}
                            className="gap-2"
                            onClick={() => setMode('camera')}
                        >
                            <Camera className="h-4 w-4" />
                            Camera
                        </Button>
                    </div>

                    <div className="grid flex-1 gap-0 overflow-auto lg:grid-cols-[minmax(0,1.35fr)_360px]">
                        <div className="p-6 sm:p-8">
                            {mode === 'upload' ? (
                                <div
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => fileInputRef.current?.click()}
                                    onKeyDown={(event) => {
                                        if (event.key === 'Enter' || event.key === ' ') {
                                            event.preventDefault()
                                            fileInputRef.current?.click()
                                        }
                                    }}
                                    onDragEnter={(event) => {
                                        event.preventDefault()
                                        setIsDragging(true)
                                    }}
                                    onDragOver={(event) => {
                                        event.preventDefault()
                                        setIsDragging(true)
                                    }}
                                    onDragLeave={(event) => {
                                        event.preventDefault()
                                        setIsDragging(false)
                                    }}
                                    onDrop={handleDrop}
                                    className={cn(
                                        'flex min-h-[360px] cursor-pointer flex-col items-center justify-center rounded-[2rem] border-2 border-dashed px-8 py-12 text-center transition-colors',
                                        isDragging
                                            ? 'border-primary bg-primary/5'
                                            : 'border-border/60 bg-muted/20 hover:border-primary/50 hover:bg-primary/5'
                                    )}
                                >
                                    <div className="space-y-4">
                                        <div className="text-2xl font-semibold">Drag and drop files here</div>
                                        <p className="mx-auto max-w-xl text-sm text-muted-foreground">
                                            Paste an image with Ctrl+V, drop a screenshot, or click here to choose a file from the device.
                                        </p>
                                        <Button type="button" variant="outline" className="gap-2">
                                            <Upload className="h-4 w-4" />
                                            Choose Image
                                        </Button>
                                    </div>
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept="image/*"
                                        className="hidden"
                                        onChange={handleFileChange}
                                    />
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    <div className="overflow-hidden rounded-[2rem] border border-border/60 bg-black/90">
                                        <video
                                            ref={videoRef}
                                            autoPlay
                                            playsInline
                                            muted
                                            className="aspect-[4/3] w-full object-cover"
                                        />
                                    </div>
                                    <div className="flex flex-wrap gap-3">
                                        <Button
                                            type="button"
                                            className="gap-2"
                                            onClick={handleCaptureClick}
                                            disabled={isCameraLoading || isScanning}
                                        >
                                            <Camera className="h-4 w-4" />
                                            Capture and Scan
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            className="gap-2"
                                            onClick={() => setMode('upload')}
                                            disabled={isScanning}
                                        >
                                            <Upload className="h-4 w-4" />
                                            Use Upload Instead
                                        </Button>
                                    </div>
                                    <p className="text-sm text-muted-foreground">
                                        Position the document so the MRZ sits clearly at the bottom of the frame before capturing.
                                    </p>
                                </div>
                            )}
                        </div>

                        <div className="border-t border-border/60 bg-muted/20 p-6 sm:p-8 lg:border-l lg:border-t-0">
                            <div className="space-y-5">
                                <div className="space-y-2">
                                    <div className="text-sm font-semibold">Scan Status</div>
                                    <div className="rounded-2xl border border-border/60 bg-background px-4 py-3">
                                        <div className="flex items-center gap-3">
                                            {isScanning || isCameraLoading ? (
                                                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                                            ) : (
                                                <RefreshCw className="h-4 w-4 text-muted-foreground" />
                                            )}
                                            <div className="min-w-0">
                                                <div className="truncate text-sm font-medium">{isCameraLoading ? 'Opening camera' : progressLabel}</div>
                                                <div className="text-xs text-muted-foreground">
                                                    {isScanning ? `${Math.round(progressValue * 100)}% complete` : 'Waiting for image'}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                                            <div
                                                className="h-full rounded-full bg-primary transition-all"
                                                style={{ width: `${Math.max(6, Math.round(progressValue * 100))}%` }}
                                            />
                                        </div>
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <div className="text-sm font-semibold">Preview</div>
                                    <div className="overflow-hidden rounded-[1.5rem] border border-border/60 bg-background">
                                        {previewUrl ? (
                                            <img
                                                src={previewUrl}
                                                alt="MRZ scan preview"
                                                className="aspect-[4/3] w-full object-contain"
                                            />
                                        ) : (
                                            <div className="flex aspect-[4/3] items-center justify-center px-6 text-center text-sm text-muted-foreground">
                                                The selected image or captured frame will appear here before the parsed data is applied.
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {errorMessage && (
                                    <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                                        {errorMessage}
                                    </div>
                                )}

                                <div className="rounded-2xl border border-border/60 bg-background px-4 py-4 text-sm text-muted-foreground">
                                    Best results come from a straight, sharp image with strong light and the MRZ fully visible near the bottom edge.
                                </div>
                            </div>
                        </div>
                    </div>

                    <DialogFooter className="border-t border-border/60 px-6 py-4 sm:px-8">
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isScanning}>
                            Close
                        </Button>
                    </DialogFooter>
                </div>
            </DialogContent>
        </Dialog>
    )
}
