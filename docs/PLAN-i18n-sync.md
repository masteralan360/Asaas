# i18n Synchronization Plan

This plan outlines the strategy for synchronizing the Arabic (`ar.json`) and Kurdish (`ku.json`) localization files with the English (`en.json`) master file to ensure perfect structural parity, missing translation coverage, and removal of ghost keys.

## Goal Description
Maintain 100% parity between `en.json`, `ar.json`, and `ku.json`. All files must share the exact same key structure and ordering, reflecting the master `en.json` file.

## Proposed Strategy

### 1. Structural Audit & Alignment
- Use `en.json` as the source of truth for all keys and their hierarchy.
- Reorder keys in `ar.json` and `ku.json` to match `en.json` exactly.
- Fix identified anomalies:
    - **Offline Keys**: Move `"offlineTitle"` and `"offlineDesc"` from top-level to `pos` object in `ar.json`.
    - **Return Object**: Consolidate top-level `"return"` keys in `ku.json` into the appropriate structure defined by `en.json` (moving them to `sales.return` or keeping the top-level one if it exists in `en.json`).
    - **Receipt Object**: Ensure top-level `"receipt"` is consistent across all files.

### 2. Missing Key Detection & Translation
- Identify all keys present in `en.json` but missing in `ar.json` or `ku.json`.
- Perform research-based translations for:
    - New storage features (`storages.*`).
    - Inventory transfer terms (`inventoryTransfer.*`).
    - Recently added POS and Sales history keys.
- **Translation Quality**: Use formal Arabic (Modern Standard) and Central Kurdish (Sorani) for all localized strings.

### 3. Ghost Key Removal
- Identify keys in `ar.json` and `ku.json` that no longer exist in `en.json`.
- Prune these "ghost keys" to prevent bloat and potential conflicts.

### 4. Verification
- Manual verification of the UI in all three languages.
- JSON schema validation (ensuring valid JSON format).
- Structural check to ensure all three files have the same line count (approximate) and identical key paths.

## Implementation Phases

### Phase 1: Preparation (Done)
- Initial audit of JSON files.
- Identification of major structural differences.

### Phase 2: Structural Mirroring
- Re-ordering and moving keys in `ar.json` and `ku.json` to match `en.json`.
- Moving `offlineTitle` and `offlineDesc` into the `pos` object.

### Phase 3: Content Sync
- Adding missing keys from `en.json`.
- Translating missing values.
- Removing non-existent keys.

### Phase 4: Final Verification
- Checking for hardcoded strings in components.
- Final UI walkthrough in Arabic and Kurdish.
