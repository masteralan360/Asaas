# Plan - Invoice Template Reuse

Refactor the invoice printing and viewing system to use the same production templates (A4/Receipt) for both live sales and historical snapshots by leveraging a common data interface.

## User Review Required

> [!IMPORTANT]
> - Should the **View** action in Invoices History open the A4 template by default, even if it was originally printed as a receipt?
> - Do we want to allow switching between A4 and Thermal Receipt views for historical records?

## Proposed Changes

### Core & Interfaces

#### [MODIFY] [types/index.ts](file:///e:/ERP%20System/Asaas/src/types/index.ts) (or a common location)
-   Define `PrintableInvoice` interface:
    -   `invoiceNumber: string`
    -   `createdAt: string`
    -   `customerName: string`
    -   `cashierName: string`
    -   `items: Array<{ name, quantity, price, total, sku, ... }>`
    -   `subtotal: number`
    -   `tax: number`
    -   `discount: number`
    -   `total: number`
    -   `currency: string`

### Components

#### [MODIFY] [A4InvoiceTemplate.tsx](file:///e:/ERP%20System/Asaas/src/ui/components/A4InvoiceTemplate.tsx)
-   Change props from `sale: Sale` to `data: PrintableInvoice`.
-   Update internal logic to map fields from the generic interface.

#### [MODIFY] [PrintPreviewModal.tsx](file:///e:/ERP%20System/Asaas/src/ui/components/PrintPreviewModal.tsx)
-   Update to pass the mapped `PrintableInvoice` to the template.
-   Add logic to bridge `Sale` -> `PrintableInvoice` and `Invoice` -> `PrintableInvoice`.

#### [DELETE] [InvoiceDetailsModal.tsx](file:///e:/ERP%20System/Asaas/src/ui/components/InvoiceDetailsModal.tsx)
-   Replace this with a modal that simply wraps the `A4InvoiceTemplate` or reuse `PrintPreviewModal`.

### Pages

#### [MODIFY] [InvoicesHistory.tsx](file:///e:/ERP%20System/Asaas/src/ui/pages/InvoicesHistory.tsx)
-   Update the "View" action to open the standard `PrintPreviewModal` with the historical snapshot data.

## Verification Plan

### Automated Tests
-   Verify build and type checking for the new `PrintableInvoice` interface.

### Manual Verification
-   Print a sale as A4 → Verify it looks correct.
-   View the same sale in Invoices History → Verify it looks exactly identical to the original print.
