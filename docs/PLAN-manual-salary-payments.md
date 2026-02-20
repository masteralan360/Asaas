# Manual Salary Payments

## Overview
Currently, employee salaries are automatically assumed as "Paid" or "Pending" strictly based on whether the current date has passed their designated `salaryPayday`. The user wants to transition this to a manual payment system where salaries are only marked as paid when a user explicitly performs the action. 

When marked as paid, the system must create a real `Expense` record in the database for tracking, allow for full manual payments, and support an "undo" functionality that deletes the generated expense record if marked unpaid.

## Project Type
**WEB** (using `frontend-specialist`)

## Success Criteria
- [ ] Employees show as "Pending" until manually marked as "Paid" for the specific month.
- [ ] Marking an employee as "Paid" creates a permanent, one-time `Expense` record (category: `payroll`) linked to that employee for the selected month.
- [ ] The total "Paid" and "Pending" amounts on the Budget dashboard accurately reflect these manual payments rather than date-based assumptions.
- [ ] Users can "undo" a payment, which removes the associated `Expense` record and reverts the employee's status for that month back to "Pending".

## Tech Stack
- Frontend: React / TypeScript / Tailwind CSS
- Data Store: Local DB (`src/local-db`)

## File Structure Additions/Changes
We will primarily be modifying existing files:
- `src/ui/pages/Budget.tsx`
- `src/local-db/hooks.ts` or `src/local-db/database.ts` (if new helper methods are needed for payroll expenses)

## Task Breakdown

### Task 1: Refactor Payroll Expense Logic in Budget.tsx
- **Agent**: `frontend-specialist`
- **Skill**: `react-patterns`
- **Description**: Modify the `metrics` `useMemo` in `Budget.tsx`. Instead of calculating `status = today >= payDate ? 'paid' : 'pending'`, the logic must check if an actual `Expense` record (with `category === 'payroll'` and the corresponding `employeeId` + `month/year`) exists.
- **INPUT**: `Budget.tsx`
- **OUTPUT**: Updated virtual expense map that accurately reflects the existence of manual payroll expenses.
- **VERIFY**: The Budget page should show all employees as "Pending" if no expense records exist for them in the current selected month.

### Task 2: Implement Manual "Mark as Paid/Unpaid" Actions
- **Agent**: `frontend-specialist`
- **Skill**: `react-patterns`
- **Description**: Update the `handleToggleStatus` function in `Budget.tsx` to handle the new virtual salary items. 
  - If marking as "Paid": Create an `Expense` with `{ type: 'one-time', category: 'payroll', employeeId: emp.id, amount: emp.salary, ... }`.
  - If marking as "Unpaid": Find the corresponding `Expense` record for that employee/month and delete it.
- **INPUT**: `Budget.tsx`, `src/local-db/hooks.ts`
- **OUTPUT**: Working toggle buttons for employee salaries.
- **VERIFY**: Clicking the checkmark/circle icon on a personnel item should instantly create/delete an expense record, and the UI should reflect the new status and update the top dashboard metric numbers.

## Phase X: Verification
- [ ] Lint: `npm run lint` & `npx tsc --noEmit`
- [ ] Manual Check: Add an employee with a salary.
- [ ] Manual Check: Go to Budget -> Verify they are "Pending".
- [ ] Manual Check: Mark them as "Paid". Verify they turn green, the "Total Paid" metric goes up, and a new Expense record is generated.
- [ ] Manual Check: Mark them as "Unpaid". Verify they revert to yellow ("Pending") and the generated Expense record is deleted.
