# Offline Synchronization Guide

This document describes how to use and integrate the synchronization system in the ERP application.

## 🌟 Overview

The application follows an **offline-first** philosophy. All user actions (creating products, making sales, updating settings) are saved immediately to a local IndexedDB database. This ensures the app is fast and fully functional without an internet connection.

## 🏗 How it Works

1.  **Local First**: Every write operation goes to the local database and is marked as `pending`.
2.  **Mutation Queue**: A record of the "intent" (e.g., "Update Product X") is stored in the `offline_mutations` table.
3.  **Manual Sync**: Synchronization is currently a manual process triggered by the user to ensure data consistency and give control over bandwidth.
4.  **Push then Pull**: The sync process first pushes all local changes to Supabase, then pulls any changes made by other users/devices.

## 🎣 React Hooks

### `useSyncStatus()`
The primary hook for managing sync in the UI.

```tsx
import { useSyncStatus } from '@/sync'

function SyncIndicator() {
    const { 
        syncState,      // 'idle' | 'syncing' | 'error' | 'offline'
        pendingCount,   // Number of changes waiting to be synced
        isOnline,       // Current connection status
        sync,           // Function to trigger manual sync
        isSyncing       // Boolean: true if sync is in progress
    } = useSyncStatus()

    return (
        <div>
            <span>Pending Changes: {pendingCount}</span>
            <button onClick={sync} disabled={isSyncing || !isOnline}>
                {isSyncing ? 'Synchronizing...' : 'Sync Now'}
            </button>
        </div>
    )
}
```

### `useOnlineStatus()`
A simple hook to detect if the browser is online or offline.

```tsx
const { isOnline, status } = useOnlineStatus()
```

## 📋 Synchronization States

- **`idle`**: All local changes have been successfully synced or there's nothing to sync.
- **`syncing`**: Communication with Supabase is in progress.
- **`offline`**: No internet connection detected; sync is disabled.
- **`error`**: The last sync attempt failed. Pending changes remain safe in local storage.

## 📂 Key Files

- `src/sync/syncEngine.ts`: Core logic for pushing and pulling data.
- `src/sync/useSyncStatus.ts`: Main React interface for the sync system.
- `src/local-db/hooks.ts`: Contains `addToOfflineMutations` used by all data hooks.

---
*For technical implementation details, see [SYNC_ENGINE.md](./SYNC_ENGINE.md)*
