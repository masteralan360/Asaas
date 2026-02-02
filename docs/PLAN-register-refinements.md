# PLAN: Register Page Refinements

Refining the registration page to ensure UI consistency with the log-in page and capturing additional user information (Phone Number) for auditing purposes.

## Proposed Changes

### 1. UI Refinements
#### [MODIFY] [Register.tsx](file:///e:/ERP%20System/Asaas/src/ui/pages/Register.tsx)
- Replace the manually defined `getAuthLogo` logic with the `useLogo` hook used in `Login.tsx`.
- Add a "Phone Number" input field before the "Role" selection.
- Update state to capture `phone`.

### 2. Logic & Data
#### [MODIFY] [AuthContext.tsx](file:///e:/ERP%20System/Asaas/src/auth/AuthContext.tsx)
- Update the `signUp` method to accept `phone`.
- Pass `phone` into the `options.data` (metadata) inside the standard Supabase `signUp` call.
- Update the `AuthUser` interface and `parseUserFromSupabase` if we want to expose it in the application (optional, but good for "info only" visibility).

---

## Task Breakdown

### Phase 1: Registration Form
- [ ] Import `useLogo` in `Register.tsx`.
- [ ] Add `phone` state.
- [ ] Add Form Input for Phone.

### Phase 2: Auth Implementation
- [ ] Update `signUp` parameters in `AuthContext.tsx`.
- [ ] Map phone to metadata.

### Phase 3: Admin Dashboard
- [ ] Update `Admin.tsx` (or relevant component) to display the Phone Number in the registered users list.

### Phase 4: Verification
- [ ] Register a new user with a phone number.
- [ ] Check Supabase `auth.users` for metadata.
- [ ] Verify phone number appears in the Admin Dashboard list.

---

## Agent Assignments
- `frontend-specialist`: Handle `Register.tsx` UI changes.
- `backend-specialist`: Handle `AuthContext.tsx` data mapping.

---

## Verification Plan
1. Open the Registration page.
2. Verify Logo matches Login.
3. Fill out the form including the new Phone Number.
4. Complete registration.
5. Verify no SMS/Verification is required (Info-only).
6. Confirm the data exists in the user's metadata via Supabase dashboard or logs.
