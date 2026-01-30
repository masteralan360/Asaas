# PLAN: Resource Sync Overlay Fix

Improve the user experience of the P2P resource synchronization by preventing unnecessary overlays and fixing the progress tracking.

## 🔴 USER REVIEW REQUIRED

> [!IMPORTANT]
> - The overlay will be hidden by default on refresh. It will only show up if the app detects files that need to be downloaded from the sync queue.
- If a download batch starts, the progress bar will now correctly fill from 0% to 100% based on the total number of files in that specific batch.

## Proposed Changes

### [Core P2P Sync]
#### [MODIFY] [p2pSyncManager.ts](file:///e:/ERP%20System/ERP%20System/src/lib/p2pSyncManager.ts)
- Add `initialTotalCount` to track the size of the sync batch when it starts.
- Update `isInitialSync` logic:
    - Set to `true` initially.
    - If `checkPendingDownloads` finds 0 items, immediately set to `false`.
    - Emit progress updates that include both `total` (initial count) and `pending` (remaining count).

### [UI Components]
#### [MODIFY] [ResourceSyncOverlay.tsx](file:///e:/ERP%20System/ERP%20System/src/ui/components/p2p/ResourceSyncOverlay.tsx)
- Update `setStats` to use separate values for `total` and `pending` from the manager.
- Add a check: if `isVisible` is true but `stats.total` is 0, do not render (or show a simple spinner instead of a broken progress bar).

## Verification Plan

### Automated Tests
- No automated tests available for P2P sync (requires multiple sessions/Realtime).

### Manual Verification
1. **Normal Refresh**: Refresh the app. The "Downloading Resources" overlay should NOT appear if there are no pending files.
2. **File Sync Test**:
    - Upload a file from another session/device.
    - Refresh the current app.
    - The overlay should appear, show "1 of 1 files downloaded", and then disappear.
3. **Multi-File Sync**:
    - Upload multiple files.
    - Verify the progress bar fills up incrementally (e.g., 50% after the first of two files).
