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

Before finishing a modal, compare it with `src/ui/components/crm/BusinessPartnerFormDialog.tsx` and verify it at a narrow mobile width as well as desktop.
