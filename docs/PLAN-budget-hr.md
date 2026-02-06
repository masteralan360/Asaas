# Technical Plan: Budget & HR (Option A)

Implementation of a financial orchestrator and HR management system with real-time budget tracking and mandatory expense interceptors.

---

## 🏗️ Architecture (Option A: "Financial Orchestrator")

### 1. Data Models (`src/local-db/models.ts`)

#### `Employee`
- `id`: string
- `name`: string
- `email`: string
- `phone`: string
- `gender`: 'male' | 'female' | 'other'
- `role`: string (Label only)
- `location`: string
- `joiningDate`: string (ISO)
- `salary`: number
- `salaryCurrency`: CurrencyCode
- `workspaceId`: string
- `syncStatus`: SyncStatus

#### `Expense`
- `id`: string
- `type`: 'recurring' | 'one-time'
- `category`: 'rent' | 'electricity' | 'payroll' | 'general'
- `amount`: number
- `currency`: CurrencyCode
- `status`: 'pending' | 'paid' | 'snoozed'
- `dueDate`: string (ISO)
- `paidAt`: string (ISO) | null
- `snoozeCount`: number
- `workspaceId`: string

#### `BudgetCheck` (Snooze State)
- `id`: string
- `expenseId`: string
- `snoozeUntil`: string (ISO) - *Threshold: Start of day, 9:00 AM*
- `workspaceId`: string

### 2. Logic & Calculations

- **Net Profit Formula**:  
  `Net Profit = (Gross Sales - COGS) - (Total Expenses + Total Payroll)`
- **Owner Dividends**: Calculated as a dynamic percentage (stored in `app_settings`) of the **Net Profit**.
- **Interceptor Mechanism**:  
  A `BudgetInterceptor` provider will wrap the main layout. It checks for:
  - Unpaid recurring expenses past their `dueDate`.
  - Expenses whose `snoozeUntil` is <= current time (after 9:00 AM).

---

## 🛠️ Implementation Phases

### Phase 1: Storage & Registry (`HR`)
- Create the `HR.tsx` page (CRUD for Employees).
- Add `employees` to DB schema.

### Phase 2: Budget & Expense Tracking
- Create `Budget.tsx` page.
- Implement "Add Expense" (Recurring/One-time).
- Build the "Net Profit" dashboard view using real-time aggregation from `sales` and `expenses`.

### Phase 3: The Interceptor System
- Build the blocking modal.
- Implement "Snooze" functionality (Date picker + logic).
- Add the persistent "Snooze Bell" to the UI header.

---

## 🚦 Verification Plan

### Automated
- Unit tests for profit calculation logic.
- Schema migration verification.

### Manual
- Add an expense due today -> Verify app is blocked.
- Snooze expense -> Verify app is unblocked until the target date.
- Pay expense -> Verify it transitions to 'paid' status and reflects in net profit.
