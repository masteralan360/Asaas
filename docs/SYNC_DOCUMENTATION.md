# Sync Engine Documentation

## Overview

The ERP System uses an **offline-first architecture** where:
1. All data is stored locally in IndexedDB (via Dexie.js)
2. The UI reads/writes only from the local database
3. Changes are synced to Supabase when online

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   UI Layer      │────▶│  Local DB       │────▶│  Sync Engine    │
│   (React)       │◀────│  (IndexedDB)    │◀────│                 │
└─────────────────┘     └─────────────────┘     └────────┬────────┘
                                                         │
                                                         ▼
                                                ┌─────────────────┐
                                                │   Supabase      │
                                                │   (PostgreSQL)  │
                                                └─────────────────┘
```

## Sync Flow

### 1. Local Operations
When you create, update, or delete a record:
1. Change is written to IndexedDB immediately
2. Record is marked with `syncStatus: 'pending'`
3. A sync queue item is created

### 2. Push Changes
When online, pending changes are pushed to Supabase:
1. Iterate through sync queue items
2. For each item, call Supabase upsert/delete
3. On success, remove from queue and mark as synced

### 3. Pull Changes
After pushing, pull remote changes:
1. Query Supabase for records updated after `lastSyncTime`
2. Compare versions with local records
3. Apply remote changes using last-write-wins

## Conflict Resolution

**Strategy: Last-Write-Wins**

When the same record is modified both locally and remotely:
- Compare `version` numbers
- Higher version wins
- If equal, compare `updatedAt` timestamps

```typescript
if (remoteRecord.version > localRecord.version) {
  // Remote wins - apply remote changes
} else if (localRecord.version > remoteRecord.version) {
  // Local wins - push will overwrite remote
}
```

## Key Files

| File | Purpose |
|------|---------|
| `src/sync/syncEngine.ts` | Core push/pull logic |
| `src/sync/syncQueue.ts` | Queue management |
| `src/sync/useOnlineStatus.ts` | Connection detection |
| `src/sync/useSyncStatus.ts` | React hook for sync state |

## Usage

### Check Sync Status
```tsx
import { useSyncStatus } from '@/sync'

function MyComponent() {
  const { syncState, pendingCount, sync, isOnline } = useSyncStatus()
  
  return (
    <div>
      <p>Status: {syncState}</p>
      <p>Pending: {pendingCount}</p>
      <button onClick={sync}>Sync Now</button>
    </div>
  )
}
```

### Manual Sync
```typescript
import { fullSync } from '@/sync'

await fullSync(userId, lastSyncTime)
```

## Sync States

| State | Description |
|-------|-------------|
| `idle` | No sync in progress |
| `syncing` | Currently syncing |
| `error` | Sync failed |
| `offline` | No internet connection |

## Configuration

Set environment variables in `.env`:

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

## Auto-Sync Behavior

- Syncs automatically every 30 seconds when online
- Triggers sync immediately when coming back online
- Shows pending count in the UI

## Offline Mode

When offline:
- All CRUD operations work normally
- Changes accumulate in the sync queue
- Sync status indicator shows "Offline"
- App continues to function fully
