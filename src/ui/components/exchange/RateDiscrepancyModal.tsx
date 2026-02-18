'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, Button } from '@/ui/components';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, TrendingUp, ArrowRightLeft, BellOff } from 'lucide-react';
import { useExchangeRate } from '@/context/ExchangeRateContext';
import { useTheme } from '../theme-provider';
import { formatCurrency, cn } from '@/lib/utils';

interface RateDiscrepancyModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onOpenEditor: () => void;
    onOpenSnooze: () => void;
}

export function RateDiscrepancyModal({ open, onOpenChange, onOpenEditor, onOpenSnooze }: RateDiscrepancyModalProps) {
    const { t } = useTranslation();
    const { style } = useTheme();
    const { alerts, refresh } = useExchangeRate();

    if (!alerts.discrepancyData) return null;

    const { pair, manual, average, diff } = alerts.discrepancyData;

    const handleSwitchToLive = async () => {
        // Reset source to default (xeiqd for USD, forexfy for others)
        let key = 'primary_exchange_rate_source';
        let defaultVal = 'xeiqd';

        if (pair.includes('EUR')) {
            key = 'primary_eur_exchange_rate_source';
            defaultVal = 'forexfy';
        } else if (pair.includes('TRY')) {
            key = 'primary_try_exchange_rate_source';
            defaultVal = 'forexfy';
        }

        localStorage.setItem(key, defaultVal);
        await refresh();
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className={cn(
                "max-w-md p-0 overflow-hidden shadow-2xl animate-in zoom-in duration-300",
                style === 'neo-orange' ? "rounded-[var(--radius)] border-2 border-black dark:border-white shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]" : "rounded-2xl border-amber-500/20"
            )}>
                <DialogHeader className="p-6 border-b bg-amber-500/5 items-center text-center">
                    <div className={cn(
                        "w-12 h-12 flex items-center justify-center mb-2",
                        style === 'neo-orange' ? "rounded-none bg-black text-amber-500 border-2 border-amber-500" : "rounded-full bg-amber-500/10"
                    )}>
                        <AlertTriangle className="w-6 h-6" />
                    </div>
                    <DialogTitle className="text-xl text-amber-700">
                        {t('exchange.discrepancyTitle')}
                    </DialogTitle>
                    <DialogDescription className="text-amber-600/70">
                        {t('exchange.discrepancyDesc')}
                    </DialogDescription>
                </DialogHeader>

                <div className="p-6 space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div className={cn(
                            "p-4 text-center border",
                            style === 'neo-orange' ? "rounded-[var(--radius)] border-black dark:border-white bg-white dark:bg-black" : "rounded-xl bg-secondary/50 border-border/50"
                        )}>
                            <span className="text-xs text-muted-foreground uppercase">{t('exchange.manualEntry')}</span>
                            <div className="text-xl font-bold mt-1">{formatCurrency(manual, 'IQD')}</div>
                        </div>
                        <div className={cn(
                            "p-4 text-center border",
                            style === 'neo-orange' ? "rounded-[var(--radius)] border-black dark:border-white bg-emerald-500 text-black" : "rounded-xl bg-emerald-500/5 border-emerald-500/10"
                        )}>
                            <span className={cn("text-xs uppercase", style === 'neo-orange' ? "text-black/70" : "text-emerald-600")}>{t('exchange.marketAvg')}</span>
                            <div className={cn("text-xl font-bold mt-1", style === 'neo-orange' ? "text-black" : "text-emerald-600")}>{formatCurrency(average, 'IQD')}</div>
                        </div>
                    </div>

                    <div className="p-3 rounded-lg bg-red-500/5 border border-red-500/10 flex items-center justify-between">
                        <span className="text-sm font-medium text-red-600">{t('exchange.difference')}</span>
                        <div className="flex items-center gap-1 text-red-600 font-bold">
                            <TrendingUp className="w-4 h-4" />
                            {formatCurrency(diff, 'IQD')}
                        </div>
                    </div>
                </div>

                <div className="p-4 bg-secondary/30 grid grid-cols-1 gap-2">
                    <Button
                        className={cn(
                            "w-full h-12 font-bold",
                            style === 'neo-orange' ? "rounded-[var(--radius)] bg-amber-500 text-black border-2 border-black dark:border-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]" : "rounded-xl bg-amber-500 hover:bg-amber-600"
                        )}
                        onClick={() => { onOpenChange(false); onOpenEditor(); }}
                    >
                        <TrendingUp className="w-4 h-4 mr-2" />
                        {t('exchange.editManual')}
                    </Button>
                    <Button
                        variant="outline"
                        className={cn(
                            "w-full h-12 font-bold",
                            style === 'neo-orange' ? "rounded-[var(--radius)] border-2 border-black dark:border-white" : "rounded-xl"
                        )}
                        onClick={handleSwitchToLive}
                    >
                        <ArrowRightLeft className="w-4 h-4 mr-2" />
                        {t('exchange.switchToLive')}
                    </Button>
                    <Button
                        variant="ghost"
                        className={cn(
                            "w-full h-11 text-muted-foreground",
                            style === 'neo-orange' ? "rounded-[var(--radius)]" : "rounded-xl"
                        )}
                        onClick={() => { onOpenChange(false); onOpenSnooze(); }}
                    >
                        <BellOff className="w-4 h-4 mr-2" />
                        {t('exchange.ignoreSnooze')}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
