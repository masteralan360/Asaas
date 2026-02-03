import { useState } from 'react'
import { RefreshCw, Globe, AlertCircle, Loader2, Calculator, Coins, X, Pencil } from 'lucide-react'
import { useLocation } from 'wouter'
import { useExchangeRate } from '@/context/ExchangeRateContext'
import { useWorkspace } from '@/workspace'
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger
} from './dialog'
import { Button } from './button'


export function ExchangeRateList({ isMobile = false }: { isMobile?: boolean }) {
    const { exchangeData, eurRates, tryRates, status, lastUpdated, allRates } = useExchangeRate()
    const { features } = useWorkspace()
    const { t } = useTranslation()

    return (
        <div className={cn(
            "flex items-center gap-2 px-3 py-1.5 rounded-full transition-all border w-fit",
            status === 'live' && 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500',
            status === 'error' && 'bg-red-500/10 border-red-500/20 text-red-500',
            status === 'loading' && 'bg-secondary border-border text-muted-foreground',
            isMobile && "flex-col items-start rtl:items-start rounded-xl p-2 w-full gap-2 border-none bg-transparent"
        )}>
            <div className="flex items-center gap-2">
                {status === 'loading' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                ) : status === 'live' ? (
                    <Globe className="w-4 h-4" />
                ) : (
                    <AlertCircle className="w-4 h-4" />
                )}
                {isMobile && <span className="font-bold text-sm uppercase tracking-wider">{t('common.exchangeRates')}</span>}
            </div>

            <div className={cn(
                "text-xs font-bold font-mono flex items-center gap-3",
                isMobile && "flex-col items-start rtl:items-start text-base w-full gap-4"
            )}>
                {status === 'live' ? (
                    <>
                        {exchangeData && (
                            <div className={cn("flex items-center gap-2", isMobile && "w-full justify-between p-3 rounded-xl hover:bg-emerald-500/5 transition-colors")}>
                                <div className="flex flex-col items-start gap-1">
                                    <span>USD/IQD: {exchangeData.rate.toLocaleString()}</span>
                                    {isMobile && allRates?.usd_iqd?.average && (
                                        <span className="text-[10px] text-muted-foreground">{t('exchange.marketAverage')}: {allRates.usd_iqd.average.toLocaleString()}</span>
                                    )}
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-[10px] opacity-70 font-normal uppercase">
                                        {exchangeData.source === 'manual' ? t('exchange.manual') : exchangeData.source}
                                    </span>
                                    {isMobile && (
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8 rounded-full"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                window.dispatchEvent(new CustomEvent('open-manual-rate-editor', { detail: { currency: 'USD' } }));
                                            }}
                                        >
                                            <Pencil className="w-3.5 h-3.5" />
                                        </Button>
                                    )}
                                </div>
                            </div>
                        )}
                        {features.eur_conversion_enabled && eurRates.eur_iqd && (
                            <div className={cn("flex items-center gap-3", isMobile && "w-full justify-between p-3 border-t border-emerald-500/10 rounded-xl hover:bg-emerald-500/5 transition-colors")}>
                                {!isMobile && <span className="w-px h-3 bg-current/20" />}
                                <div className="flex flex-col items-start gap-1">
                                    <span>EUR/IQD: {eurRates.eur_iqd.rate.toLocaleString()}</span>
                                    {isMobile && allRates?.eur_iqd?.average && (
                                        <span className="text-[10px] text-muted-foreground">{t('exchange.marketAverage')}: {allRates.eur_iqd.average.toLocaleString()}</span>
                                    )}
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-[10px] opacity-70 font-normal uppercase">
                                        {eurRates.eur_iqd.source === 'manual' ? t('exchange.manual') : eurRates.eur_iqd.source}
                                    </span>
                                    {isMobile && (
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8 rounded-full"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                window.dispatchEvent(new CustomEvent('open-manual-rate-editor', { detail: { currency: 'EUR' } }));
                                            }}
                                        >
                                            <Pencil className="w-3.5 h-3.5" />
                                        </Button>
                                    )}
                                </div>
                            </div>
                        )}
                        {features.try_conversion_enabled && tryRates.try_iqd && (
                            <div className={cn("flex items-center gap-3", isMobile && "w-full justify-between p-3 border-t border-emerald-500/10 rounded-xl hover:bg-emerald-500/5 transition-colors")}>
                                {!isMobile && <span className="w-px h-3 bg-current/20" />}
                                <div className="flex flex-col items-start gap-1">
                                    <span>TRY/IQD: {tryRates.try_iqd.rate.toLocaleString()}</span>
                                    {isMobile && allRates?.try_iqd?.average && (
                                        <span className="text-[10px] text-muted-foreground">{t('exchange.marketAverage')}: {allRates.try_iqd.average.toLocaleString()}</span>
                                    )}
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-[10px] opacity-70 font-normal uppercase">
                                        {tryRates.try_iqd.source === 'manual' ? t('exchange.manual') : tryRates.try_iqd.source}
                                    </span>
                                    {isMobile && (
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8 rounded-full"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                window.dispatchEvent(new CustomEvent('open-manual-rate-editor', { detail: { currency: 'TRY' } }));
                                            }}
                                        >
                                            <Pencil className="w-3.5 h-3.5" />
                                        </Button>
                                    )}
                                </div>
                            </div>
                        )}
                    </>
                ) : status === 'loading' ? (
                    <span>{t('common.loading')}</span>
                ) : (
                    <span>{t('common.error')}</span>
                )}
            </div>

            <div className={cn("flex items-center gap-2", isMobile && "mt-auto w-full pt-4 border-t border-emerald-500/20 justify-between")}>
                {status === 'live' && (
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                )}

                {status === 'live' && lastUpdated && (
                    <span className="text-[10px] font-medium opacity-60">
                        {lastUpdated}
                    </span>
                )}
            </div>
        </div>
    )
}

export function ExchangeRateIndicator() {
    const [, setLocation] = useLocation()
    const { status, refresh } = useExchangeRate()
    const { t, i18n } = useTranslation()
    const [isOpen, setIsOpen] = useState(false)
    const direction = i18n.dir()

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <div className="flex items-center gap-2">
                {/* Desktop View */}
                <div className="hidden md:flex items-center gap-2">
                    <button
                        onClick={() => setLocation('/currency-converter')}
                        className="p-1.5 rounded-lg hover:bg-secondary border border-transparent hover:border-border transition-all group"
                        title="Currency Converter"
                    >
                        <Calculator className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                    </button>

                    <DialogTrigger asChild>
                        <div className="cursor-pointer hover:opacity-80 transition-opacity">
                            <ExchangeRateList />
                        </div>
                    </DialogTrigger>

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
                </div>

                {/* Mobile View */}
                <div className="md:hidden">
                    <DialogTrigger asChild>
                        <Button
                            variant="outline"
                            size="sm"
                            className={cn(
                                "flex items-center gap-2 h-9 px-3 rounded-full border-emerald-500/20 bg-emerald-500/5 text-emerald-500 hover:bg-emerald-500/10 hover:text-emerald-600 transition-all",
                                status === 'loading' && "opacity-70 animate-pulse",
                                status === 'error' && "border-red-500/20 bg-red-500/5 text-red-500 hover:text-red-600"
                            )}
                        >
                            <Globe className={cn("w-4 h-4", status === 'loading' && "animate-spin")} />
                            <span className="text-xs font-bold uppercase tracking-tight">Live Rate</span>
                        </Button>
                    </DialogTrigger>
                </div>
            </div>

            <DialogContent dir={direction} className="max-w-[calc(100vw-2rem)] sm:max-w-md rounded-2xl p-0 overflow-hidden border-emerald-500/20 shadow-2xl animate-in zoom-in duration-300">
                <DialogHeader className="p-6 border-b bg-emerald-500/5 items-start rtl:items-start text-start rtl:text-start relative overflow-hidden">
                    {/* Decorative background for modal header */}
                    <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/10 rounded-full -mr-12 -mt-12 blur-2xl" />

                    <DialogTitle className="flex items-center gap-2 text-emerald-600 font-black tracking-tight text-xl">
                        <Coins className="w-6 h-6" />
                        {t('common.exchangeRates')}
                    </DialogTitle>
                </DialogHeader>

                <div className="p-2">
                    <ExchangeRateList isMobile />
                </div>

                <div className="p-4 bg-secondary/30 flex flex-col gap-2 border-t">
                    <div className="flex gap-2 w-full">
                        <Button
                            variant="outline"
                            className="flex-1 rounded-xl h-11 font-bold shadow-sm"
                            onClick={() => {
                                setIsOpen(false)
                                setLocation('/currency-converter')
                            }}
                        >
                            <Calculator className="w-4 h-4 mr-2 opacity-60" />
                            Converter
                        </Button>
                        <Button
                            className="flex-1 rounded-xl h-11 bg-emerald-500 hover:bg-emerald-600 text-white font-black shadow-lg shadow-emerald-500/20"
                            onClick={() => refresh()}
                            disabled={status === 'loading'}
                        >
                            <RefreshCw className={cn("w-4 h-4 mr-2", status === 'loading' && "animate-spin")} />
                            {t('common.refresh')}
                        </Button>
                    </div>
                    <Button
                        variant="ghost"
                        className="w-full text-muted-foreground h-10 hover:bg-transparent"
                        onClick={() => setIsOpen(false)}
                    >
                        <X className="w-4 h-4 mr-2 opacity-40" />
                        {t('common.done')}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}
