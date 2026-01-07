# UI Framework & Internationalization

The ERP System's frontend is a responsive, accessibility-conscious React application built for a global audience, with deep support for RTL (Right-to-Left) languages.

## 🎨 UI Architecture

- **Layout System**: The `Layout` component provides a consistent sidebar and navigation structure. It dynamically handles the RTL/LTR switch based on the current language.
- **Component Library**: Custom-built components (Button, Card, Dialog, Select, etc.) are used for a premium, consistent aesthetic. They leverage **Tailwind CSS** for styling and **Lucide** for iconography.
- **Theming**: A flexible system supporting **Light**, **Dark**, and **System** themes, managed via `ThemeToggle` and a dedicated `ThemeProvider`.

## 🌍 Internationalization (i18n)

The system is fully localized into three languages:
1. **English (en)**: Default Western locale (LTR).
2. **Arabic (ar)**: Middle-Eastern locale (RTL).
3. **Kurdish (ku)**: Regional locale (RTL).

### 🛠 Implementation
- **Library**: `react-i18next`.
- **Logic**: The app detects the language and automatically flips the document direction (`dir="rtl"`) and updates fonts (e.g., using specialized Arabic/Kurdish typographic weights).
- **Translations**: JSON-based locale files located in `src/i18n/locales/`.

## � Key Pages & Routing

- **Dashboard**: High-level business metrics and recent activity.
- **Modules**: CRUD interfaces for Products, Customers, Orders, and Invoices.
- **Settings**: Account information, appearance, language, and local data management.
- **Admin**: A restricted dashboard for system-level user management and deletion.

---
*Next: See [SECURITY.md](./SECURITY.md) for data protection details.*
