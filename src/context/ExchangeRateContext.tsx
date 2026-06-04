import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { fetchUSDToIQDRate, fetchEURToIQDRate, fetchTRYToIQDRate, fetchRatesFromAllSources, type ExchangeRateResult } from '@/lib/exchangeRate'
import { buildOrderExchangeRatesSnapshot, cacheExchangeRatesSnapshot } from '@/lib/orderCurrency'
import { useWorkspace } from '@/workspace'
import { useNetworkStatus } from '@/hooks/useNetworkStatus'
import { formatTime } from '@/lib/utils'
import { cleanupExpiredManualRates, getManualRateSource, getManualRateValue } from '@/lib/manualExchangeRates'

export interface ExchangeSnapshot {
    rate: number
    source: string
    timestamp: string
    isFallback: boolean
}

export type CurrencyStatus = 'loading' | 'live' | 'error' | 'manual'

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
    currencyStatus: {
        usd: CurrencyStatus
        eur: CurrencyStatus
        try: CurrencyStatus
    }
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
    unsnooze: () => void
    forceAlert: (pair: string | null) => void
}

const ExchangeRateContext = createContext<ExchangeRateContextType | undefined>(undefined)

export function ExchangeRateProvider({ children }: { children: React.ReactNode }) {
    const { features } = useWorkspace()
    const multiCurrencyEnabled = features.allowed_currencies.length > 1
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
    const [currencyStatus, setCurrencyStatus] = useState<ExchangeRateContextType['currencyStatus']>({
        usd: 'loading',
        eur: 'loading',
        try: 'loading'
    })
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

    useEffect(() => {
        const snapshot = buildOrderExchangeRatesSnapshot({
            exchangeData,
            eurRates,
            tryRates
        })
        cacheExchangeRatesSnapshot(snapshot)
    }, [exchangeData, eurRates, tryRates])

    const refresh = useCallback(async () => {
        if (!multiCurrencyEnabled) {
            setExchangeData(null)
            setEurRates({ usd_eur: null, eur_iqd: null })
            setTryRates({ usd_try: null, try_iqd: null })
            setAllRates(null)
            setAlert({
                hasDiscrepancy: false,
                discrepancyData: null,
                snoozedPairs: [],
                allDiscrepancies: {}
            })
            setCurrencyStatus({ usd: 'live', eur: 'live', try: 'live' })
            setStatus('live')
            return
        }

        // Optimization: Strictly disable fetching for remote KDS clients
        // Check both port 4004 and the specific route to be absolutely sure
        // @ts-ignore
        const isRemoteKds = typeof window !== 'undefined' && (window.location.port === '4004' || window.location.hash.includes('/kds/local') || !window.__TAURI_INTERNALS__)
        
        // However, we only want to block if it's NOT in Tauri AND it's a KDS-related environment
        // @ts-ignore
        if (!window.__TAURI_INTERNALS__ && (window.location.port === '4004' || window.location.hash.includes('/kds/local'))) {
            console.log('[ExchangeRate] Remote KDS detected - skipping sync.')
            setStatus('live')
            return
        }

        setStatus('loading')
        setCurrencyStatus({ usd: 'loading', eur: 'loading', try: 'loading' })
        cleanupExpiredManualRates()

        // Only clear rates whose manual source was removed — preserve cached live rates
        const usdSource = getManualRateSource('USD')
        const eurSource = getManualRateSource('EUR')
        const trySource = getManualRateSource('TRY')

        setExchangeData(prev => {
            if (prev && prev.source === 'manual' && usdSource !== 'manual') return null
            return prev
        })
        setEurRates(prev => {
            if (prev.eur_iqd && prev.eur_iqd.source === 'manual' && eurSource !== 'manual') return { usd_eur: null, eur_iqd: null }
            return prev
        })
        setTryRates(prev => {
            if (prev.try_iqd && prev.try_iqd.source === 'manual' && trySource !== 'manual') return { usd_try: null, try_iqd: null }
            return prev
        })

        let usdSuccess = false
        let eurSuccess = false
        let trySuccess = false

        // 1. Fetch USD/IQD
        try {
            // Check if manual rate is set
            const usdSource = getManualRateSource('USD')
            if (usdSource === 'manual') {
                const manualRate = getManualRateValue('USD')
                if (manualRate > 0) {
                    setExchangeData({ rate: manualRate, source: 'manual', isFallback: false })
                    usdSuccess = true
                }
            }

            if (!usdSuccess) {
                const usdIqdResult = await fetchUSDToIQDRate()
                setExchangeData(usdIqdResult)
                usdSuccess = true
            }
        } catch (error) {
            console.error('ExchangeRateProvider: Failed to fetch USD/IQD rate', error)
            // Check if we have a manual fallback
            const manualRate = getManualRateValue('USD')
            if (manualRate > 0) {
                setExchangeData({ rate: manualRate, source: 'manual', isFallback: true })
                usdSuccess = true
            }
        }

        // 2. Fetch EUR rates if enabled
        if (features.allowed_currencies.includes('eur')) {
            try {
                const eurSource = getManualRateSource('EUR')
                if (eurSource === 'manual') {
                    const manualRate = getManualRateValue('EUR')
                    if (manualRate > 0) {
                        const timestamp = new Date().toISOString()
                        setEurRates({
                            usd_eur: { rate: 0, source: 'manual', timestamp, isFallback: false },
                            eur_iqd: { rate: manualRate, source: 'manual', timestamp, isFallback: false }
                        })
                        eurSuccess = true
                    }
                }

                if (!eurSuccess) {
                    const eurResult = await fetchEURToIQDRate()
                    const timestamp = new Date().toISOString()
                    setEurRates({
                        usd_eur: { rate: eurResult.usdEur, source: eurResult.source, timestamp, isFallback: eurResult.isFallback },
                        eur_iqd: { rate: eurResult.eurIqd, source: eurResult.source, timestamp, isFallback: eurResult.isFallback }
                    })
                    eurSuccess = true
                }
            } catch (error) {
                console.error('ExchangeRateProvider: Failed to fetch EUR rates', error)
                // Check for manual fallback
                const manualRate = getManualRateValue('EUR')
                if (manualRate > 0) {
                    const timestamp = new Date().toISOString()
                    setEurRates({
                        usd_eur: { rate: 0, source: 'manual', timestamp, isFallback: true },
                        eur_iqd: { rate: manualRate, source: 'manual', timestamp, isFallback: true }
                    })
                    eurSuccess = true
                }
            }
        } else {
            eurSuccess = true // Not enabled, so not an error
        }

        // 3. Fetch TRY rates if enabled
        if (features.allowed_currencies.includes('try')) {
            try {
                const trySource = getManualRateSource('TRY')
                if (trySource === 'manual') {
                    const manualRate = getManualRateValue('TRY')
                    if (manualRate > 0) {
                        const timestamp = new Date().toISOString()
                        setTryRates({
                            usd_try: { rate: 0, source: 'manual', timestamp, isFallback: false },
                            try_iqd: { rate: manualRate, source: 'manual', timestamp, isFallback: false }
                        })
                        trySuccess = true
                    }
                }

                if (!trySuccess) {
                    const tryResult = await fetchTRYToIQDRate()
                    const timestamp = new Date().toISOString()
                    setTryRates({
                        usd_try: { rate: tryResult.usdTry, source: tryResult.source, timestamp, isFallback: tryResult.isFallback },
                        try_iqd: { rate: tryResult.tryIqd, source: tryResult.source, timestamp, isFallback: tryResult.isFallback }
                    })
                    trySuccess = true
                }
            } catch (error) {
                console.error('ExchangeRateProvider: Failed to fetch TRY rates', error)
                // Check for manual fallback
                const manualRate = getManualRateValue('TRY')
                if (manualRate > 0) {
                    const timestamp = new Date().toISOString()
                    setTryRates({
                        usd_try: { rate: 0, source: 'manual', timestamp, isFallback: true },
                        try_iqd: { rate: manualRate, source: 'manual', timestamp, isFallback: true }
                    })
                    trySuccess = true
                }
            }
        } else {
            trySuccess = true // Not enabled, so not an error
        }

        // Update per-currency status
        const getStatus = (success: boolean, source: string | null): CurrencyStatus => {
            if (!success) return 'error'
            if (source === 'manual') return 'manual'
            return 'live'
        }

        setCurrencyStatus({
            usd: getStatus(usdSuccess, getManualRateSource('USD')),
            eur: getStatus(eurSuccess, getManualRateSource('EUR')),
            try: getStatus(trySuccess, getManualRateSource('TRY'))
        })

        // 4. Validation Check (Average of all sources) - best effort
        let all: any = null
        try {
            all = await fetchRatesFromAllSources()
            setAllRates(all)
        } catch (e) {
            console.error('Failed to fetch all rates for validation', e)
        }

        // 5. Discrepancy Monitoring
        if (all) {
            const checkDiscrepancy = () => {
                const threshold = parseInt(localStorage.getItem('exchange_rate_threshold') || '2500')
                const snoozeUntil = localStorage.getItem('exchange_rate_snooze_until')
                const isGloballySnoozed = snoozeUntil && new Date().getTime() < parseInt(snoozeUntil)

                const pairs = [
                    { key: 'usd_iqd', label: 'USD/IQD', currency: 'USD' as const },
                    { key: 'eur_iqd', label: 'EUR/IQD', currency: 'EUR' as const },
                    { key: 'try_iqd', label: 'TRY/IQD', currency: 'TRY' as const }
                ]

                const activeSnoozed: string[] = []
                const allDiscreps: Record<string, any> = {}
                let activeAlert: any = null

                for (const p of pairs) {
                    if (getManualRateSource(p.currency) === 'manual') {
                        const manualVal = getManualRateValue(p.currency)
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
        }

        // Determine global status: live if at least USD works, partial if some fail, error if all fail
        if (usdSuccess) {
            setStatus('live')
        } else {
            setStatus('error')
        }
        setLastUpdated(formatTime(new Date()))
    }, [features.allowed_currencies, multiCurrencyEnabled])

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
        refresh();
    }

    const unsnooze = () => {
        localStorage.removeItem('exchange_rate_snooze_until')
        refresh()
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
        <ExchangeRateContext.Provider value={{ exchangeData, eurRates, tryRates, status: effectiveStatus, currencyStatus, lastUpdated, refresh, allRates, alerts: alert, snooze, unsnooze, forceAlert }}>
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
