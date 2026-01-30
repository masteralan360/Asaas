# PLAN: Media Sync Enhancements

Improve the media synchronization experience by increasing throttles, expanding access, and providing better feedback.

## 🔴 USER REVIEW REQUIRED

> [!IMPORTANT]
> - The "Download Media" button will specifically trigger a check for files uploaded by other users.
> - The permission change allows `staff` role users to clear the sync queue and trigger manual syncs, which was previously `admin` only.

## Proposed Changes

### [Sync Management]
#### [MODIFY] [p2pSyncManager.ts](file:///e:/ERP%20System/ERP%20System/src/lib/p2pSyncManager.ts)
- Increase cooldown constant from `5000` to `10000` (10 seconds).
- Add a public `triggerManualDownloadCheck()` method to allow manual triggers from the UI.

### [Settings Page]
#### [MODIFY] [Settings.tsx](file:///e:/ERP%20System/ERP%20System/src/ui/pages/Settings.tsx)
- **Permissions**: Update the "Sync Status" section visibility to include both `admin` and `staff` roles.
- **Download Button**: Add a "Download Media" button in the Sync Status section.
- **Media Count**: 
    - Add state `mediaCount` to track pending local media.
    - Calculate count when opening the "Sync All Media" modal.
    - Update the modal description to include the "N items to sync" info.

## Verification Plan

### Manual Verification
1.  **Cooldown**: 
    - Refresh the app. 
    - Verify header shows "Cooldown: 10s".
    - Try to refresh again before it reaches zero; verify it stays on cooldown.
2.  **Staff Permissions**:
    - Login as a `staff` user.
    - Navigate to Settings.
    - Verify "Sync Status" section is visible.
3.  **Media Count**:
    - Open "Sync Media" modal in Settings.
    - Verify it says something like "X items will be synced".
4.  **Download Media**:
    - Click "Download Media" in Settings.
    - Verify console shows "Checking for pending resources..." (if not on cooldown).
