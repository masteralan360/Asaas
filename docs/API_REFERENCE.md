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
  - `charged_usage_bytes` is the one bigint-safe numeric string representing persisted plan consumption. Request payload bytes and the selected request rate are intentionally not stored as separate usage counters
  - `monthly_data_transfer_limit_bytes` is a deprecated response alias for `monthly_charged_usage_limit_bytes`
- `updateWorkspaceUsage`
  - body: `{ action: 'updateWorkspaceUsage', passkey, workspaceId, storageUnits, chargedUsageBytes, transferPeriodStart, storageUnitLimit, monthlyChargedUsageLimitBytes, notes }`
  - all counter and limit values accept non-negative integers or bigint-safe decimal strings; response/list values remain strings to avoid JavaScript precision loss
  - `chargedUsageBytes` is the only persisted usage value. The request path meters measured bytes transiently and applies its rate before incrementing this counter
  - deprecated compatibility: `dataTransferBytes` aliases the charged usage value; `monthlyDataTransferLimitBytes` aliases the charged allowance; new clients should use the unambiguous preferred fields
  - if a preferred field and its deprecated alias are both supplied, their normalized values must match
  - `transferPeriodStart` is displayed for compatibility, but the server owns the effective period: usage-limited workspaces reset on the UTC day-of-month of `subscription_expires_at` (falling back to calendar-month cycles when no reset date is set)
  - use: adjust current workspace usage counters and upsert/delete optional limits; branch workspace ids resolve to their source workspace; reaching the monthly charged-usage limit locks the workspace family, while reaching the storage unit limit does not
- `refreshWorkspaceUsage`
  - body: `{ action: 'refreshWorkspaceUsage', passkey, workspaceId? }`
  - use: recalculate counted workspace storage units from configured parent/business tables; branch rows are aggregated into the source workspace usage row

### Workspace usage accounting boundary

- the trusted request boundary measures payload bytes, chooses the applicable rate (currently Tauri `10×` and Web Live `20×`), then atomically increments one charged-usage counter
- raw request bytes, source, and channel are transient; the only durable request-audit data is an idempotency key and charged delta
- `workspace_usage_limits` remains admin-managed; its transfer limit is compared with the single charged-usage counter
- direct client reporters are suitable for quota enforcement and estimates. Invoice-grade transfer billing requires every relevant request to pass through a trusted gateway

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
