# Security, RLS & API Reference

Security in the ERP System is enforced at both the application and database levels, ensuring data privacy in a multi-tenant environment.

## 🛡 Security Architecture

### 1. Row Level Security (RLS)
The primary defense mechanism. Every table has RLS enabled.
- **Isolation**: Users can only see records where `workspace_id` matches their JWT metadata.
- **Policies**: 
    - `SELECT`: Restricted to same workspace.
    - `INSERT/UPDATE/DELETE`: Restricted to same workspace + authenticated status.

### 2. Multi-tier Passkey System
Registration is gated by passkeys stored in the `app_permissions` table:
- **Admin**: Required to create a new workspace.
- **Staff**: Required to join an existing workspace.
This ensures only authorized personnel can register for specific roles.

## 🔌 RPC Functions (Server API)

The system uses Remote Procedure Calls (RPC) for atomic or privileged operations.

| Function | Description | Access Level |
| :--- | :--- | :--- |
| `create_workspace` | Atomically creates a workspace and generates its code. | Admin (Registration) |
| `get_all_users` | Fetches all users across workspaces. | Super Admin (Passkey) |
| `verify_admin_passkey` | Validates the system passkey. | Super Admin |
| `delete_user_account` | Securely deletes a user and their profile. | Super Admin |

## 📦 Key Hooks (Frontend API)

These hooks handle data fetching, local DB interactions, and reactivity:

- **Auth**: `useAuth()` - Current user, session, and sign-in/out methods.
- **Sync**: `useSyncStatus()` - Tracks sync state and provides `fullSync()`.
- **Data**:
    - `useProducts()`: CRUD for inventory items.
    - `useCustomers()`: Management of client database.
    - `useOrders()` / `useInvoices()`: Transactional logic.

---
*End of Documentation.*
