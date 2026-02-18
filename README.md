# Asaas - Offline-First ERP & Point of Sale

[![Version](https://img.shields.io/badge/version-1.6.6-blue.svg)](https://github.com/masteralan360/Asaas/releases)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux%20%7C%20Android%20%7C%20Web-lightgrey.svg)]()
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

A modern, **offline-first** Enterprise Resource Planning and Point-of-Sale system built with Tauri, React, and Supabase

## ✨ Features

- 🛒 **Point of Sale** - Fast checkout with barcode scanning, keyboard navigation
- 📦 **Product Management** - Stock tracking, categories, low-stock alerts
- 💰 **Multi-Currency** - USD, EUR, IQD, TRY with real-time exchange rates
- 📊 **Revenue Analytics** - Net profit, margins, cashier performance
- 🔌 **Offline-First** - Works without internet, syncs when online
- 📱 **Cross-Platform** - Windows, macOS, Linux, Android, Web
- 👥 **Team Management** - Roles, targets, workspace isolation
- 🌍 **Multi-Language** - English, Arabic, Kurdish

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- Rust (for desktop builds)
- Supabase account (optional)

### Installation

```bash
# Clone repository
git clone https://github.com/masteralan360/Asaas.git
cd Asaas

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your Supabase credentials
```

### Development

```bash
# Web development
npm run dev

# Desktop (Tauri)
npm run tauri dev

# Android
npm run android:dev
```

### Production Build

```bash
# Web
npm run build

# Desktop
npm run tauri build

# Android
npm run android:build:release
```

## 📁 Project Structure

```
asaas/
├── src/                    # React application
│   ├── auth/               # Authentication (Supabase)
│   ├── local-db/           # IndexedDB layer (Dexie)
│   ├── sync/               # Cloud sync engine
│   ├── lib/                # Utilities
│   ├── ui/
│   │   ├── components/     # Reusable components
│   │   └── pages/          # Page components
│   └── workspace/          # Workspace management
├── src-tauri/              # Tauri backend (Rust)
├── supabase/               # SQL migrations
├── docs/                   # Documentation
└── public/                 # Static assets
```

## 🛠 Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18, TypeScript, Vite |
| Desktop | Tauri 2.x |
| Styling | Tailwind CSS, shadcn/ui |
| Local DB | Dexie.js (IndexedDB) |
| Cloud | Supabase (PostgreSQL, Auth, Storage) |
| Routing | Wouter |
| i18n | i18next |
| Charts | Recharts |

## 📖 Documentation

Full documentation available in [`/docs`](./docs/):

- [Overview](./docs/OVERVIEW.md) - Architecture and concepts
- [Database](./docs/DATABASE.md) - Schema and models
- [Sync Engine](./docs/SYNC_ENGINE.md) - Offline sync system
- [Authentication](./docs/AUTHENTICATION.md) - Auth and roles
- [Features](./docs/FEATURES.md) - Module documentation
- [API Reference](./docs/API_REFERENCE.md) - Supabase functions
- [Deployment](./docs/DEPLOYMENT.md) - Build and deploy

## 🔐 Security

- Row-Level Security on all database tables
- Workspace isolation with passkey system
- JWT-based authentication
- Encrypted configuration storage

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.

---

Built with ❤️ using [Tauri](https://tauri.app), [React](https://react.dev), and [Supabase](https://supabase.com)
