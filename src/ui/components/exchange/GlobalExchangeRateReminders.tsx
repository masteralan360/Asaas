import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useExchangeRate } from '@/context/ExchangeRateContext'
import { useUnifiedSnooze, type SnoozedItem } from '@/context/UnifiedSnoozeContext'

export function GlobalExchangeRateReminders() {
    const { alerts, unsnooze } = useExchangeRate()
    const { registerItems, unregisterItems } = useUnifiedSnooze()
    const { t } = useTranslation()

    const snoozedItems = useMemo<SnoozedItem[]>(() => {
        return alerts.snoozedPairs.map(pair => {
            const data = alerts.allDiscrepancies[pair]
            return {
                id: `exchange-${pair}`,
                type: 'exchange',
                title: pair,
                subtitle: t('exchange.discrepancyTitle') || 'Rate Discrepancy',
                amount: data?.diff,
                currency: 'IQD',
                priority: 'warning',
                onAction: () => {
                    // Trigger manual editor for this currency
                    const currency = pair.split('/')[0]
                    window.dispatchEvent(new CustomEvent('open-manual-rate-editor', { 
                        detail: { currency } 
                    }))
                },
                onUnsnooze: () => {
                    unsnooze()
                }
            }
        })
    }, [alerts.snoozedPairs, alerts.allDiscrepancies, t, unsnooze])

    useEffect(() => {
        if (snoozedItems.length > 0) {
            registerItems('exchange-rates', snoozedItems)
        } else {
            unregisterItems('exchange-rates')
        }
    }, [snoozedItems, registerItems, unregisterItems])

    return null
}
