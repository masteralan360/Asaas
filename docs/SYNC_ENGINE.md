# Sync Engine

## Overview

The Asaas sync engine enables **offline-first operation** by:

1. Writing all changes to IndexedDB immediately
2. Queueing changes as offline mutations
3. Pushing mutations to Supabase when online
4. Pulling remote changes to stay synchronized

Location: `src/sync/`

---

## Sync States

```typescript
type SyncStatus = 'pending' | 'synced' | 'conflict'
```

| State | Description |
|-------|-------------|
| `pending` | Local changes not yet pushed to cloud |
| `synced` | Data matches cloud version |
| `conflict` | Local and cloud versions diverge (rare) |

---

## Offline Mutation Queue

Location: `src/local-db/hooks.ts` → `addToOfflineMutations()`

### How Mutations Are Created

Every create/update/delete operation creates a mutation record:

```typescript
const mutation: OfflineMutation = {
  id: uuid(),
  workspaceId: currentWorkspaceId,
  entityType: 'products',
  entityId: productId,
  operation: 'create',
  payload: { ...productData },
  createdAt: new Date().toISOString(),
  status: 'pending',
}

await db.offlineMutations.add(mutation)
```

### Mutation Status Flow

```
pending → syncing → synced
              ↓
           failed (with error message)
```

---

## Push Changes

Location: `src/sync/syncEngine.ts` → `processMutationQueue()`

### Algorithm

```typescript
async function processMutationQueue(userId: string) {
  // 1. Get pending mutations ordered by timestamp
  const mutations = await db.offlineMutations
    .where('status').equals('pending')
    .sortBy('createdAt')
  
  for (const mutation of mutations) {
    // 2. Mark as syncing
    await db.offlineMutations.update(mutation.id, { status: 'syncing' })
    
    // 3. Execute against Supabase
    const tableName = getTableName(mutation.entityType)
    const payload = toSnakeCase(mutation.payload)
    
    if (mutation.operation === 'delete') {
      await supabase.from(tableName)
        .update({ is_deleted: true })
        .eq('id', mutation.entityId)
    } else {
      await supabase.from(tableName).upsert(payload)
    }
    
    // 4. Mark as synced
    await db.offlineMutations.update(mutation.id, { status: 'synced' })
  }
}
```

### Error Handling

- Failed mutations remain in queue with `status: 'failed'`
- Error message stored for debugging
- Automatic retry on next sync attempt

---

## Pull Changes

Location: `src/sync/syncEngine.ts` → `pullChanges()`

### Algorithm

```typescript
async function pullChanges(workspaceId: string, lastSyncTime: string | null) {
  const tables = ['products', 'categories', 'sales', 'invoices']
  
  for (const table of tables) {
    // 1. Fetch records updated since last sync
    let query = supabase.from(table)
      .select('*')
      .eq('workspace_id', workspaceId)
    
    if (lastSyncTime) {
      query = query.gt('updated_at', lastSyncTime)
    }
    
    const { data } = await query
    
    // 2. Upsert into local database
    for (const record of data) {
      const camelRecord = toCamelCase(record)
      camelRecord.syncStatus = 'synced'
      camelRecord.lastSyncedAt = new Date().toISOString()
      
      await db[table].put(camelRecord)
    }
  }
}
```

---

## Full Sync

Location: `src/sync/syncEngine.ts` → `fullSync()`

```typescript
async function fullSync(userId, workspaceId, lastSyncTime): Promise<SyncResult> {
  // 1. Push local changes
  const pushResult = await processMutationQueue(userId)
  
  // 2. Pull remote changes
  const pullResult = await pullChanges(workspaceId, lastSyncTime)
  
  return {
    success: pushResult.failed === 0,
    pushed: pushResult.success,
    pulled: pullResult.pulled,
    errors: []
  }
}
```

---

## Conflict Resolution

### Strategy: Last Write Wins

When a conflict is detected (same record updated locally and remotely):

1. Compare `version` numbers
2. Higher version wins
3. If versions equal, use `updated_at` timestamp

### Prevention

- Each update increments local `version`
- Server triggers also increment version
- UI shows sync status indicator

---

## Sync UI Components

### SyncStatusIndicator

Location: `src/ui/components/SyncStatusIndicator.tsx`

Shows real-time sync status:
- 🟢 Green: All synced
- 🟡 Yellow: Pending changes
- 🔴 Red: Sync errors
- ⏳ Animated: Syncing in progress

### ManualSyncModal

Location: `src/ui/components/ManualSyncModal.tsx`

Allows users to:
- Force immediate sync
- View pending mutation count
- See last sync timestamp

---

## Hooks for Sync State

Location: `src/sync/useSyncStatus.ts`

```typescript
function useSyncStatus() {
  return {
    isSyncing: boolean,
    pendingCount: number,
    lastSyncTime: string | null,
    triggerSync: () => Promise<void>
  }
}
```

### Online Status Detection

Location: `src/sync/useOnlineStatus.ts`

```typescript
function useOnlineStatus() {
  // Uses Navigator.onLine + event listeners
  return { isOnline: boolean }
}
```

---

## Case Conversion

Supabase uses `snake_case`, TypeScript uses `camelCase`.

### toSnakeCase()

```typescript
{ createdAt: '...', workspaceId: '...' }
→ { created_at: '...', workspace_id: '...' }
```

### toCamelCase()

```typescript
{ created_at: '...', workspace_id: '...' }
→ { createdAt: '...', workspaceId: '...' }
```

---

## P2P File Sync

For images and media files, see `src/lib/p2pSyncManager.ts`.

Uses Supabase Storage as temporary buffer:
1. Uploader stores file → creates `sync_queue` entry
2. Other devices receive realtime notification
3. Each device downloads and marks as synced
4. Files auto-expire after 48 hours
