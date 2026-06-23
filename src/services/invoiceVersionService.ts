import { supabase } from '@/auth/supabase'
import { db, type Invoice, type InvoiceOrigin, type InvoiceVersion } from '@/local-db'
import { assetManager } from '@/lib/assetManager'
import { isOnline } from '@/lib/network'
import { generateId, toCamelCase } from '@/lib/utils'
import { isLocalWorkspaceMode } from '@/workspace/workspaceMode'

import { saveInvoicePdfToLocalAppData } from './localInvoiceStorage'
import type { PrintFormat } from './pdfGenerator'

type InvoiceVersionAuthor = {
    id?: string
    name?: string
}

type PersistInvoiceVersionOptions = {
    invoice: Invoice
    blob: Blob
    format: PrintFormat
    author: InvoiceVersionAuthor
    metadata?: Record<string, unknown>
}

const sanitizePathSegment = (value: string) =>
    value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-') || 'manual'

export function getInvoiceSourceId(invoice: Pick<Invoice, 'id' | 'sourceId' | 'orderId'>) {
    return invoice.sourceId || invoice.orderId || invoice.id
}

export function getInvoiceOrigin(invoice: Pick<Invoice, 'origin'>): InvoiceOrigin {
    return invoice.origin || 'manual'
}

export function getInvoiceVersionR2Path(
    workspaceId: string,
    origin: InvoiceOrigin,
    sourceId: string,
    format: PrintFormat,
    versionId: string,
) {
    const folder = format === 'a4' ? 'A4' : 'receipts'
    return `${workspaceId}/printed-invoices/versions/${sanitizePathSegment(origin)}/${sourceId}/${folder}/${versionId}.pdf`
}

/** Stable latest-version alias used by QR codes generated before the version row exists. */
export function getInvoiceLatestAliasR2Path(
    workspaceId: string,
    sourceId: string,
    format: PrintFormat,
) {
    const folder = format === 'a4' ? 'A4' : 'receipts'
    return `${workspaceId}/printed-invoices/${folder}/${sourceId}.pdf`
}

async function getNextLocalVersionNumber(invoiceId: string) {
    const versions = await db.invoice_versions.where('invoiceId').equals(invoiceId).toArray()
    return versions.reduce((max, version) => Math.max(max, version.versionNumber), 0) + 1
}

function mapRemoteVersion(row: Record<string, unknown>): InvoiceVersion {
    const mapped = toCamelCase(row) as unknown as InvoiceVersion
    return {
        ...mapped,
        fileSize: Number(mapped.fileSize || 0),
        versionNumber: Number(mapped.versionNumber || 0),
        syncStatus: 'synced',
        lastSyncedAt: new Date().toISOString(),
    }
}

async function createRemoteVersion(
    invoice: Invoice,
    versionId: string,
    format: PrintFormat,
    r2Path: string,
    fileSize: number,
    author: InvoiceVersionAuthor,
    metadata?: Record<string, unknown>,
) {
    const sourceId = getInvoiceSourceId(invoice)
    const origin = getInvoiceOrigin(invoice)
    const { data, error } = await supabase
        .rpc('create_invoice_version', {
            p_id: versionId,
            p_invoice_id: invoice.id,
            p_workspace_id: invoice.workspaceId,
            p_source_id: sourceId,
            p_origin: origin,
            p_format: format,
            p_r2_path: r2Path,
            p_file_size: fileSize,
            p_created_by_name: author.name || null,
            p_metadata: metadata || {},
        })
        .single()

    if (error) throw error
    return mapRemoteVersion(data as Record<string, unknown>)
}

async function ensureRemoteInvoiceParent(invoice: Invoice, author: InvoiceVersionAuthor) {
    const { error } = await supabase.from('invoices').upsert({
        id: invoice.id,
        user_id: invoice.createdBy || author.id,
        workspace_id: invoice.workspaceId,
        invoiceid: invoice.invoiceid,
        source_id: getInvoiceSourceId(invoice),
        order_id: invoice.orderId || null,
        total_amount: invoice.totalAmount,
        total: invoice.totalAmount,
        settlement_currency: invoice.settlementCurrency,
        origin: getInvoiceOrigin(invoice),
        cashier_name: invoice.cashierName || author.name || null,
        created_by: invoice.createdBy || author.id || null,
        created_by_name: invoice.createdByName || author.name || null,
        print_format: invoice.printFormat || null,
        updated_at: new Date().toISOString(),
    })
    if (error) throw error
}

async function updateLocalLatest(invoice: Invoice, version: InvoiceVersion) {
    const update: Partial<Invoice> = {
        sourceId: version.sourceId,
        latestVersionId: version.id,
        latestVersionNumber: version.versionNumber,
        printFormat: version.format,
        updatedAt: version.createdAt,
        syncStatus: version.syncStatus,
        lastSyncedAt: version.lastSyncedAt,
    }

    if (version.format === 'a4') {
        update.r2PathA4 = version.r2Path
        update.localPathA4 = version.localPath
        update.pdfBlobA4 = version.syncStatus === 'pending' ? version.pdfBlob : undefined
    } else {
        update.r2PathReceipt = version.r2Path
        update.localPathReceipt = version.localPath
        update.pdfBlobReceipt = version.syncStatus === 'pending' ? version.pdfBlob : undefined
    }

    await db.invoices.update(invoice.id, update)
}

async function storeLocalVersion(
    invoice: Invoice,
    versionId: string,
    blob: Blob,
    format: PrintFormat,
    author: InvoiceVersionAuthor,
    syncStatus: InvoiceVersion['syncStatus'],
    localPath?: string | null,
    metadata?: Record<string, unknown>,
) {
    return db.transaction('rw', [db.invoice_versions, db.invoices], async () => {
        const versionNumber = await getNextLocalVersionNumber(invoice.id)
        const now = new Date().toISOString()
        const version: InvoiceVersion = {
            id: versionId,
            invoiceId: invoice.id,
            workspaceId: invoice.workspaceId,
            sourceId: getInvoiceSourceId(invoice),
            origin: getInvoiceOrigin(invoice),
            versionNumber,
            format,
            localPath: localPath || undefined,
            pdfBlob: localPath ? undefined : blob,
            fileSize: blob.size,
            createdBy: author.id,
            createdByName: author.name,
            createdAt: now,
            syncStatus,
            lastSyncedAt: syncStatus === 'synced' ? now : null,
            metadata,
        }
        await db.invoice_versions.put(version)
        await updateLocalLatest(invoice, version)
        return version
    })
}

export async function persistInvoiceVersion({
    invoice,
    blob,
    format,
    author,
    metadata,
}: PersistInvoiceVersionOptions): Promise<InvoiceVersion> {
    const versionId = generateId()
    const sourceId = getInvoiceSourceId(invoice)
    const origin = getInvoiceOrigin(invoice)

    if (isLocalWorkspaceMode(invoice.workspaceId)) {
        const localPath = await saveInvoicePdfToLocalAppData(
            invoice.workspaceId,
            invoice.id,
            format,
            blob,
            versionId,
        )
        return storeLocalVersion(invoice, versionId, blob, format, author, 'synced', localPath, metadata)
    }

    if (!isOnline()) {
        return storeLocalVersion(invoice, versionId, blob, format, author, 'pending', null, metadata)
    }

    const versionPath = getInvoiceVersionR2Path(invoice.workspaceId, origin, sourceId, format, versionId)
    const uploadedVersionPath = await assetManager.uploadInvoicePdf(invoice.id, blob, format, versionPath)
    if (!uploadedVersionPath) throw new Error('Failed to upload immutable invoice version')

    let version: InvoiceVersion
    try {
        await ensureRemoteInvoiceParent(invoice, author)
        version = await createRemoteVersion(invoice, versionId, format, versionPath, blob.size, author, metadata)
    } catch (error) {
        await import('./r2Service').then(({ r2Service }) => r2Service.delete(versionPath)).catch(() => undefined)
        throw error
    }

    await db.invoice_versions.put(version)
    await updateLocalLatest(invoice, version)

    // QR codes use this stable alias. The immutable version object above is never overwritten.
    const aliasPath = getInvoiceLatestAliasR2Path(invoice.workspaceId, sourceId, format)
    await assetManager.uploadInvoicePdf(invoice.id, blob, format, aliasPath).catch((error) => {
        console.warn('[InvoiceVersion] Failed to refresh latest PDF alias:', error)
    })

    return version
}

export async function loadInvoiceVersions(invoiceId: string, workspaceId: string) {
    if (!isLocalWorkspaceMode(workspaceId) && isOnline()) {
        const { data, error } = await supabase
            .from('invoice_versions')
            .select('*')
            .eq('workspace_id', workspaceId)
            .eq('invoice_id', invoiceId)
            .order('version_number', { ascending: false })

        if (error) throw error
        const remoteVersions = (data || []).map((row) => mapRemoteVersion(row as Record<string, unknown>))
        if (remoteVersions.length > 0) await db.invoice_versions.bulkPut(remoteVersions)
    }

    const versions = await db.invoice_versions.where('invoiceId').equals(invoiceId).toArray()
    return versions.sort((a, b) => b.versionNumber - a.versionNumber)
}

export async function syncPendingInvoiceVersions(workspaceId: string) {
    if (!isOnline() || isLocalWorkspaceMode(workspaceId)) return

    const pending = await db.invoice_versions
        .where('workspaceId')
        .equals(workspaceId)
        .filter((version) => version.syncStatus === 'pending' && !!version.pdfBlob)
        .sortBy('createdAt')

    for (const pendingVersion of pending) {
        const invoice = await db.invoices.get(pendingVersion.invoiceId)
        if (!invoice || !pendingVersion.pdfBlob) continue

        const versionPath = getInvoiceVersionR2Path(
            workspaceId,
            pendingVersion.origin,
            pendingVersion.sourceId,
            pendingVersion.format,
            pendingVersion.id,
        )
        const uploadedVersionPath = await assetManager.uploadInvoicePdf(invoice.id, pendingVersion.pdfBlob, pendingVersion.format, versionPath)
        if (!uploadedVersionPath) throw new Error('Failed to upload pending immutable invoice version')

        const author = { id: pendingVersion.createdBy, name: pendingVersion.createdByName }
        await ensureRemoteInvoiceParent(invoice, author)
        const remoteVersion = await createRemoteVersion(
            invoice,
            pendingVersion.id,
            pendingVersion.format,
            versionPath,
            pendingVersion.fileSize,
            author,
            pendingVersion.metadata,
        )
        await db.invoice_versions.put(remoteVersion)
        await updateLocalLatest(invoice, remoteVersion)

        const aliasPath = getInvoiceLatestAliasR2Path(
            workspaceId,
            pendingVersion.sourceId,
            pendingVersion.format,
        )
        await assetManager.uploadInvoicePdf(invoice.id, pendingVersion.pdfBlob, pendingVersion.format, aliasPath).catch(() => undefined)
    }
}
