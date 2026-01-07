# Database Schema Mapping

The ERP System maintains a mirrored schema between the local **Dexie.js** (IndexedDB) and the remote **Supabase** (PostgreSQL).

## 📊 Core Entities

Across both databases, the following entities share a common structure:

| Entity | Description | Local Table (Dexie) | Remote Table (Supabase) |
| :--- | :--- | :--- | :--- |
| **Products** | Inventory items | `products` | `products` |
| **Customers** | Client information | `customers` | `customers` |
| **Orders** | Sales transactions | `orders` | `orders` |
| **Invoices** | Billing documents | `invoices` | `invoices` |
| **Sync Queue** | Pending mutations | `sync_queue` | N/A |

## 🛠 Common Fields
Every record contains these internal fields for synchronization:
- `id` (UUID): The primary key, consistent across local/remote.
- `version` (Number): Incremented on every local modification.
- `syncStatus` (String): `synced` or `pending`.
- `lastSyncedAt` (ISO Date): Timestamp of the last successful sync.
- `isDeleted` (Boolean): Flag for soft-deletion.
- `workspaceId` (UUID): Foreign key to the workspace.
- `userId` (UUID): Foreign key to the owner.

## 🔗 Table Specifics

### Products
- `sku`, `name`, `price`, `costPrice`, `quantity`, `unit`, `minStockLevel`.

### Customers
- `name`, `email`, `phone`, `address`, `city`, `country`.

### Orders
- `orderNumber`, `customerId`, `items` (JSON), `subtotal`, `tax`, `total`, `status`.

### Invoices
- `invoiceNumber`, `orderId`, `status` (`paid`, `sent`, `overdue`), `dueDate`.

## 🔒 Supabase Specifics
- **Row Level Security (RLS)**: Policies are applied to all tables to ensure users only see data from their own `workspace_id`.
- **Foreign Keys**: Enforced on the remote database for relational integrity (e.g., `orders.customer_id` -> `customers.id`).

---
*Next: See [UI_FRAMEWORK.md](./UI_FRAMEWORK.md) for frontend details.*
