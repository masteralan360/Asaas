import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { fetchUSDToIQDRate, fetchEURToIQDRate, fetchTRYToIQDRate, fetchRatesFromAllSources, type ExchangeRateResult } from '@/lib/exchangeRate'
import { useWorkspace } from '@/workspace'
import { useNetworkStatus } from '@/hooks/useNetworkStatus'

export interface ExchangeSnapshot {
    rate: number
    source: string
    timestamp: string
    isFallback: boolean
}

interface ExchangeRateContextType {
    exchangeData: ExchangeRateResult | null
    eurRates: {
        usd_eur: ExchangeSnapshot | null
        eur_iqd: ExchangeSnapshot | null
    }
    tryRates: {
        usd_try: ExchangeSnapshot | null
        try_iqd: ExchangeSnapshot | null
    }
    status: 'loading' | 'live' | 'error'
    lastUpdated: string | null
    allRates: any | null // Average baseline data
    refresh: () => Promise<void>
    alerts: {
        hasDiscrepancy: boolean
        discrepancyData: {
            pair: string
            manual: number
            average: number
            diff: number
        } | null
        snoozedPairs: string[]
        allDiscrepancies: Record<string, { pair: string; manual: number; average: number; diff: number }>
    }
    snooze: (minutes: number) => void
    forceAlert: (pair: string | null) => void
}

const ExchangeRateContext = createContext<ExchangeRateContextType | undefined>(undefined)

export function ExchangeRateProvider({ children }: { children: React.ReactNode }) {
    const { features } = useWorkspace()
    const [exchangeData, setExchangeData] = useState<ExchangeRateResult | null>(null)
    const [eurRates, setEurRates] = useState<ExchangeRateContextType['eurRates']>({
        usd_eur: null,
        eur_iqd: null
    })
    const [tryRates, setTryRates] = useState<ExchangeRateContextType['tryRates']>({
        usd_try: null,
        try_iqd: null
    })
    const [status, setStatus] = useState<'loading' | 'live' | 'error'>('loading')
    const [lastUpdated, setLastUpdated] = useState<string | null>(null)
    const [allRates, setAllRates] = useState<any | null>(null)
    const [alert, setAlert] = useState<ExchangeRateContextType['alerts']>({
        hasDiscrepancy: false,
        discrepancyData: null,
        snoozedPairs: [],
        allDiscrepancies: {}
    })

    const isOnline = useNetworkStatus()

    // Force error status if offline
    const effectiveStatus = !isOnline ? 'error' : status

    const refresh = useCallback(async () => {
        setStatus('loading')
        try {
            // 1. Fetch USD/IQD (Existing)
            const usdIqdResult = await fetchUSDToIQDRate()
            setExchangeData(usdIqdResult)

            // 2. Fetch EUR rates if enabled
            if (features.eur_conversion_enabled) {
                try {
                    const eurResult = await fetchEURToIQDRate()
                    const timestamp = new Date().toISOString()

                    setEurRates({
                        usd_eur: { rate: eurResult.usdEur, source: eurResult.source, timestamp, isFallback: eurResult.isFallback },
                        eur_iqd: { rate: eurResult.eurIqd, source: eurResult.source, timestamp, isFallback: eurResult.isFallback }
                    })
                } catch (error) {
                    console.error('ExchangeRateProvider: Failed to fetch EUR rates', error)
                }
            }

            // 3. Fetch TRY rates if enabled
            if (features.try_conversion_enabled) {
                try {
                    // We need to import fetchTRYToIQDRate
                    const tryResult = await fetchTRYToIQDRate()
                    const timestamp = new Date().toISOString()

                    setTryRates({
                        usd_try: { rate: tryResult.usdTry, source: tryResult.source, timestamp, isFallback: tryResult.isFallback },
                        try_iqd: { rate: tryResult.tryIqd, source: tryResult.source, timestamp, isFallback: tryResult.isFallback }
                    })
                } catch (error) {
                    console.error('ExchangeRateProvider: Failed to fetch TRY rates', error)
                }
            }

            // 4. Validation Check (Average of all sources)
            const all = await fetchRatesFromAllSources()
            setAllRates(all)

            // 5. Discrepancy Monitoring
            const checkDiscrepancy = () => {
                const threshold = parseInt(localStorage.getItem('exchange_rate_threshold') || '2500')
                const snoozeUntil = localStorage.getItem('exchange_rate_snooze_until')
                const isGloballySnoozed = snoozeUntil && new Date().getTime() < parseInt(snoozeUntil)

                const pairs = [
                    { key: 'usd_iqd', label: 'USD/IQD', manualKey: 'manual_rate_usd_iqd', sourceKey: 'primary_exchange_rate_source' },
                    { key: 'eur_iqd', label: 'EUR/IQD', manualKey: 'manual_rate_eur_iqd', sourceKey: 'primary_eur_exchange_rate_source' },
                    { key: 'try_iqd', label: 'TRY/IQD', manualKey: 'manual_rate_try_iqd', sourceKey: 'primary_try_exchange_rate_source' }
                ]

                const activeSnoozed: string[] = []
                const allDiscreps: Record<string, any> = {}
                let activeAlert: any = null

                for (const p of pairs) {
                    if (localStorage.getItem(p.sourceKey) === 'manual') {
                        const manualVal = parseInt(localStorage.getItem(p.manualKey) || '0')
                        const avgVal = all[p.key as keyof typeof all]?.average
                        if (manualVal > 0 && avgVal && Math.abs(manualVal - avgVal) > threshold) {
                            const data = {
                                pair: p.label,
                                manual: manualVal,
                                average: avgVal,
                                diff: Math.abs(manualVal - avgVal)
                            }
                            allDiscreps[p.label] = data

                            if (isGloballySnoozed) {
                                activeSnoozed.push(p.label)
                            } else if (!activeAlert) {
                                activeAlert = data
                            }
                        }
                    }
                }

                setAlert(prev => ({
                    ...prev,
                    hasDiscrepancy: !!activeAlert,
                    discrepancyData: activeAlert,
                    snoozedPairs: activeSnoozed,
                    allDiscrepancies: allDiscreps
                }))
            }

            checkDiscrepancy()

            setStatus('live')
            setLastUpdated(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }))
        } catch (error) {
            console.error('ExchangeRateProvider: Failed to fetch rate', error)
            setStatus('error')
        }
    }, [features.eur_conversion_enabled, features.try_conversion_enabled])

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

    const snooze = (minutes: number) => {
        const until = new Date().getTime() + minutes * 60 * 1000
        localStorage.setItem('exchange_rate_snooze_until', until.toString())

        // Update local state immediately to move discrepancy to snoozedPairs
        // We can just trigger a refresh or manually update alert state
        refresh();
    }

    const forceAlert = (pair: string | null) => {
        if (!pair) {
            setAlert(prev => ({ ...prev, hasDiscrepancy: false, discrepancyData: null }))
            return
        }

        const data = alert.allDiscrepancies[pair]
        if (data) {
            setAlert(prev => ({ ...prev, hasDiscrepancy: true, discrepancyData: data }))
        }
    }

    return (
        <ExchangeRateContext.Provider value={{ exchangeData, eurRates, tryRates, status: effectiveStatus, lastUpdated, refresh, allRates, alerts: alert, snooze, forceAlert }}>
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
