# PLAN: Global Date Format Update (d/m/y)

Change all date displays across the UI from `m/d/y` (US format) to `d/m/y` (International format) for better consistency and user preference.

## Proposed Changes

### 1. Centralize and Update Utilities
#### [MODIFY] [utils.ts](file:///e:/ERP%20System/Asaas/src/lib/utils.ts)
- Update `formatDate` and `formatDateTime` to use `en-GB` locale to enforce `DD/MM/YYYY`.

### 2. Refactor UI Components
- Replace direct `toLocaleDateString()` and `Intl.DateTimeFormat` calls with `formatDate` or `formatDateTime` from `@/lib/utils`.

#### [MODIFY] [Admin.tsx](file:///e:/ERP%20System/Asaas/src/ui/pages/Admin.tsx)
- Use `formatDate(user.created_at)`.

#### [MODIFY] [TeamPerformance.tsx](file:///e:/ERP%20System/Asaas/src/ui/pages/TeamPerformance.tsx)
- Standardize all date displays.

## Verification Plan
1. Audit Revenue page lists and modals.
2. Audit Invoices History page.
3. Audit Admin Dashboard user list.
4. Verify dates appear as `DD/MM/YYYY` (e.g., 02/02/2026).
