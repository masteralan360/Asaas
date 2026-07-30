import { db, type Invoice, type InvoiceVersion } from '@/local-db'
import { isTauri } from '@/lib/platform'

import { platformService } from './platformService'
import { r2Service } from './r2Service'

type PdfFormat = 'a4' | 'receipt'

type PdfSource = Pick<InvoiceVersion, 'pdfBlob' | 'localPath' | 'r2Path'>

type ArchiveEntry = {
    name: string
    data: Uint8Array
}

export type InvoicePdfArchiveResult = {
    exportedCount: number
    unavailableCount: number
    cancelled: boolean
}

const ZIP_LOCAL_FILE_HEADER = 0x04034b50
const ZIP_CENTRAL_DIRECTORY_HEADER = 0x02014b50
const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50
const ZIP_VERSION = 20
const ZIP_UTF8_FLAG = 0x0800

let crcTable: Uint32Array | null = null

function getCrcTable() {
    if (crcTable) return crcTable

    crcTable = new Uint32Array(256)
    for (let index = 0; index < 256; index += 1) {
        let value = index
        for (let bit = 0; bit < 8; bit += 1) {
            value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
        }
        crcTable[index] = value >>> 0
    }
    return crcTable
}

function crc32(data: Uint8Array) {
    const table = getCrcTable()
    let crc = 0xffffffff
    for (const byte of data) {
        crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8)
    }
    return (crc ^ 0xffffffff) >>> 0
}

function getDosDateTime(date = new Date()) {
    const year = Math.min(2107, Math.max(1980, date.getFullYear()))
    return {
        date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
        time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    }
}

function writeUint16(view: DataView, offset: number, value: number) {
    view.setUint16(offset, value, true)
}

function writeUint32(view: DataView, offset: number, value: number) {
    view.setUint32(offset, value, true)
}

/**
 * Build a standards-compliant, store-only ZIP archive. PDF files are already
 * compressed, so compression adds processing time without a useful size win.
 */
function buildZip(entries: ArchiveEntry[]) {
    if (entries.length > 0xffff) {
        throw new Error('Too many invoice PDFs to export in one archive.')
    }

    const encoder = new TextEncoder()
    const timestamp = getDosDateTime()
    const prepared = entries.map((entry) => ({
        ...entry,
        nameBytes: encoder.encode(entry.name),
        crc: crc32(entry.data),
    }))

    const localSize = prepared.reduce(
        (total, entry) => total + 30 + entry.nameBytes.length + entry.data.length,
        0,
    )
    const centralSize = prepared.reduce(
        (total, entry) => total + 46 + entry.nameBytes.length,
        0,
    )
    const totalSize = localSize + centralSize + 22
    if (totalSize > 0xffffffff) {
        throw new Error('Invoice PDF archive is too large to export in one file.')
    }

    const output = new Uint8Array(totalSize)
    const view = new DataView(output.buffer)
    const localOffsets: number[] = []
    let offset = 0

    for (const entry of prepared) {
        localOffsets.push(offset)
        writeUint32(view, offset, ZIP_LOCAL_FILE_HEADER)
        writeUint16(view, offset + 4, ZIP_VERSION)
        writeUint16(view, offset + 6, ZIP_UTF8_FLAG)
        writeUint16(view, offset + 8, 0)
        writeUint16(view, offset + 10, timestamp.time)
        writeUint16(view, offset + 12, timestamp.date)
        writeUint32(view, offset + 14, entry.crc)
        writeUint32(view, offset + 18, entry.data.length)
        writeUint32(view, offset + 22, entry.data.length)
        writeUint16(view, offset + 26, entry.nameBytes.length)
        writeUint16(view, offset + 28, 0)
        offset += 30
        output.set(entry.nameBytes, offset)
        offset += entry.nameBytes.length
        output.set(entry.data, offset)
        offset += entry.data.length
    }

    const centralOffset = offset
    prepared.forEach((entry, index) => {
        writeUint32(view, offset, ZIP_CENTRAL_DIRECTORY_HEADER)
        writeUint16(view, offset + 4, ZIP_VERSION)
        writeUint16(view, offset + 6, ZIP_VERSION)
        writeUint16(view, offset + 8, ZIP_UTF8_FLAG)
        writeUint16(view, offset + 10, 0)
        writeUint16(view, offset + 12, timestamp.time)
        writeUint16(view, offset + 14, timestamp.date)
        writeUint32(view, offset + 16, entry.crc)
        writeUint32(view, offset + 20, entry.data.length)
        writeUint32(view, offset + 24, entry.data.length)
        writeUint16(view, offset + 28, entry.nameBytes.length)
        writeUint16(view, offset + 30, 0)
        writeUint16(view, offset + 32, 0)
        writeUint16(view, offset + 34, 0)
        writeUint16(view, offset + 36, 0)
        writeUint32(view, offset + 38, 0)
        writeUint32(view, offset + 42, localOffsets[index])
        offset += 46
        output.set(entry.nameBytes, offset)
        offset += entry.nameBytes.length
    })

    writeUint32(view, offset, ZIP_END_OF_CENTRAL_DIRECTORY)
    writeUint16(view, offset + 4, 0)
    writeUint16(view, offset + 6, 0)
    writeUint16(view, offset + 8, prepared.length)
    writeUint16(view, offset + 10, prepared.length)
    writeUint32(view, offset + 12, offset - centralOffset)
    writeUint32(view, offset + 16, centralOffset)
    writeUint16(view, offset + 20, 0)

    return output
}

function sanitizeFileName(value: string | number | null | undefined, fallback: string) {
    const normalized = String(value || '')
        .trim()
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
        .replace(/\s+/g, ' ')
        .slice(0, 80)
    return normalized || fallback
}

function getVersionFileName(version: InvoiceVersion, invoice?: Invoice) {
    const identifier = invoice?.sequenceId
        ? String(invoice.sequenceId).padStart(5, '0')
        : invoice?.invoiceid || version.invoiceId
    const format = version.format === 'a4' ? 'A4' : 'Receipt'
    return `${format}/Invoice_${sanitizeFileName(identifier, version.invoiceId)}_v${version.versionNumber}_${version.id}.pdf`
}

function getLegacyFileName(invoice: Invoice, format: PdfFormat) {
    const identifier = invoice.sequenceId
        ? String(invoice.sequenceId).padStart(5, '0')
        : invoice.invoiceid || invoice.id
    const folder = format === 'a4' ? 'A4' : 'Receipt'
    return `${folder}/Invoice_${sanitizeFileName(identifier, invoice.id)}_${invoice.id}.pdf`
}

async function getPdfBytes(source: PdfSource): Promise<Uint8Array | null> {
    if (source.pdfBlob) {
        return new Uint8Array(await source.pdfBlob.arrayBuffer())
    }

    if (source.localPath) {
        try {
            if (await platformService.exists(source.localPath)) {
                return await platformService.readFile(source.localPath)
            }
        } catch (error) {
            console.warn('[InvoicePdfExport] Failed to read local invoice PDF:', source.localPath, error)
        }
    }

    if (source.r2Path) {
        const remoteFile = await r2Service.download(source.r2Path)
        return remoteFile ? new Uint8Array(remoteFile) : null
    }

    return null
}

async function saveArchive(fileName: string, content: Uint8Array) {
    if (isTauri()) {
        const [{ save }, { writeFile }] = await Promise.all([
            import('@tauri-apps/plugin-dialog'),
            import('@tauri-apps/plugin-fs'),
        ])
        const destination = await save({
            defaultPath: fileName,
            filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
        })
        if (!destination) return false
        await writeFile(destination, content)
        return true
    }

    const blob = new Blob([content], { type: 'application/zip' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = fileName
    anchor.style.display = 'none'
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
    URL.revokeObjectURL(url)
    return true
}

/**
 * Export every locally-known immutable invoice PDF for a workspace. Local
 * blobs, desktop app-data files, and cloud-backed PDFs are all supported.
 */
export async function downloadInvoicePdfArchive(
    workspaceId: string,
): Promise<InvoicePdfArchiveResult> {
    const [invoices, versions] = await Promise.all([
        db.invoices.where('workspaceId').equals(workspaceId).toArray(),
        db.invoice_versions.where('workspaceId').equals(workspaceId).toArray(),
    ])
    const invoiceById = new Map(invoices.map((invoice) => [invoice.id, invoice]))
    const versionedFormats = new Set(versions.map((version) => `${version.invoiceId}:${version.format}`))
    const entries: ArchiveEntry[] = []
    let unavailableCount = 0

    const addEntry = async (name: string, source: PdfSource) => {
        try {
            const data = await getPdfBytes(source)
            if (data && data.length > 0) {
                entries.push({ name, data })
            } else {
                unavailableCount += 1
            }
        } catch (error) {
            unavailableCount += 1
            console.warn('[InvoicePdfExport] Failed to retrieve invoice PDF:', name, error)
        }
    }

    const sortedVersions = [...versions].sort((a, b) => {
        const byInvoice = a.invoiceId.localeCompare(b.invoiceId)
        if (byInvoice !== 0) return byInvoice
        return a.versionNumber - b.versionNumber
    })
    for (const version of sortedVersions) {
        await addEntry(getVersionFileName(version, invoiceById.get(version.invoiceId)), version)
    }

    // Preserve PDFs from databases created before immutable invoice versions.
    for (const invoice of invoices) {
        const legacySources: Array<{ format: PdfFormat; source: PdfSource }> = [
            {
                format: 'a4',
                source: {
                    pdfBlob: invoice.pdfBlobA4,
                    localPath: invoice.localPathA4,
                    r2Path: invoice.r2PathA4,
                },
            },
            {
                format: 'receipt',
                source: {
                    pdfBlob: invoice.pdfBlobReceipt,
                    localPath: invoice.localPathReceipt,
                    r2Path: invoice.r2PathReceipt,
                },
            },
        ]

        for (const { format, source } of legacySources) {
            if (versionedFormats.has(`${invoice.id}:${format}`)) continue
            if (!source.pdfBlob && !source.localPath && !source.r2Path) continue
            await addEntry(getLegacyFileName(invoice, format), source)
        }
    }

    if (entries.length === 0) {
        return { exportedCount: 0, unavailableCount, cancelled: false }
    }

    const archive = buildZip(entries)
    const saved = await saveArchive(
        `atlas-pdf-invoices-${new Date().toISOString().slice(0, 10)}.zip`,
        archive,
    )

    return {
        exportedCount: entries.length,
        unavailableCount,
        cancelled: !saved,
    }
}
