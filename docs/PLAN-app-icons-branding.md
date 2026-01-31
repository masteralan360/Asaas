# PLAN: App Icons Branding

Update application icons for Tauri (all platforms) and refresh UI logos with high-quality assets.

## 🟢 Socratic Gate

> [!IMPORTANT]
> Please answer these questions to finalize the implementation details:
> 1. **Title Bar Dynamic Selection**: Should the title bar logo (`logoICO`) change dynamically based on the current app language (e.g., Arabic, English, Kurdish)?
> 2. **Primary Icon**: For the main Tauri application icon (`bundle.icon`), should I use the generic `logo.ico` or generate the full icon set from `logo.png`?
> 3. **UI Updates**: Are there specific "high-quality" locations in the UI (besides the Login and Sidebar) that you want to prioritize for the new `logoPNG` assets?

## Proposed Changes

### [Tauri Configuration]
- **[MODIFY] [tauri.conf.json](file:///e:/ERP%20System/Asaas/src-tauri/tauri.conf.json)**: Update `bundle.icon` to use `public/logo.ico` or generated set.

### [React UI Components]
- **[MODIFY] [TitleBar.tsx](file:///e:/ERP%20System/Asaas/src/ui/components/TitleBar.tsx)**: Implement logic to switch between `public/logoICO` assets based on locale/theme.
- **[MODIFY] [Layout.tsx](file:///e:/ERP%20System/Asaas/src/ui/components/Layout.tsx)**: Update sidebar/header logos to use `public/logoPNG`.
- **[MODIFY] [Login.tsx](file:///e:/ERP%20System/Asaas/src/ui/pages/Login.tsx)**: Update branding with high-quality PNG.
- **[MODIFY] [Invoices/Receipts]**: Ensure print templates use the high-quality logo.

### [Misc]
- **[MODIFY] [index.html](file:///e:/ERP%20System/Asaas/index.html)**: Link favicon to `logo.ico`.

## Verification Plan

### Manual Verification
- Verify the taskbar icon displays correctly on Windows.
- Verify the title bar icon changes when switching languages (if dynamic).
- Check the login screen for high-quality logo rendering.
