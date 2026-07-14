# API Reference

## Current Shape

The app now uses three access patterns:

1. Direct table reads and writes for normal workspace-scoped CRUD, protected by RLS
2. Supabase Edge Functions for privileged auth/admin/member operations
3. A small SQL RPC layer for atomic sales and returns

## Edge Functions

Location: `supabase/functions/`

### `workspace-access`

Called with `supabase.functions.invoke('workspace-access', { body })`.

Supported actions:

- `create`
  - body: `{ action: 'create', workspaceName, passkey }`
  - use: pre-signup workspace bootstrap for admin registration
  - returns: `{ id, name, code }`
- `join`
  - body: `{ action: 'join', workspaceCode }`
  - use: assign the authenticated user to a workspace and sync auth metadata
  - returns: `{ workspace_id, workspace_code, workspace_name, data_mode }`
- `kick`
  - body: `{ action: 'kick', targetUserId }`
  - use: remove a member from the caller's workspace and clear their auth metadata
  - returns: `{ success, message }`

### `admin-console`

Called with `supabase.functions.invoke('admin-console', { body })`.

Supported actions:

- `verify`
  - body: `{ action: 'verify', passkey }`
  - returns: `{ valid, user_id }`
- `listUsers`
  - body: `{ action: 'listUsers', passkey }`
  - returns: admin user rows joined with profile/workspace context
- `listWorkspaces`
  - body: `{ action: 'listWorkspaces', passkey }`
  - returns: workspace rows for the admin dashboard
- `deleteUser`
  - body: `{ action: 'deleteUser', passkey, targetUserId }`
- `updateWorkspaceFeatures`
  - body: `{ action: 'updateWorkspaceFeatures', passkey, workspaceId, pos, crm, invoices_history, locked_workspace }`
- `updateWorkspaceSubscription`
  - body: `{ action: 'updateWorkspaceSubscription', passkey, workspaceId, newExpiry }`
  - for a workspace with saved usage limits, `newExpiry` sets the recurring usage-cycle reset day instead of expiring access; source workspaces and branches share that cycle
- `listWorkspaceUsage`
  - body: `{ action: 'listWorkspaceUsage', passkey }`
  - returns: current usage counters only for source usage owners with saved usage limits; branches share the source workspace usage row
  - transfer fields are bigint-safe numeric strings: `actual_data_transfer_bytes` is measured network/file payload, while `charged_usage_bytes` is plan consumption after the multiplier reported by `transfer_charge_multiplier`
  - for old admin clients, deprecated response `data_transfer_bytes` preserves its historical actual-transfer meaning and aliases `actual_data_transfer_bytes`; this differs intentionally from the same-named internal database column, which stores charged usage
  - `monthly_data_transfer_limit_bytes` is a deprecated response alias for `monthly_charged_usage_limit_bytes`
- `updateWorkspaceUsage`
  - body: `{ action: 'updateWorkspaceUsage', passkey, workspaceId, storageUnits, actualTransferBytes, chargedUsageBytes, transferPeriodStart, storageUnitLimit, monthlyChargedUsageLimitBytes, notes }`
  - all counter and limit values accept non-negative integers or bigint-safe decimal strings; response/list values remain strings to avoid JavaScript precision loss
  - `actualTransferBytes` is real measured transfer; `chargedUsageBytes` and `monthlyChargedUsageLimitBytes` are byte-equivalent plan usage and allowance after weighting
  - actual and charged counters must preserve the fixed relationship `charged = actual × 10`; either counter may be supplied alone and the other is derived (a charged-only value must be divisible by 10), while mismatched pairs are rejected
  - deprecated compatibility: `dataTransferBytes` keeps its historical actual-transfer meaning and aliases `actualTransferBytes`; `monthlyDataTransferLimitBytes` aliases the charged allowance; new clients should use the unambiguous preferred fields
  - if a preferred field and its deprecated alias are both supplied, their normalized values must match
  - `transferPeriodStart` is displayed for compatibility, but the server owns the effective period: usage-limited workspaces reset on the UTC day-of-month of `subscription_expires_at` (falling back to calendar-month cycles when no reset date is set)
  - use: adjust current workspace usage counters and upsert/delete optional limits; branch workspace ids resolve to their source workspace; reaching the monthly charged-usage limit locks the workspace family, while reaching the storage unit limit does not
- `refreshWorkspaceUsage`
  - body: `{ action: 'refreshWorkspaceUsage', passkey, workspaceId? }`
  - use: recalculate counted workspace storage units from configured parent/business tables; branch rows are aggregated into the source workspace usage row

### Workspace usage accounting boundary

- clients and storage services report raw actual payload bytes; only the database converts them to charged usage, currently at `actual × 10`
- `workspace_usage_limits` remains admin-managed: the weighted-usage migration remaps exact recognized standard limits, but does not infer one of the seven pricing tiers from the separate feature-plan field on new workspaces
- the authenticated client reporters make these counters suitable for product quota enforcement and estimates, not an independent invoice-grade transfer ledger; monetary billing would require measurement at a trusted server/proxy boundary

## Kept SQL RPCs

These still run through `supabase.rpc()` because they are transactional or intentionally narrow database helpers.

### `lookup_workspace_by_code`

- use: pre-auth workspace lookup during signup
- returns: `{ id, name, code }`

### `complete_sale`

- use: atomic sale creation plus inventory deduction

### `process_sale_return`

- use: idempotent partial or full returns with append-only audit records and inventory restoration
- inputs: client-generated return ID, sale ID, return line JSON, reason, and optional refund method

### `return_sale_items`

- use: compatibility wrapper over `process_sale_return`

### `return_whole_sale`

- use: admin-only compatibility wrapper over `process_sale_return`

## Direct Table Operations

Direct table access is the default for simple workspace-scoped CRUD. The current app uses direct reads and writes for:

- `workspaces`
- `profiles`
- `workspace_contacts`
- `products`
- `categories`
- `storages`
- `inventory`
- `loans`
- `loan_installments`
- `loan_payments`

This assumes the RLS migrations in `supabase/migrations/20260328_secure_public_rls_and_workspace_lookup.sql` and `supabase/migrations/20260328_finish_rpc_rationalization.sql` are applied.
