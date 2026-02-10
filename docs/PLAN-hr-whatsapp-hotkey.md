# Plan: HR WhatsApp Component (Hotkeys)

## Goal
Enable one-click WhatsApp messaging for employees directly from the HR dashboard. Clicking a button on the employee card will open `web.whatsapp.com` with the employee's phone number pre-filled.

## User Request
> "hotkeys in HR page where if you press (send massage) button on a employee card, it will instantly redirect you to the whatsapp page... https://web.whatsapp.com/send/?phone=..."

## Proposed Changes

### 1. Logic Update (`src/lib/whatsappWebviewManager.ts`)
- **Add `openChat(phone)` method**:
  - Sanitize phone number.
  - Construct URL: `https://web.whatsapp.com/send?phone=${phone}&text&type=phone_number&app_absent=0`.
  - **Behavior**:
    - If Webview **exists**: Execute JS `window.location.href = url` and call `show()`.
    - If Webview **does not exist**: Store URL in `pendingUrl` property.
- **Update `createWebview`**:
  - Check for `pendingUrl`.
  - Use `pendingUrl` as the initial URL if present, otherwise default to `https://web.whatsapp.com`.
  - Clear `pendingUrl` after use.

### 2. UI Update (`src/ui/pages/HR.tsx`)
- **Imports**: `MessageCircle` (lucide-react), `useLocation` (wouter), `whatsappManager` (@/lib).
- **Navigation**:
  - Use `const [, setLocation] = useLocation()` to navigate.
- **Button**:
  - Add "Message" button to employee card.
  - **OnClick**:
    1. `whatsappManager.openChat(employee.phone)`
    2. `setLocation('/whatsapp')`
    - *Note*: Calling `openChat` first ensures `pendingUrl` is set if needed before the page transition triggers `getOrCreate`.

## Verification Plan

### Manual Verification
1.  **Setup**: Ensure WhatsApp feature is enabled in settings (if toggleable) or just accessible.
2.  **Scenario A (Webview Closed/New)**:
    - Go to HR.
    - Click Message on an employee.
    - Verify app navigates to `/whatsapp`.
    - Verify WhatsApp Webview loads the direct chat URL (checking if phone number is in address bar or chat opens).
3.  **Scenario B (Webview Already Open/Hidden)**:
    - Go to `/whatsapp` manually first, load it.
    - Go back to HR.
    - Click Message on different employee.
    - Verify app navigates to `/whatsapp`.
    - Verify Webview *navigates* to the new number.

## Implementation Steps
- [ ] Modify `src/lib/whatsappWebviewManager.ts` to add `openChat` and `pendingUrl` logic.
- [ ] Modify `src/ui/pages/HR.tsx` to add button and navigation logic.
