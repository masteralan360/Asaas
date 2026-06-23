import { db, saveInvoiceFromSnapshot } from '@/local-db'
import { generateInvoicePdf } from './pdfGenerator'
import { disableInvoiceQrInLocalMode } from './localInvoiceStorage'
import { persistInvoiceVersion } from './invoiceVersionService'
import { toast } from '@/ui/components/use-toast'

interface SyncInvoiceOptions {
    saleData: any
    features: any
    workspaceName: string
    workspaceId: string // Required for RLS Workspace Isolation
    user: {
        id: string
        name: string
    }
    format?: 'a4' | 'receipt'
    pdfBuilder?: () => Promise<Blob>
}

/**
 * Handles the background synchronization of an invoice:
 * 1. Generates Receipt PDF
 * 2. Links the invoice to the originating sale UUID
 * 3. Persists an immutable PDF version (R2 or local storage)
 */
export async function triggerInvoiceSync(options: SyncInvoiceOptions): Promise<void> {
    const { saleData, features, workspaceName, user } = options;
    const invoiceId = saleData.id;
    const printableFeatures = disableInvoiceQrInLocalMode(options.workspaceId, features);

    if (!invoiceId) {
        console.error('[InvoiceSyncService] No ID provided for sync');
        return;
    }

    // Immediate feedback toast (brief)
    toast({
        title: "Processing receipt...",
        description: `Finalizing record for #${saleData.invoiceid || invoiceId.slice(0, 8)}`,
    });

    try {
        const format = options.format || 'receipt';
        const now = new Date().toISOString()

        // 1. Generate PDF for the specific format
        const pdfBlob = options.pdfBuilder
            ? await options.pdfBuilder()
            : await generateInvoicePdf({
                data: saleData,
                format: format,
                features: printableFeatures,
                workspaceName: workspaceName || 'Atlas',
                workspaceId: options.workspaceId
            });

        const invoice = await saveInvoiceFromSnapshot(options.workspaceId, {
            sourceId: invoiceId,
            invoiceid: saleData.invoiceid || `#${invoiceId.slice(0, 8)}`,
            sequenceId: saleData.sequenceId ?? saleData.sequence_id,
            customerId: saleData.customer_id || undefined,
            status: 'paid',
            totalAmount: saleData.total_amount ?? saleData.totalAmount ?? 0,
            settlementCurrency: saleData.settlement_currency ?? saleData.settlementCurrency ?? printableFeatures.default_currency ?? 'usd',
            origin: saleData.origin || 'pos',
            createdBy: user.id,
            cashierName: saleData.cashier_name || user.name,
            createdByName: saleData.created_by_name || user.name,
            printFormat: format,
            ...(format === 'a4' ? { pdfBlobA4: pdfBlob } : { pdfBlobReceipt: pdfBlob }),
        }, invoiceId)

        const confirmedInvoice = await db.invoices.get(invoice.id) || invoice
        const version = await persistInvoiceVersion({
            invoice: confirmedInvoice,
            blob: pdfBlob,
            format,
            author: user,
            metadata: { module: 'pos', automatic: true, generatedAt: now },
        })

        // Success Toast
        toast({
            title: "Receipt saved",
            description: `Saved version ${version.versionNumber} for #${saleData.invoiceid || invoiceId.slice(0, 8)}`,
            variant: "default",
        });

    } catch (error: any) {
        console.error('[InvoiceSyncService] Background sync failed:', error);

        // Update local status to failed/pending for retry
        await db.invoices.update(invoiceId, {
            syncStatus: 'pending',
            lastSyncedAt: null
        });

        toast({
            title: "Sync Delayed",
            description: "Invoice saved locally. It will sync when connection improves.",
            variant: "destructive",
        });
    }
}
