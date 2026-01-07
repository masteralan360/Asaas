# Authentication & Multi-tenancy

The ERP System uses a robust multi-tenant authentication model powered by **Supabase Auth** and logic-based **Workspaces**.

## 🔑 Core Concepts

### 1. Workspaces
Every user belongs to exactly one **Workspace**.
- **Admin**: Creates a new workspace during registration. A unique `workspace_code` is generated.
- **Staff/Viewer**: Joins an existing workspace using the `workspace_code` provided by their admin.
- **Isolation**: Data is strictly isolated at the database level using Row Level Security (RLS) based on the `workspace_id`.

### 2. User Roles
- `admin`: Full access to workspace data and settings. Can manage workspace members.
- `staff`: Can create/edit products, customers, orders, and invoices.
- `viewer`: Read-only access to the workspace.

## 🛠 Implementation Details

### `AuthContext.tsx`
The central hub for auth state. It provides:
- `user`: An `AuthUser` object containing metadata like `workspaceId` and `role`.
- `signIn(email, password)`: Authenticates with Supabase.
- `signUp(params)`: 
    - For Admins: Calls the `create_workspace` RPC before creating the auth user.
    - For Staff: Verifies the `workspace_code` before registration.
- `hasRole(roles[])`: Helper function for component-level access control.

### `ProtectedRoute` & `GuestRoute`
Wrappers around UI routes that enforce authentication and role-based access.

### `supabase/user_profiles.sql`
A `public.profiles` table that mirrors `auth.users` metadata. A trigger (`handle_new_user`) automatically creates a profile when a user signs up. This allows for querying workspace members without accessing the restricted `auth` schema.

## 🛡 Security Layer
- **RLS Policies**: Every table in Supabase has a `USING` clause that checks `(workspace_id = (auth.jwt() -> 'user_metadata' ->> 'workspace_id')::uuid)`.
- **Passkey System**: Registration is protected by a multi-tier passkey system (`app_permissions` table) to prevent unauthorized account creation.

---
*Next: See [SYNC_ENGINE.md](./SYNC_ENGINE.md) for synchronization logic.*
