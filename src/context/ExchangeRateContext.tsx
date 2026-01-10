import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { fetchUSDToIQDRate, fetchEgRate, type ExchangeRateResult } from '@/lib/exchangeRate'
import { useWorkspace } from '@/workspace'

export interface ExchangeSnapshot {
    rate: number
    source: string
    timestamp: string
}

interface ExchangeRateContextType {
    exchangeData: ExchangeRateResult | null
    eurRates: {
        usd_eur: ExchangeSnapshot | null
        eur_iqd: ExchangeSnapshot | null
    }
    status: 'loading' | 'live' | 'error'
    lastUpdated: string | null
    refresh: () => Promise<void>
}

const ExchangeRateContext = createContext<ExchangeRateContextType | undefined>(undefined)

export function ExchangeRateProvider({ children }: { children: React.ReactNode }) {
    const { features } = useWorkspace()
    const [exchangeData, setExchangeData] = useState<ExchangeRateResult | null>(null)
    const [eurRates, setEurRates] = useState<ExchangeRateContextType['eurRates']>({
        usd_eur: null,
        eur_iqd: null
    })
    const [status, setStatus] = useState<'loading' | 'live' | 'error'>('loading')
    const [lastUpdated, setLastUpdated] = useState<string | null>(null)

    const refresh = useCallback(async () => {
        setStatus('loading')
        try {
            // 1. Fetch USD/IQD (Existing)
            const usdIqdResult = await fetchUSDToIQDRate()
            setExchangeData(usdIqdResult)

            // 2. Fetch EUR rates if enabled
            if (features.eur_conversion_enabled) {
                const timestamp = new Date().toISOString()
                const [usdEurRate, eurIqdRate] = await Promise.all([
                    fetchEgRate('USD-to-EUR'),
                    fetchEgRate('EUR-to-IQD')
                ])

                setEurRates({
                    usd_eur: { rate: usdEurRate, source: 'egcurrency', timestamp },
                    eur_iqd: { rate: eurIqdRate, source: 'egcurrency', timestamp }
                })
            }

            setStatus('live')
            setLastUpdated(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }))
        } catch (error) {
            console.error('ExchangeRateProvider: Failed to fetch rate', error)
            setStatus('error')
        }
    }, [features.eur_conversion_enabled])

    useEffect(() => {
        refresh()
        const interval = setInterval(refresh, 60000) // Refresh every 60 seconds
        return () => clearInterval(interval)
    }, [refresh])

    // listen for manual refresh events from legacy triggers if any
    useEffect(() => {
        const handleRefresh = () => refresh()
        window.addEventListener('exchange-rate-refresh', handleRefresh)
        return () => window.removeEventListener('exchange-rate-refresh', handleRefresh)
    }, [refresh])

    return (
        <ExchangeRateContext.Provider value={{ exchangeData, eurRates, status, lastUpdated, refresh }}>
            {children}
        </ExchangeRateContext.Provider>
    )
}

export function useExchangeRate() {
    const context = useContext(ExchangeRateContext)
    if (context === undefined) {
        throw new Error('useExchangeRate must be used within an ExchangeRateProvider')
    }
    return context
}
