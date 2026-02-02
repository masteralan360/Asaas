# API Reference

## Supabase Edge Functions

Location: `supabase/functions/`

### Overview

Server-side functions for operations requiring elevated privileges or complex logic.

---

## RPC Functions

These functions are called via `supabase.rpc()`:

### Workspace Management

#### `create_workspace`

Creates a new workspace with passkeys.

```typescript
const { data, error } = await supabase.rpc('create_workspace', {
  p_name: 'My Store',
  p_admin_passkey: 'secret123',
  p_member_passkey: 'member456'
})
```

**Returns**: `{ workspace_id, code }`

---

#### `join_workspace`

Joins an existing workspace.

```typescript
const { data, error } = await supabase.rpc('join_workspace', {
  p_workspace_code: 'ABCD1234',
  p_passkey: 'secret123',
  p_user_id: userId
})
```

**Returns**: `{ success, role }`

---

#### `lock_workspace`

Locks/unlocks a workspace (admin only).

```typescript
await supabase.rpc('lock_workspace', {
  p_workspace_id: workspaceId,
  p_locked: true
})
```

---

### POS Functions

Location: `supabase/pos_functions.sql`

#### `create_sale_with_items`

Atomic sale creation with line items.

```typescript
const { data, error } = await supabase.rpc('create_sale_with_items', {
  p_workspace_id: workspaceId,
  p_cashier_id: userId,
  p_items: [
    { product_id: 'xxx', quantity: 2, unit_price: 10 }
  ],
  p_total_amount: 20,
  p_payment_method: 'cash',
  p_exchange_rate: 1480
})
```

**Returns**: `{ sale_id, sequence_id }`

---

#### `get_next_sequence_id`

Gets next sequential invoice/sale number.

```typescript
const { data } = await supabase.rpc('get_next_sequence_id', {
  p_workspace_id: workspaceId,
  p_type: 'sale' // or 'invoice'
})
// Returns: 42
```

---

### Sales Reports

Location: `supabase/sales_reports_functions.sql`

#### `get_sales_summary`

Aggregated sales data for reporting.

```typescript
const { data } = await supabase.rpc('get_sales_summary', {
  p_workspace_id: workspaceId,
  p_start_date: '2024-01-01',
  p_end_date: '2024-12-31'
})
```

**Returns**:
```typescript
{
  total_sales: number
  total_revenue: number
  total_cost: number
  net_profit: number
  sales_count: number
}
```

---

#### `get_cashier_performance`

Per-cashier metrics.

```typescript
const { data } = await supabase.rpc('get_cashier_performance', {
  p_workspace_id: workspaceId,
  p_start_date: '2024-01-01',
  p_end_date: '2024-12-31'
})
```

---

### Returns Processing

Location: `supabase/sales_returns_functions.sql`

#### `process_sale_return`

Handles full or partial returns.

```typescript
await supabase.rpc('process_sale_return', {
  p_sale_id: saleId,
  p_return_items: [
    { item_id: 'xxx', quantity: 1, reason: 'Defective' }
  ],
  p_is_full_return: false
})
```

---

### Member Management

Location: `supabase/member_functions.sql`

#### `update_member_role`

Changes a user's role.

```typescript
await supabase.rpc('update_member_role', {
  p_target_user_id: userId,
  p_new_role: 'staff'
})
```

---

#### `remove_member`

Kicks a member from workspace.

```typescript
await supabase.rpc('remove_member', {
  p_target_user_id: userId
})
```

---

### Feature Flags

Location: `supabase/feature_flags_functions.sql`

#### `update_workspace_features`

Updates feature flags.

```typescript
await supabase.rpc('update_workspace_features', {
  p_workspace_id: workspaceId,
  p_features: {
    allow_pos: true,
    allow_invoices: true,
    max_discount_percent: 20
  }
})
```

---

## Direct Table Operations

### Products

```typescript
// Create
await supabase.from('products').insert({
  workspace_id: workspaceId,
  sku: 'PROD-001',
  name: 'Widget',
  price: 9.99,
  quantity: 100,
  currency: 'usd'
})

// Read
const { data } = await supabase
  .from('products')
  .select('*')
  .eq('workspace_id', workspaceId)
  .eq('is_deleted', false)

// Update
await supabase
  .from('products')
  .update({ quantity: 50 })
  .eq('id', productId)

// Soft Delete
await supabase
  .from('products')
  .update({ is_deleted: true })
  .eq('id', productId)
```

---

### Sales

```typescript
// Query with items
const { data } = await supabase
  .from('sales')
  .select(`
    *,
    sale_items (
      *,
      products (name, sku)
    )
  `)
  .eq('workspace_id', workspaceId)
  .order('created_at', { ascending: false })
```

---

### Profiles

```typescript
// Get workspace members
const { data } = await supabase
  .from('profiles')
  .select('id, name, email, role, profile_url')
  .eq('workspace_id', workspaceId)
```

---

## Realtime Subscriptions

### Sync Queue (P2P)

```typescript
const channel = supabase
  .channel('sync-queue')
  .on(
    'postgres_changes',
    {
      event: 'INSERT',
      schema: 'public',
      table: 'sync_queue',
      filter: `workspace_id=eq.${workspaceId}`
    },
    (payload) => {
      console.log('New file to sync:', payload.new)
    }
  )
  .subscribe()
```

---

## Storage API

### P2P Sync Bucket

```typescript
// Upload
const { data, error } = await supabase.storage
  .from('p2p-sync')
  .upload(`${workspaceId}/${fileName}`, file)

// Download
const { data } = await supabase.storage
  .from('p2p-sync')
  .download(storagePath)

// Get Public URL
const { data } = supabase.storage
  .from('p2p-sync')
  .getPublicUrl(storagePath)
```

---

## Error Handling

### Standard Pattern

```typescript
const { data, error } = await supabase.rpc('some_function', params)

if (error) {
  console.error('RPC Error:', error.message)
  // error.code, error.details, error.hint available
  throw error
}

return data
```

### Common Error Codes

| Code | Meaning |
|------|---------|
| `PGRST301` | Row-level security violation |
| `23505` | Unique constraint violation |
| `23503` | Foreign key violation |
| `42501` | Insufficient privileges |

---

## Rate Limits

Supabase Free Tier:
- 500 MB database
- 1 GB file storage
- 2 GB bandwidth/month
- 50,000 monthly active users

For production, consider Pro tier or self-hosting.
