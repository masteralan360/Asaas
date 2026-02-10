# Project Plan: Invoice QR & R2 Path Refinements

## Problem Statement
1. **A4 QR Code Missing**: The QR code on A4 invoices renders as an empty square in the preview.
2. **Path Inconsistency**: The R2 upload path should be designated during the print/save process to ensure total consistency and predictability for QR links.

## Proposed Solution

### 1. A4 QR Component Refinement
- **Diagnosis**: The `ReactQRCode` in `A4InvoiceTemplate` likely has incompatible props or is being gated too strictly.
- **Action**: 
  - Standardize `ReactQRCode` props across all templates.
  - Remove experimental styling props (`dataModulesSettings`) which may be causing render failures.

### 2. Designated R2 Naming Flow
- **Flow**:
  1. `PrintPreviewModal` generates a standard path: `${workspaceId}/printed-invoices/${format}/${filename}.pdf`.
  2. The `filename` is determined *before* upload (using a combination of `invoiceid` and `timestamp` or `UUID`).
  3. This path is used to generate the QR code *inside* the template.
  4. The same path is passed to `assetManager.uploadInvoicePdf`.

## Task Breakdown

### Phase 1: Logic Synchronization
- [ ] Create a helper to generate predictable R2 paths for invoices.
- [ ] Update `assetManager.ts` to allow passing this pre-determined path.

### Phase 2: Template Fixes (Focus on A4)
- [ ] Simplify `A4InvoiceTemplate` QR rendering.
- [ ] Align header layout to prevent content collapse.

### Phase 3: Modal Integration
- [ ] Update `PrintPreviewModal` to calculate paths at the start of the `handlePrintAndSave` flow.

## Verification Checklist
- [ ] QR code visible in A4 preview.
- [ ] Scan QR from printed PDF -> Redirects to correct R2 Proxy URL.
- [ ] Database `r2Path` matches the uploaded file exactly.
