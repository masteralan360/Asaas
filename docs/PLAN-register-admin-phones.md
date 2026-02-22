# Plan: Add Admin Phone Numbers on Registration

## 1. Overview
User request: In the register page, if the user switches to admin role, add a "Add Phone Numbers" button below the workspace name input. Clicking it opens a modal with a repeater field to add multiple phone numbers freely, where the first is automatically marked primary. Ensure a premium UI/UX.

## 2. Project Type
**WEB** (React frontend modifications for the registration flow).

## 3. Success Criteria
- [ ] "Add Phone Numbers" button appears only when the `admin` role is selected.
- [ ] The button is positioned directly below the Workspace Name input and matches the styling/sizing of adjacent inputs.
- [ ] Clicking the button opens a premium-designed modal.
- [ ] Users can add multiple phone numbers dynamically using a repeater (+) field.
- [ ] The first number in the list is automatically assigned as the primary number.
- [ ] Phone numbers state is preserved in the registration form until submission.
- [ ] During the registration process, the phone numbers are saved to the backend `workspace_phones` table immediately after workspace creation.

## 4. Tech Stack
- Frontend: React (Vite/Tauri), Tailwind CSS, Lucide Icons, Shadcn components (Dialog).
- DB/Hooks: Uses the newly created `workspace_phones` table and associated hooks to save data post-registration.

## 5. File Structure
- `src/ui/pages/Register.tsx` (Target form modifications)
- `src/ui/components/modals/RegisterWorkspacePhonesModal.tsx` (New Modal Component)

## 6. Task Breakdown

### Task 1: Create RegisterWorkspacePhonesModal Component
- **Agent**: `frontend-specialist`
- **Skill**: `frontend-design`, `react-patterns`
- **Input**: Need a UI to manage an array of phone numbers `{phone: string, label: string, is_primary: boolean}[]`.
- **Output**: A new `RegisterWorkspacePhonesModal.tsx` containing a Dialog/Modal with a repeater input, adding nice animations/icons for the UI/UX.
- **Verify**: Modal opens, allows adding/removing fields, marks the first field as primary, and passes the state to a parent cleanly on save.

### Task 2: Integrate Button into Register Page
- **Agent**: `frontend-specialist`
- **Skill**: `react-patterns`
- **Input**: The `Register.tsx` file.
- **Output**: Added local state `adminPhones`, and a modern "Add Phone Numbers" button under `workspaceName` (visible only for `admin` role). Connected it to toggle the modal.
- **Verify**: Form renders correctly without layout shifts. Role switching hides/shows the button properly.

### Task 3: Handle Phone Creation on Registration Success
- **Agent**: `frontend-specialist`
- **Skill**: `api-patterns`
- **Input**: The collected `adminPhones` state.
- **Output**: Update the `handleSubmit` logic in `Register.tsx`. After successful `signUp` (and assuming the workspace is created on the backend), insert the collected phone numbers into the `workspace_phones` table via Supabase directly or via the auth hook response before navigating to the next page.
- **Verify**: Registered workspace properly connects to the correct phone records in the database.

## 7. Phase X: Verification
- [ ] Lint: Verify no TS errors in `Register.tsx` or the new modal.
- [ ] UX Audit: Ensure the modal buttons and repeater fields have a nice UI/UX.
- [ ] Test: Manually register a new admin with 2 phone numbers, verify successful workspace and phone records creation.
