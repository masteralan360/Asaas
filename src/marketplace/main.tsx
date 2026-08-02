import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import '../index.css'
import '../i18n/config'

import { Toaster } from '@/ui/components'
import { MarketplaceApp } from './MarketplaceApp'
import { MarketplaceThemeRoot } from './MarketplaceThemeRoot'

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <MarketplaceThemeRoot>
            <MarketplaceApp />
            <Toaster />
        </MarketplaceThemeRoot>
    </StrictMode>
)
