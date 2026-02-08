# PLAN: Invoice PDF Storage Migration

Migrate invoice storage from Supabase JSONB columns to Cloudflare R2 PDFs.

---

## Overview

**Current State:** Invoices stored in Supabase with `items`, `subtotal`, `discount`, `currency`, `print_metadata` JSONB columns. Re-rendered on view.

**Target State:** Invoices stored as PDFs in Cloudflare R2. Supabase holds minimal metadata. View/Download fetches PDF from R2.

**R2 Path Structure:**
```
{workspaceId}/printed-invoices/A4/{invoiceId}.pdf
{workspaceId}/printed-invoices/receipts/{invoiceId}.pdf
```

---

## Phase 1: Dependencies & PDF Generation Service

### 1.1 Install Dependencies
- `@react-pdf/renderer` - React-native PDF generation (no canvas/screenshot needed)
- `@pdf-viewer/react` - In-app PDF viewer component for Invoice History

### 1.2 Create PDF Templates
- `src/ui/components/pdf/A4InvoicePDF.tsx` - PDF version of A4 template using `@react-pdf/renderer`
- `src/ui/components/pdf/ReceiptPDF.tsx` - PDF version of receipt template

### 1.3 Create `src/services/pdfGenerator.ts`
- `generateInvoicePdf(data: UniversalInvoice, format: 'a4' | 'receipt'): Promise<Blob>`
- Uses `@react-pdf/renderer`'s `pdf()` function to generate PDF blob directly
- Returns a Blob for local storage and R2 upload

---

## Phase 2: Local Storage Layer (Offline Support)

### 2.1 Update Dexie Schema (`src/local-db/index.ts`)
- Remove `items`, `subtotal`, `discount`, `currency`, `printMetadata` from `invoices` table
- Add `pdfBlobA4?: Blob`, `pdfBlobReceipt?: Blob` (temporary local storage)
- Add `r2PathA4?: string`, `r2PathReceipt?: string`
- Add `syncStatus: 'pending' | 'synced'`

### 2.2 Local Invoice Model
```typescript
interface LocalInvoice {
  id: string
  workspaceId: string
  sequenceId?: number
  invoiceid: string
  totalAmount: number
  settlementCurrency: string
  createdAt: string
  origin: string
  printFormat: 'a4' | 'receipt'
  r2PathA4?: string
  r2PathReceipt?: string
  pdfBlobA4?: Blob // Pending upload
  pdfBlobReceipt?: Blob // Pending upload
  syncStatus: 'pending' | 'synced'
}
```

---

## Phase 3: Supabase Schema Migration

### 3.1 Create Migration Script
```sql
ALTER TABLE invoices
  DROP COLUMN IF EXISTS items,
  DROP COLUMN IF EXISTS subtotal,
  DROP COLUMN IF EXISTS discount,
  DROP COLUMN IF EXISTS currency,
  DROP COLUMN IF EXISTS print_metadata,
  ADD COLUMN IF NOT EXISTS r2_path_a4 TEXT,
  ADD COLUMN IF NOT EXISTS r2_path_receipt TEXT,
  ADD COLUMN IF NOT EXISTS print_format TEXT DEFAULT 'a4';
```

### 3.2 Minimal Supabase Invoice Structure
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| workspace_id | UUID | FK |
| sequence_id | INT | Display ID |
| total_amount | NUMERIC | Final total |
| settlement_currency | TEXT | e.g., 'iqd' |
| created_at | TIMESTAMP | |
| origin | TEXT | 'pos' |
| print_format | TEXT | 'a4' or 'receipt' |
| r2_path_a4 | TEXT | R2 key for A4 PDF |
| r2_path_receipt | TEXT | R2 key for Receipt PDF |

---

## Phase 4: POS Checkout Integration

### 4.1 Modify `handleCheckout` in `POS.tsx`
1. After successful sale → Open print preview modal (as now)
2. On "Print & Save" button click:
   - Generate PDF from the rendered template using `pdfGenerator`
   - Save PDF blob to local Dexie `invoices` table
   - If online: Upload to R2 immediately, save `r2_path` to Supabase
   - If offline: Mark `syncStatus: 'pending'`

### 4.2 Modify `CheckoutSuccessModal.tsx`
- Add "Print & Save A4" and "Print & Save Receipt" buttons
- Each triggers PDF generation + save flow

---

## Phase 5: R2 Upload Integration

### 5.1 Extend `AssetManager` or `r2Service`
- Add `uploadInvoicePdf(workspaceId: string, invoiceId: string, format: 'A4' | 'receipts', blob: Blob): Promise<string>`
- Returns the R2 path/URL

### 5.2 Sync Pending Invoices
- On app startup (when online), check for `syncStatus: 'pending'`
- Upload blobs to R2
- Update Supabase with `r2_path`
- Clear local blob, set `syncStatus: 'synced'`

---

## Phase 6: Invoice History Page Refactor

### 6.1 Update `InvoicesHistory.tsx`
- Fetch invoices from Supabase (minimal fields)
- Display list with: ID, Date, Total, Origin, Actions
- Actions: "View A4" / "View Receipt" buttons (conditional on `r2_path_*`)

### 6.2 PDF Viewer Modal
- Create `PDFViewerModal.tsx` using `@pdf-viewer/react`
- On click: Fetch PDF URL from R2 (via `assetManager.getAssetUrl`)
- Display in modal with zoom/print controls

### 6.3 Require Online for Viewing
- Check `navigator.onLine` before fetching
- Show toast/error if offline

---

## Phase 7: Cleanup

### 7.1 Remove Deprecated Code
- Remove `mapInvoiceToUniversal` from `mappings.ts`
- Remove `items` mapping logic from invoice-related components
- Remove local invoice metadata storage

### 7.2 Update Types
- Simplify `Invoice` type in `types.ts`
- Remove `printMetadata`, `items` from type definitions

---

## Task Breakdown

| # | Task | Agent | Files |
|---|------|-------|-------|
| 1 | Install jspdf, html2canvas | - | package.json |
| 2 | Create pdfGenerator.ts | Backend | src/services/pdfGenerator.ts |
| 3 | Update Dexie schema | Backend | src/local-db/index.ts, models.ts |
| 4 | Create Supabase migration | Backend | supabase/migrations/ |
| 5 | Add R2 upload for invoices | Backend | src/lib/r2Service.ts |
| 6 | Modify POS checkout flow | Frontend | POS.tsx, CheckoutSuccessModal.tsx |
| 7 | Add pending sync logic | Backend | src/lib/assetManager.ts |
| 8 | Refactor InvoicesHistory | Frontend | InvoicesHistory.tsx |
| 9 | Cleanup deprecated code | Frontend | mappings.ts, types.ts |

---

## Verification Checklist

- [ ] POS: Complete sale → Print A4 → PDF saved locally
- [ ] POS: Complete sale (offline) → PDF saved locally with pending status
- [ ] Online: Pending PDFs upload to R2 on reconnect
- [ ] Invoice History: List displays from Supabase
- [ ] Invoice History: "View A4" opens PDF from R2
- [ ] Invoice History: Offline shows error message
- [ ] Supabase: No JSONB columns in invoices table
- [ ] Local DB: No items/metadata in Dexie invoices
