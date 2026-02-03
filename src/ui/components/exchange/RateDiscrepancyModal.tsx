'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, Button } from '@/ui/components';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, TrendingUp, ArrowRightLeft, BellOff } from 'lucide-react';
import { useExchangeRate } from '@/context/ExchangeRateContext';
import { formatCurrency } from '@/lib/utils';

interface RateDiscrepancyModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onOpenEditor: () => void;
    onOpenSnooze: () => void;
}

export function RateDiscrepancyModal({ open, onOpenChange, onOpenEditor, onOpenSnooze }: RateDiscrepancyModalProps) {
    const { t } = useTranslation();
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
            <DialogContent className="max-w-md rounded-2xl p-0 overflow-hidden border-amber-500/20">
                <DialogHeader className="p-6 border-b bg-amber-500/5 items-center text-center">
                    <div className="w-12 h-12 rounded-full bg-amber-500/10 flex items-center justify-center mb-2">
                        <AlertTriangle className="w-6 h-6 text-amber-600" />
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
                        <div className="p-4 rounded-xl bg-secondary/50 border border-border/50 text-center">
                            <span className="text-xs text-muted-foreground uppercase">{t('exchange.manualEntry')}</span>
                            <div className="text-xl font-bold mt-1">{formatCurrency(manual, 'IQD')}</div>
                        </div>
                        <div className="p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/10 text-center">
                            <span className="text-xs text-emerald-600 uppercase">{t('exchange.marketAvg')}</span>
                            <div className="text-xl font-bold text-emerald-600 mt-1">{formatCurrency(average, 'IQD')}</div>
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
                        className="w-full rounded-xl h-12 bg-amber-500 hover:bg-amber-600"
                        onClick={() => { onOpenChange(false); onOpenEditor(); }}
                    >
                        <TrendingUp className="w-4 h-4 mr-2" />
                        {t('exchange.editManual')}
                    </Button>
                    <Button
                        variant="outline"
                        className="w-full rounded-xl h-12"
                        onClick={handleSwitchToLive}
                    >
                        <ArrowRightLeft className="w-4 h-4 mr-2" />
                        {t('exchange.switchToLive')}
                    </Button>
                    <Button
                        variant="ghost"
                        className="w-full rounded-xl h-11 text-muted-foreground"
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
