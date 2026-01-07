# Synchronization Engine

The Sync Engine is the heart of the ERP System's offline-first capability. it ensures that local data is eventually consistent with the remote Supabase database.

## 🔄 Synchronization Flow

The engine operates in two main phases: **Push** and **Pull**.

### 1. Push Phase (`pushChanges`)
- **Queueing**: Mutations (create, update, delete) are logged in the `sync_queue` table in Dexie.
- **Processing**: The engine iterates through pending items.
- **Transformation**: Local camelCase objects are converted to snake_case for Supabase compatibility.
- **Execution**: 
    - `create`/`update`: Performed via Supabase `upsert` with an `onConflict: 'id'` constraint.
    - `delete`: Performed via a "Soft Delete" (updating an `is_deleted` flag to `true`).
- **Confirmation**: On success, the item is removed from the queue and the local record's `syncStatus` is updated to `synced`.

### 2. Pull Phase (`pullChanges`)
- **Incremental Fetching**: The engine requests records from Supabase where `updated_at > lastSyncTime`.
- **Transformation**: Remote snake_case objects are converted back to camelCase.
- **Reconciliation**:
    - If a record doesn't exist locally, it is added.
    - If it exists, the engine compares the `version` field. **The higher version wins**.
- **Storage**: Updates are saved to Dexie, triggering UI updates via reactive hooks.

## ⏱ Conflict Resolution & Versioning

- **Version Control**: Every record has a `version` integer (incremented on every local edit).
- **Last Write Wins**: The system uses chronological and version-based reconciliation to resolve conflicts between devices.
- **Retries**: If a push fails (e.g., due to network issues), the `retryCount` is incremented. Items are skipped after 5 unsuccessful attempts to prevent blocking the queue.

## 🚀 Performance Optimizations

- **Batching**: The engine pulls changes for all core entities (Products, Customers, Orders, Invoices) in a single sync cycle.
- **Timeouts**: Robust timeout handling (15-30s) prevents the sync process from hanging on poor connections.
- **Background Sync**: Triggered by the `useSyncStatus` hook at strategic intervals.

---
*Next: See [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) for data structures.*
