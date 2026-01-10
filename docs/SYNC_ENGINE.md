# Sync Engine Technical Reference

The Sync Engine is responsible for synchronizing local Dexie (IndexedDB) data with the Supabase remote database. It implements an offline-first strategy where all operations are performed locally first and then queued for synchronization.

## 🗄 Storage Architecture

### Offline Mutations Table (`offline_mutations`)
All local changes (create, update, delete) are logged as "mutations" in the `offline_mutations` table.
- **`status`**: `pending` | `syncing` | `synced` | `failed`
- **`operation`**: `create` | `update` | `delete`
- **`payload`**: The data object (converted to snake_case for Supabase).

### Entity-Level Sync Metadata
Every synchronized record contains metadata to manage state:
- **`syncStatus`**: `pending` | `synced` | `conflict`
- **`lastSyncedAt`**: ISO timestamp of the last successful sync.
- **`version`**: Integer incremented on local changes for conflict resolution.

## 🔄 Synchronization Phases

### 1. Push Phase (`processMutationQueue`)
Iterates through all `pending` mutations in chronological order:
1. **Conversion**: Payloads are converted from camelCase to snake_case.
2. **Special Handling**: 
   - `sales`: Calls the `complete_sale` RPC function.
   - `workspaces`: Directly updates the `workspaces` table (ignoring usual workspace_id filters).
   - Others: Uses standard Supabase `upsert` or `update` (for soft deletes).
3. **Soft Delete**: `delete` operations update the `is_deleted` flag instead of removing the record.
4. **Conclusion**: On success, the mutation is marked `synced` and the local record's metadata is updated.

### 2. Pull Phase (`pullChanges`)
Fetches data from Supabase updated since the last sync:
1. **Incremental Sync**: Uses `updated_at > lastSyncTime` to fetch only new changes.
2. **Reconciliation**:
   - Uses **Last Write Wins (LWW)** based on the `version` field.
   - If the server version is higher, the local record is overwritten.
   - Local pending changes are protected because the mutation intentionalITY is stored in the `offline_mutations` table.

## 🛠 Core Functions

- **`fullSync(userId, workspaceId, lastSyncTime)`**: The main entry point. Executes `processMutationQueue` followed by `pullChanges`.
- **`withTimeout(promise, ms)`**: A wrapper to ensure sync operations don't hang indefinitely (default 30s).
- **`toSnakeCase` / `toCamelCase`**: Utility functions for mapping local JS objects to DB-friendly structures.

## 🚦 Conflict Resolution
Conflicts are resolved using a versioning system. Every record has a `version` number. When pulling, if `remote.version > local.version`, the local record is updated. If local changes are pending, they will be re-applied during the next push, effectively reconciling the state.
