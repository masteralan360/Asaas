# ERP System Documentation Index

Welcome to the comprehensive technical documentation for the ERP System. This guide is designed for both human developers and AI agents to understand every aspect of the project.

## 📚 Documentation Modules

### 1. [Overview & Architecture](./OVERVIEW.md)
High-level summary of the system, technical stack, and offline-first architectural patterns.

### 2. [Authentication & Multi-tenancy](./AUTH_SYSTEM.md)
Detailed breakdown of user sessions, roles (Admin, Staff, Viewer), and workspace isolation logic.

### 3. [Sync Engine & Offline Logic](./SYNC_ENGINE.md)
Deep dive into the bi-directional synchronization between Dexie.js and Supabase, including conflict resolution and versioning.
*See also: [Technical Sync Details](./SYNC_DOCUMENTATION.md)*

### 4. [Database Schema](./DATABASE_SCHEMA.md)
Mapping of the mirrored schema between the local IndexedDB (Dexie) and remote PostgreSQL (Supabase).

### 5. [UI Framework & Internationalization](./UI_FRAMEWORK.md)
Guide to the React component library, layout system, and RTL support for Arabic and Kurdish.

### 6. [Security & API Reference](./SECURITY.md)
Documentation of Row Level Security (RLS) policies, Remote Procedure Calls (RPC), and key application hooks.

---

## 🛠 Quick Start for Developers
- Ensure `.env` is configured with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
- Run `npm run dev` to start the local development server.
- Database changes must be applied in the Supabase Dashboard via the SQL Editor.

## 🤖 AI Agent Guidance
This documentation uses standard Markdown. For structural analysis, start with `OVERVIEW.md` and then proceed to the specific module being modified. All core logic follows a clear mapping between `src/` and these documentation files.
