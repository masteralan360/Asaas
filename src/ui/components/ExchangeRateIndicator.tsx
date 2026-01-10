import { RefreshCw, Globe, AlertCircle, Loader2 } from 'lucide-react'
import { useExchangeRate } from '@/context/ExchangeRateContext'
import { useWorkspace } from '@/workspace'
import { cn } from '@/lib/utils'

export function ExchangeRateIndicator() {
    const { exchangeData, eurRates, status, lastUpdated, refresh } = useExchangeRate()
    const { features } = useWorkspace()

    return (
        <div className="flex items-center gap-2">
            <div
                className={cn(
                    'flex items-center gap-2 px-3 py-1.5 rounded-full transition-all border',
                    status === 'live' && 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500',
                    status === 'error' && 'bg-red-500/10 border-red-500/20 text-red-500',
                    status === 'loading' && 'bg-secondary border-border text-muted-foreground'
                )}
            >
                {status === 'loading' ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : status === 'live' ? (
                    <Globe className="w-3.5 h-3.5" />
                ) : (
                    <AlertCircle className="w-3.5 h-3.5" />
                )}

                <div className="text-xs font-bold font-mono flex items-center gap-3">
                    {status === 'live' ? (
                        <>
                            {exchangeData && (
                                <span>USD/IQD: {exchangeData.rate.toLocaleString()}</span>
                            )}
                            {features.eur_conversion_enabled && eurRates.eur_iqd && (
                                <div className="flex items-center gap-3">
                                    <span className="w-px h-3 bg-current/20" />
                                    <span>EUR/IQD: {eurRates.eur_iqd.rate.toLocaleString()}</span>
                                </div>
                            )}
                        </>
                    ) : status === 'loading' ? (
                        <span>Fetching...</span>
                    ) : (
                        <span>Rate Error</span>
                    )}
                </div>

                {status === 'live' && (
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                )}

                {status === 'live' && lastUpdated && (
                    <span className="text-[10px] font-medium opacity-60 ml-0.5">
                        {lastUpdated}
                    </span>
                )}

                {status === 'live' && exchangeData?.isFallback && (
                    <span className="text-xs opacity-70 font-normal ml-1">
                        ({exchangeData.source === 'xeiqd' ? 'XEIQD' : 'EgCurrency'})
                    </span>
                )}
            </div>

            <button
                onClick={refresh}
                disabled={status === 'loading'}
                className={cn(
                    "p-1.5 rounded-lg hover:bg-secondary border border-transparent hover:border-border transition-all group",
                    status === 'loading' && "opacity-50 cursor-not-allowed"
                )}
                title="Refresh Exchange Rate"
            >
                <RefreshCw className={cn(
                    "w-4 h-4 text-muted-foreground group-hover:text-foreground transition-transform",
                    status === 'loading' && "animate-spin"
                )} />
            </button>
        </div >
    )
}
