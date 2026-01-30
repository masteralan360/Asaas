# Asaas Documentation: High-Level Overview

This document provides a comprehensive A-to-Z overview of Asaas, a modern, offline-first enterprise resource planning application.

## 🚀 Tech Stack
- **Frontend**: React (with Vite)
- **State Management**: React Context (for Auth) & Dexie.js (for local state)
- **Database (Local)**: Dexie.js (IndexedDB)
- **Database/Backend (Remote)**: Supabase (PostgreSQL, Auth, RLS)
- **Styling**: Tailwind CSS & Lucide Icons
- **Routing**: Wouter
- **Internationalization**: i18next
- **Language**: TypeScript

## 🏗 System Architecture

The application follows an **Offline-First Multi-Tenant Architecture**. It is designed to be fully functional without an internet connection, synchronizing data to a central Supabase backend when connectivity is available.

### Core Modules
1. **Authentication & Multi-tenancy** (`src/auth`): Handles user sessions, roles (Admin, Staff, Viewer), and workspace isolation.
2. **Offline Database** (`src/local-db`): A persistent local store using Dexie.js that mirrors the Supabase schema.
3. **Sync Engine** (`src/sync`): Orchestrates the bi-directional synchronization between Dexie and Supabase.
4. **UI Layer** (`src/ui`): A responsive, component-based interface with RTL support for Arabic and Kurdish.

### Data Flow
1. **User Action**: The UI calls a hook (e.g., `useProducts`) to perform a mutation.
2. **Local Write**: The mutation is written immediately to **Dexie.js**. The record's `syncStatus` is set to `pending`.
3. **Queueing**: A background task adds the operation to the **Sync Queue**.
4. **Synchronization**: The **Sync Engine** periodically (or on demand) pushes pending changes to **Supabase** and pulls updates from other users in the same workspace.
5. **Reconciliation**: Version control (Last Write Wins) ensures data consistency across devices.

## 📂 Project Structure
- `src/auth/`: Supabase client and AuthContext.
- `src/local-db/`: Dexie schema definition and repository hooks.
- `src/sync/`: Logic for pushing/pulling data and managing the queue.
- `src/ui/`: Components, Layout, and Pages.
- `src/i18n/`: Localization configuration and translation files.
- `supabase/`: SQL migrations, RLS policies, and RPC definitions.

---
*Next: See [AUTH_SYSTEM.md](./AUTH_SYSTEM.md) for detailed authentication logic.*
