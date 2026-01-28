# User Profile Sync Implementation Plan

Implement a synced user profile picture system using local storage, P2P sync, and Supabase.

## User Review Required

> [!IMPORTANT]
> - **Schema Change**: We are adding `profile_url` to the Supabase `profiles` table.
> - **Model Change**: We are replacing `avatarUrl` with `profileUrl` in the `User` model.
> - **Migration**: Any existing `avatarUrl` data (if any existed locally) will be lost unless we explicitly migrate it. Given the context, we will focus on the new `profileUrl`.

## Proposed Changes

### 🛠️ Data Infrastructure
#### [MODIFY] [Supabase](file:///supabase)
- Add `profile_url` column to `public.profiles` (Text, nullable).
- Enable RLS for the new column (Updateable by the user themselves).

#### [MODIFY] [models.ts](file:///e:/ERP%20System/ERP%20System/src/local-db/models.ts)
- Rename `avatarUrl` to `profileUrl` in the `User` interface.

### 🔧 Logic & Services
#### [MODIFY] [platformService.ts](file:///e:/ERP%20System/ERP%20System/src/services/platformService.ts)
- [NEW] `resizeImage(filePath: string, maxWidth: number = 512): Promise<string>`:
    - Reads the image from Tauri AppData.
    - Uses an `HTMLCanvasElement` to resize the image.
    - Saves the resized version back to AppData (overwriting or using a new name).
    - Returns the path to the resized image.

#### [MODIFY] [AuthContext.tsx](file:///e:/ERP%20System/ERP%20System/src/auth/AuthContext.tsx)
- Update `User` fetching to include `profile_url` from Supabase and map it to `profileUrl` in the local state.

### 🖥️ User Interface
#### [MODIFY] [Settings.tsx](file:///e:/ERP%20System/ERP%20System/src/ui/pages/Settings.tsx)
- Add "Profile Settings" section.
- Upload widget:
    - Calls `platformService.pickAndSaveImage` with `subDir: 'profile-images'`.
    - Calls `platformService.resizeImage`.
    - Updates local database.
    - Updates `profiles` table in Supabase.
    - Calls `p2pSyncManager.uploadFromPath` with the resized image path to notify other devices.

#### [MODIFY] [Layout.tsx](file:///e:/ERP%20System/ERP%20System/src/ui/components/Layout.tsx)
- Update the bottom user info circle and the workspace members list.
- **Logic**:
    1. Show image if `profileUrl` exists (resolved via `platformService.convertFileSrc`).
    2. Fallback to `user.name.charAt(0).toUpperCase()` if image fails to load or is missing.

### 🌍 Localization
#### [MODIFY] [en.json](file:///e:/ERP%20System/ERP%20System/src/i18n/locales/en.json)
- Add translations for "Profile Settings", "Change Picture", etc.

---

## Verification Plan

### Automated Tests
- No new automated tests planned for this UI/Tauri heavy feature.

### Manual Verification
1. **Upload**: Open Settings, upload a profile picture.
    - Verify it saves to `%APPDATA%/profile-images/...`
    - Verify it shows up in the sidebar immediately.
2. **Supabase Sync**: Check Supabase Dashboard to see if `profile_url` is updated in the `profiles` table.
3. **P2P Sync**:
    - Open the app on another terminal/device.
    - Verify the profile picture for the first user appears on the second device automatically.
4. **Fallback**: Remove the profile picture in settings.
    - Verify the sidebar shows the capital first letter of the name.
