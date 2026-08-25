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

For fields that primarily contain numeric values or monetary amounts, display values using appropriate number formatting and thousands separators (for example, `100000` → `100,000`). Apply this consistently in both editable inputs and read-only displays where applicable.

Any field that requires date or date/time selection MUST use the app-provided date picker component at `src/ui/components/ui/date-time-picker.tsx`. Do not use native browser or operating-system date/time inputs or pickers (such as `<input type="date">` or `<input type="datetime-local">`). This keeps date selection behavior and presentation consistent across the application.

Any field or control that allows users to select a currency MUST use the app-provided `CurrencySelector` component at `src/ui/components/CurrencySelector.tsx`. Do not create custom currency dropdowns, selectors, or native alternatives. Reuse this component consistently wherever currency selection is required.

While the modal is proceeding/processing it must NOT allow the user to close the modal by the overlay or X button. This is to prevent the user from closing the modal while the data is being saved and thus potentially corrupting the data.

Before finishing a modal, compare it with `src/ui/components/crm/BusinessPartnerFormDialog.tsx` and verify it at a narrow mobile width as well as desktop.
