# Authentication System

## Overview

Asaas uses **Supabase Auth** for authentication with a custom workspace-based authorization model.

---

## Authentication Flow

### Sign Up

```
1. User enters email, password, name, passkey
2. Passkey validated against workspace admin/member key
3. Supabase creates auth.users record
4. Trigger creates profiles record with workspace_id
5. User redirected to dashboard
```

### Sign In

```
1. User enters email, password
2. Supabase validates credentials
3. Session created with JWT
4. AuthContext loads profile from Supabase
5. User redirected to appropriate page
```

---

## Files

| File | Purpose |
|------|---------|
| `src/auth/supabase.ts` | Supabase client initialization |
| `src/auth/AuthContext.tsx` | Auth state management |
| `src/auth/ProtectedRoute.tsx` | Route guards |
| `src/auth/index.ts` | Public exports |

---

## AuthContext

Location: `src/auth/AuthContext.tsx`

### State

```typescript
interface AuthUser {
  id: string
  email: string
  name: string
  role: 'admin' | 'staff' | 'viewer'
  workspaceId: string
  workspaceCode: string
  workspaceName?: string
  profileUrl?: string
  phone?: string
}

interface AuthContextType {
  user: AuthUser | null
  session: Session | null
  sessionId: string | null
  isLoading: boolean
  isAuthenticated: boolean
  isKicked: boolean
  signOut: () => Promise<void>
  hasRole: (roles: UserRole[]) => boolean
  refreshUser: () => Promise<void>
  updateUser: (updates: Partial<AuthUser>) => void
}
```

### Key Functions

#### signIn(email, password)
Authenticates via Supabase, loads profile data.

#### signUp({ email, password, name, role, passkey, ... })
1. Validates passkey against workspace
2. Creates Supabase auth user
3. Database trigger creates profile

#### signOut()
1. Clears local session
2. Clears IndexedDB (optional)
3. Redirects to login

#### hasRole(roles)
Checks if current user has any of the specified roles.

---

## User Roles

| Role | Permissions |
|------|-------------|
| `admin` | Full access to all features, settings, members |
| `staff` | POS, sales, products, limited settings |
| `viewer` | Read-only access to dashboard and reports |

### Role Checks in UI

```typescript
// In component
const { user } = useAuth()

if (user?.role === 'admin') {
  // Show admin-only controls
}
```

### Route Protection

```tsx
<Route path="/settings">
  <ProtectedRoute allowedRoles={['admin', 'staff']}>
    <Settings />
  </ProtectedRoute>
</Route>
```

---

## ProtectedRoute Component

Location: `src/auth/ProtectedRoute.tsx`

### Props

```typescript
interface ProtectedRouteProps {
  children: React.ReactNode
  allowedRoles?: UserRole[]       // Optional role restriction
  requiredFeature?: FeatureFlag   // Optional feature flag check
  allowKicked?: boolean           // Allow kicked users (for workspace reg)
}
```

### Feature Flags

```typescript
type FeatureFlag = 
  | 'allow_pos'
  | 'allow_customers'
  | 'allow_orders'
  | 'allow_invoices'
  | 'allow_whatsapp'
```

### Behavior

1. If not authenticated → redirect to `/login`
2. If role not allowed → redirect to `/`
3. If feature disabled → redirect to `/`
4. If workspace locked → redirect to `/locked-workspace`
5. If kicked from workspace → redirect to `/workspace-registration`

---

## Workspace Passkeys

### Purpose

Passkeys control who can join a workspace:

| Passkey Type | Purpose |
|--------------|---------|
| Admin Passkey | Creates user with `admin` role |
| Member Passkey | Creates user with `staff` or `viewer` role |

### Validation

```typescript
// During registration
const { data } = await supabase
  .from('workspaces')
  .select('id, admin_passkey, member_passkey')
  .eq('code', workspaceCode)
  .single()

if (passkey === data.admin_passkey) {
  // Grant admin role
} else if (passkey === data.member_passkey) {
  // Grant staff role
} else {
  throw new Error('Invalid passkey')
}
```

---

## Session Management

### JWT Token

- Supabase issues JWT on sign-in
- Token contains user ID and metadata
- Automatically refreshed before expiry

### Session ID

Extracted from JWT for:
- P2P sync session tracking
- Multi-device detection
- Concurrency control

```typescript
function decodeSessionId(token: string): string | null {
  const payload = JSON.parse(atob(token.split('.')[1]))
  return payload.session_id || null
}
```

---

## Demo Mode

When Supabase is not configured (local development):

```typescript
const DEMO_USER: AuthUser = {
  id: 'demo-user',
  email: 'demo@asaas.local',
  name: 'Demo User',
  role: 'admin',
  workspaceId: 'demo-workspace',
  workspaceCode: 'DEMO-1234'
}
```

App runs fully offline with demo user pre-authenticated.

---

## Supabase Configuration

### Environment Variables

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...your-anon-key
```

### Client Initialization

Location: `src/auth/supabase.ts`

```typescript
import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  {
    auth: {
      autoRefreshToken: true,
      persistSession: true
    }
  }
)

export const isSupabaseConfigured = Boolean(
  import.meta.env.VITE_SUPABASE_URL &&
  import.meta.env.VITE_SUPABASE_ANON_KEY
)
```

---

## Database Triggers

### Auto-Create Profile

When auth.users record is created, trigger inserts into profiles:

```sql
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email, name, role, workspace_id)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'name',
    NEW.raw_user_meta_data->>'role',
    NEW.raw_user_meta_data->>'workspace_id'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION handle_new_user();
```

---

## Security Best Practices

1. **RLS on all tables** - Users only see their workspace data
2. **Passkey validation** - Server-side check during registration
3. **JWT verification** - All API calls include auth header
4. **Session expiry** - Tokens expire after 1 hour, auto-refresh
5. **Secure storage** - Passwords never stored locally
