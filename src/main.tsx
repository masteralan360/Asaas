import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'

import { ThemeProvider } from '@/ui/components/theme-provider'
import './i18n/config'

// Disable right-click context menu in Tauri
// @ts-ignore
if (window.__TAURI_INTERNALS__) {
    document.addEventListener('contextmenu', (e) => e.preventDefault())
}

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme" defaultStyle="modern">
            {/* To set Legacy as default, use: defaultStyle="legacy" */}
            <App />
        </ThemeProvider>
    </StrictMode>,
)
