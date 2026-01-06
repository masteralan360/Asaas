# ERP System - Offline-First Enterprise Resource Planning

A modern, offline-first ERP web application built with React, Vite, and Supabase.

## Features

- 🔌 **Offline-First**: Works fully offline with local IndexedDB storage
- 🔄 **Auto Sync**: Automatically syncs data when online
- 🔐 **Authentication**: Supabase Auth with role-based access
- 📦 **Inventory Management**: Products with stock tracking
- 👥 **Customer Management**: Full customer database
- 🛒 **Order Management**: Create and track orders
- 📄 **Invoice Generation**: Generate invoices from orders
- 📱 **PWA Ready**: Installable as a Progressive Web App

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite
- **Styling**: Tailwind CSS, shadcn/ui
- **Local Storage**: Dexie.js (IndexedDB)
- **Cloud Sync**: Supabase (PostgreSQL + Auth)
- **Routing**: Wouter
- **PWA**: vite-plugin-pwa

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Create a `.env` file:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key
```

> If you don't have Supabase configured, the app runs in demo mode with local-only storage.

### 3. Set Up Supabase (Optional)

Run the SQL files in your Supabase SQL Editor:
1. `supabase/schema.sql` - Creates tables
2. `supabase/rls-policies.sql` - Sets up Row Level Security

### 4. Start Development Server

```bash
npm run dev
```

Visit `http://localhost:5173`

## Project Structure

```
src/
├── auth/           # Authentication (Supabase)
├── local-db/       # IndexedDB layer (Dexie)
├── sync/           # Sync engine
├── ui/
│   ├── components/ # Reusable UI components
│   └── pages/      # Page components
├── lib/            # Utilities
├── App.tsx         # Main app component
└── main.tsx        # Entry point
```

## Modules

### Dashboard
- Overview statistics
- Recent orders
- Low stock alerts
- Pending invoices

### Products
- CRUD operations
- Category management
- Stock tracking
- Low stock warnings

### Customers
- Customer database
- Contact information
- Order history tracking

### Orders
- Create orders with products
- Status management
- Customer association

### Invoices
- Generate from orders
- Status tracking (draft, sent, paid, overdue)
- Revenue tracking

## Offline Capabilities

All data is stored locally in IndexedDB. When online, the app syncs with Supabase:

1. **Create/Update/Delete** → Immediate local write, queued for sync
2. **Online Detection** → Auto-sync when connection restored
3. **Conflict Resolution** → Last-write-wins strategy

## Building for Production

```bash
npm run build
```

Deploy the `dist` folder to Vercel, Netlify, or any static host.

## License

MIT
