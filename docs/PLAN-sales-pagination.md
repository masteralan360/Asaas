# PLAN: Sales History Pagination

Implement server-side pagination for the Sales History page using Shadcn UI design patterns and Supabase range queries.

## Proposed Changes

### [NEW] Reusable Pagination Component (`src/ui/components/AppPagination.tsx`)
1.  **Generic Interface**: Props like `currentPage`, `totalCount`, `pageSize`, and `onPageChange`.
2.  **Implementation**: Wraps the Shadcn UI `Pagination` primitives to provide a higher-level API for other pages.
3.  **Design**: Responsive navigation with "Previous", "Next", page numbers, and ellipsis.

### [NEW] Pagination Primitives (`src/ui/components/ui/pagination.tsx`)
1.  **Shadcn/Radix Base**: Implement the core pagination UI components as per Shadcn requirements.

### [MODIFY] Sales History Page (`src/ui/pages/Sales.tsx`)
1.  **State Management**:
    - `currentPage` (default 1)
    - `pageSize` (fixed at 20)
    - `totalCount` (retrieved from Supabase)
2.  **Data Fetching**:
    - Update `fetchSales` to use `.range((page - 1) * size, page * size - 1)`.
    - Fetch total count using `{ count: 'exact' }`.
    - Reset `currentPage` to 1 whenever filters change.
3.  **UI Integration**:
    - Place `AppPagination` in the "Recent Sales" card header (indicated purple area).
    - Handle loading states during page transitions.

## Verification Plan

### Manual Verification
1.  **Basic Navigation**: Click Next/Prev and verify items change.
2.  **Filter Reset**: Change a date filter (e.g., from "This Month" to "Today") and verify `currentPage` resets to 1.
3.  **Loading State**: Verify the loader appears during page transitions.
4.  **Edge Cases**:
    - Verify behavior on the last page.
    - Verify empty state if no data for a page.

## Phase Breakdown
1.  **Phase 1**: UI Skeleton & State setup.
2.  **Phase 2**: Supabase Fetching Logic (Range/Count).
3.  **Phase 3**: Integration and Styling.
