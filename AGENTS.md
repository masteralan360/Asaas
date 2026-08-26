# Atlas Architecture

## Workspace data modes

- **Cloud:** Supabase is the source of truth; Dexie is a local cache and offline changes sync when connectivity returns.
- **Hybrid:** Supabase remains the source of truth; desktop apps also maintain a local SQLite mirror for resilience and recovery.
- **Local:** The device’s SQLite database is the source of truth; business data does not synchronize with Supabase.
- All modes use Dexie/IndexedDB for responsive local UI reads and writes.

## Live Exchange Rate Fetch

Any module that requires live exchange rate fetch MUST use the app-provided and centralized live exchange rate fetcher at `src/lib/exchangeRate.ts` and always ensure the exchange rate is up to date.

## New Modules

Any new module must have its access controlled either by workspace plan or by admin grant (E:\ERP System\Admin).
When adding a module, the user must specify whether it should be included in one or more plans or remain admin-grant only.
No new module should be accessible without one of these access rules being explicitly configured.

## Payment transactions

Every incoming or outgoing payment MUST be recorded through `payment_transactions` and mirrored in the ledger. Do not update payment balances or ledger entries directly without the corresponding payment transaction.

# Atlas UI conventions

## Dialogs (required)

Use the Atlas structured-dialog façade for every new workflow, form, detail, list, or editor modal. It supplies the app's responsive shell, fixed header and footer, safe-area spacing, and a scrollable body.

```tsx
import {
  AppDialog,
  AppDialogBody,
  AppDialogContent,
  AppDialogFooter,
  AppDialogHeader,
  AppDialogTitle,
} from '@/ui/components'

<AppDialog open={open} onOpenChange={setOpen}>
  <AppDialogContent className="max-w-2xl">
    <AppDialogHeader>
      <AppDialogTitle>Dialog title</AppDialogTitle>
    </AppDialogHeader>
    <AppDialogBody>{/* scrollable content */}</AppDialogBody>
    <AppDialogFooter>{/* actions */}</AppDialogFooter>
  </AppDialogContent>
</AppDialog>
```

Use the base `Dialog*` primitives only when a compact confirmation, alert, or deliberately custom interaction needs a different presentation. Do not create a new generic `DialogContent` modal as a shortcut. Keep the header, body, and footer separate; never make the whole structured dialog scroll.

The dialog's `confirmation` or `Proceed` button MUST be `disabled/grayed` out if there is a `requirement field or selector` which is invalid or empty.

For fields that primarily contain numeric values or monetary amounts, display values using appropriate number formatting and thousands separators (for example, `100000` → `100,000`). Apply this consistently in both editable inputs and read-only displays where applicable, also have `0` as a placeholder for empty values and deleting an amount in the field must not make it 0 but rather an unvalid-to-proceed empty field with the `0` placeholder.

Any field that requires date or date/time selection MUST use the app-provided date picker component at `src/ui/components/ui/date-time-picker.tsx`. Do not use native browser or operating-system date/time inputs or pickers (such as `<input type="date">` or `<input type="datetime-local">`). This keeps date selection behavior and presentation consistent across the application.

Any field that requires a business partner to be selected, then it must use the provided partnerautocomplete component at `src/ui/components/crm/BusinessPartnerAutocomplete.tsx` and have the `Linked` badge when linked as well as `Unlink` component when the business partner is linked, if unlinked it must empty out the business partner field and it's related data.

Any field that requires a product to be selected, then it must use the provided productautocomplete component at `src/ui/components/crm/ProductAutocomplete.tsx` and ProductsViewModal at `src/ui/components/crm/ProductsViewModal.tsx` wired properly to the productautocomplete component and have the `Linked` badge when linked as well as `Unlink` component when the product is linked, if unlinked it must empty out the product field.

Any field or control that allows users to select a currency MUST use the app-provided `CurrencySelector` component at `src/ui/components/CurrencySelector.tsx`. Do not create custom currency dropdowns, selectors, or native alternatives. Reuse this component consistently wherever currency selection is required.

Any field or cntrol that allows users to select a payment method MUST use the app-provided `PaymentMethodSelector` component at `src/ui/components/PaymentMethodSelector.tsx`. Do not create custom payment method dropdowns, selectors, or native alternatives IF the use is not module specific (for e.g. if a module needs a specific payment method selector, it can create new payment method inside app's provided one and wire it to that specific module). Reuse this component consistently wherever payment method selection is required.

While the modal is proceeding/processing it must NOT allow the user to close the modal by the overlay or X button. This is to prevent the user from closing the modal while the data is being saved and thus potentially corrupting the data.

Before finishing a modal, compare it with `src/ui/components/crm/BusinessPartnerFormDialog.tsx` and verify it at a narrow mobile width as well as desktop.

## Small Dialogs
Use the `src/ui/components/ui/small-dialog.tsx` component for dialogs that are normally used for showing information, such as the selected items details or list of items.

## Localization (required)
Use the `react-i18next` library for all text content that appears in the UI. Do not hardcode strings in components or application logic. The expected flow is:

1. Define text in the relevant language JSON file at `src/i18n/locales/`
2. Refer to text via keys in JSX, for example: `<p>{t('welcomeMessage')}</p>`

## Printing
If said new print template is required to have tables, then it must use the in-app A4 pagination for tables similar to 
'src\ui\components\orders\AtlasStandardOrderInvoiceTemplate.tsx'.

it Must always have its custom template.

## Date-range filtering

Any new module that displays a table or list of timestamped records MUST include the shared `DateRangeFilters` control when filtering by creation date is meaningful. Reuse this component rather than building a custom date-range filter.

## Delete Confirmation

Any field or control that allows users to delete data MUST use the app-provided delete confirmation dialog at `src/ui/components/ui/delete-confirmation-dialog.tsx`. Do not create custom delete confirmation dialogs, or native alternatives. Reuse this component consistently wherever delete confirmation is required.

