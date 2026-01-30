# PLAN: Rebrand IraqCore to Asaas

This plan outlines the steps required to rename all instances of "IraqCore" to "Asaas" across the ERP System, including Branding, Configuration, and Code identifiers.

## 🟢 Socratic Gate Cleared

1. **Encryption Safety**: User confirmed **NOT** to touch `iraqcore-supabase-key`. This ensures data compatibility.
2. **Application ID**: User confirmed changing to `com.asaas.app`. This will create a new app identity.
3. **Android Code**: User confirmed sticking to configuration/UI changes (no file refactoring).

---

## Proposed Changes

### 1. UI & Branding
- **[MODIFY] [index.html](file:///e:/ERP%20System/ERP%20System/index.html)**: Rename title and metadata.
- **[MODIFY] [tauri.conf.json](file:///e:/ERP%20System/ERP%20System/src-tauri/tauri.conf.json)**: Update `productName` and window titles.
- **[MODIFY] [strings.xml](file:///e:/ERP%20System/ERP%20System/src-tauri/gen/android/app/src/main/res/values/strings.xml)**: Update Android app name.

### 2. Configuration & Identifiers
- **[MODIFY] [tauri.conf.json](file:///e:/ERP%20System/ERP%20System/src-tauri/tauri.conf.json)**: Update `identifier` to `com.asaas.app`.
- **[MODIFY] [.env](file:///e:/ERP%20System/ERP%20System/.env)**: Check for branding strings.

### 3. Logic & Development Scripts
- **[MODIFY] [encryption.ts](file:///e:/ERP%20System/ERP%20System/src/lib/encryption.ts)**: (Pending Confirmation) Update `KEY`.
- **[MODIFY] [release.py](file:///e:/ERP%20System/ERP%20System/release.py)**: Update branding and tags.
- **[MODIFY] [test-decrypt.mjs](file:///e:/ERP%20System/ERP%20System/test-decrypt.mjs)**: Update test identifiers.

### 4. Android/Tauri Generated Code
- **[MODIFY] [Android Manifest/Strings](file:///e:/ERP%20System/ERP%20System/src-tauri/gen/android/app/src/main/res/values/strings.xml)**: Update app name.
- **[MODIFY] [Android Build Gradle](file:///e:/ERP%20System/ERP%20System/src-tauri/gen/android/app/build.gradle.kts)**: Update namespace.
- **[REFACTOR] [Java Package Paths](file:///e:/ERP%20System/ERP%20System/src-tauri/gen/android/app/src/main/java/com/iraqcore/app/MainActivity.kt)**: Rename directory structure and package declarations.

---

## Phase 1: Planning (Orchestrated)
- [x] Initial discovery
- [/] Socratic Gate (Waiting for User)
- [ ] Finalize Plan

## Phase 2: Execution
- [ ] String replacements (Safe)
- [ ] Refactoring (Breaking)
- [ ] Build & Test

## Phase 3: Verification
- [ ] Run `npm run tauri build`
- [ ] Verify encryption functionality
- [ ] Check Android generated files
