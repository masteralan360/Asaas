# i18n Synchronization Plan

Goal: Ensure perfect structural parity, complete translations, and consistent key ordering across `en.json`, `ar.json`, and `ku.json`.

---

## Technical Strategy

1.  **Master Source**: `en.json` is the source of truth for all keys and nesting structures.
2.  **Key Migration**:
    *   Move `"offlineTitle"` and `"offlineDesc"` into the `"pos"` object in all locale files.
3.  **Structure Consolidation**:
    *   `ku.json`: Flatten the large top-level `"return"` object to match the schema in `en.json`.
4.  **Parity Audit**:
    *   Ensure all files have identical top-level keys in the same order.
    *   Sync nested keys within objects (e.g., `storages`, `inventoryTransfer`).

## Missing Translations Registry

| Key | Context | Arabic | Kurdish |
| :--- | :--- | :--- | :--- |
| `storages.main` | Storage Name | الرئيسي | سەرەکی |
| `storages.reserve` | Storage Name | الاحتياط | یەدەگ |
| `pos.offlineTitle` | POS Offline | تم الحفظ بدون اتصال | بە شێوەی ئۆفلاین پاشەکەوت کرا |
| `pos.offlineDesc` | POS Offline | تم حفظ عملية البيع محلياً وستتم مزامنتها عند الاتصال بالإنترنت. | فرۆشتنەکە بە ناوخۆیی پاشەکەوت کرا و کاتێک پەیوەندی ئینتەرنێت هەبوو هاوکات دەکرێت. |

## Pruning Plan

*   **Ghost Keys**: Any keys present in `ar.json` or `ku.json` but absent in `en.json` will be deleted unless they are required for legacy compatibility (none identified yet).

---

## Verification

Files will be validated against the `en.json` keyset using a structural comparison script and manual UI smoke tests in Arabic and Kurdish.
