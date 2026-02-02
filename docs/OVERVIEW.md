# Asaas Overview

## What is Asaas?

Asaas is an **offline-first Enterprise Resource Planning (ERP) and Point-of-Sale (POS) system** designed for retail businesses. It works fully offline with local data storage and automatically synchronizes with the cloud when connectivity is available.

## Key Features

### 🛒 Point of Sale (POS)
- Fast product lookup via search, SKU, or barcode scanning
- Category-based product filtering
- Multi-currency support (USD, EUR, IQD, TRY)
- Real-time exchange rate integration
- Negotiable pricing with configurable discount limits
- Keyboard navigation for rapid checkout
- Receipt and A4 invoice printing

### 📦 Product Management
- Full CRUD operations for products
- Category organization
- Stock level tracking with low-stock alerts
- Barcode support
- Product image management with P2P sync
- Return rules configuration

### 💰 Sales & Revenue
- Complete sales history with filtering
- Return processing (full or partial)
- Revenue analytics with profit margins
- Date range filtering
- Cashier performance tracking
- System verification for transaction integrity

### 📊 Dashboard & Analytics
- Real-time sales statistics
- Low stock alerts
- Trading time heatmaps
- Team performance metrics
- Revenue trends

### 👥 Team Management
- Multi-user workspaces
- Role-based access (Admin, Staff, Viewer)
- Member invitation via workspace codes
- Monthly sales targets per member

### ⚙️ Settings & Configuration
- Workspace branding (logo, name)
- Currency preferences
- Feature toggles (POS, Invoices, etc.)
- Theme customization (light/dark/system)
- Language selection (English, Arabic, Kurdish)

## Technology Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| **UI Framework** | React 18 + TypeScript | Component-based frontend |
| **Build Tool** | Vite 5 | Fast development and bundling |
| **Desktop Runtime** | Tauri 2.x | Native desktop wrapper |
| **Styling** | Tailwind CSS | Utility-first CSS |
| **Components** | shadcn/ui + Radix | Accessible UI primitives |
| **Local Storage** | Dexie.js (IndexedDB) | Offline data persistence |
| **Cloud Backend** | Supabase | PostgreSQL + Auth + Realtime |
| **Routing** | Wouter | Lightweight hash-based routing |
| **i18n** | i18next | Multi-language support |
| **Charts** | Recharts | Data visualization |

## Platform Support

| Platform | Status | Notes |
|----------|--------|-------|
| Windows | ✅ Production | Auto-update via GitHub releases |
| macOS | ✅ Supported | Requires code signing for distribution |
| Linux | ✅ Supported | AppImage and deb packages |
| Android | ✅ Supported | APK and AAB builds |
| iOS | 🔜 Planned | Tauri iOS target available |
| Web (PWA) | ✅ Supported | Vercel deployment |

## Project Structure

```
asaas/
├── src/                    # React application source
│   ├── auth/               # Authentication (Supabase Auth)
│   ├── context/            # React contexts (ExchangeRate, DateRange)
│   ├── hooks/              # Custom React hooks
│   ├── i18n/               # Internationalization
│   │   └── locales/        # EN, AR, KU translations
│   ├── lib/                # Utilities and managers
│   │   ├── exchangeRate.ts # Multi-source exchange rates
│   │   ├── p2pSyncManager.ts # P2P file synchronization
│   │   └── platform.ts     # Platform detection
│   ├── local-db/           # Dexie database layer
│   │   ├── database.ts     # IndexedDB schema
│   │   ├── hooks.ts        # Data access hooks
│   │   └── models.ts       # TypeScript interfaces
│   ├── sync/               # Cloud sync engine
│   ├── services/           # Platform services
│   ├── ui/
│   │   ├── components/     # Reusable UI components
│   │   └── pages/          # Page-level components
│   └── workspace/          # Workspace context and features
├── src-tauri/              # Tauri backend (Rust)
├── supabase/               # SQL migrations and functions
├── public/                 # Static assets
└── docs/                   # Documentation (you are here)
```

## Core Concepts

### Offline-First Architecture

1. **All writes go to IndexedDB first** - Immediate local persistence
2. **Changes queued as mutations** - Tracked for later sync
3. **Background sync when online** - Pushes mutations, pulls remote changes
4. **Conflict resolution** - Last-write-wins with version tracking

### Workspace Isolation

- Each workspace has a unique ID and invite code
- All data is scoped to `workspace_id`
- Users belong to exactly one workspace
- Supabase RLS enforces isolation at database level

### Multi-Currency Support

- Products priced in their native currency (USD, EUR, IQD, TRY)
- Sales settled in workspace's preferred currency
- Real-time exchange rates from multiple sources
- Historical rate snapshots stored with each sale
