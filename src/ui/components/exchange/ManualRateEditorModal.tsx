'use client';

import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, Button, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/components';
import { useTranslation } from 'react-i18next';
import { Coins, Save, X, Info } from 'lucide-react';
import { useExchangeRate } from '@/context/ExchangeRateContext';

interface ManualRateEditorModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    initialCurrency?: 'USD' | 'EUR' | 'TRY';
}

export function ManualRateEditorModal({ open, onOpenChange, initialCurrency = 'USD' }: ManualRateEditorModalProps) {
    const { t } = useTranslation();
    const { allRates, refresh: refreshRates } = useExchangeRate();
    const [currency, setCurrency] = useState<'USD' | 'EUR' | 'TRY'>(initialCurrency);
    const [rate, setRate] = useState<string>('');
    const inputRef = useRef<HTMLInputElement>(null);
    const cursorPos = useRef<number | null>(null);

    const formatWithCommas = (val: string) => {
        const digits = val.replace(/\D/g, '');
        if (!digits) return '';
        return parseInt(digits).toLocaleString();
    };

    // Fix cursor position after formatting
    useEffect(() => {
        if (inputRef.current && cursorPos.current !== null) {
            inputRef.current.setSelectionRange(cursorPos.current, cursorPos.current);
            cursorPos.current = null;
        }
    });

    useEffect(() => {
        if (open) {
            setCurrency(initialCurrency);
            const savedRate = localStorage.getItem(`manual_rate_${initialCurrency.toLowerCase()}_iqd`) || '';
            setRate(formatWithCommas(savedRate));
        }
    }, [open, initialCurrency]);

    const handleCurrencyChange = (val: string) => {
        const cur = val as 'USD' | 'EUR' | 'TRY';
        setCurrency(cur);
        const saved = localStorage.getItem(`manual_rate_${cur.toLowerCase()}_iqd`) || '';
        setRate(formatWithCommas(saved));
    };

    const handleRateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const target = e.target;
        const rawValue = target.value;
        const digits = rawValue.replace(/\D/g, '');
        const formattedValue = formatWithCommas(digits);

        // Calculate cursor position adjustment
        const originalCursor = target.selectionStart || 0;

        setRate(formattedValue);

        // Simple heuristic for cursor: if we added a comma before the cursor, shift it
        // Or better: just calculate based on length difference if input was at the end
        if (originalCursor === rawValue.length) {
            cursorPos.current = formattedValue.length;
        } else {
            // For middle-string edits, we try to stay at the same character
            // This is complex, but usually, just letting React handle it or shifting corectly works.
            // For now, let's just use length for end-edits and keep selection for others.
            cursorPos.current = originalCursor + (formattedValue.length - rawValue.length);
        }
    };

    const getPlaceholder = () => {
        let avg: number | undefined;
        if (currency === 'USD') avg = allRates?.usd_iqd?.average;
        else if (currency === 'EUR') avg = allRates?.eur_iqd?.average;
        else if (currency === 'TRY') avg = allRates?.try_iqd?.average;

        if (avg) return t('exchange.averagePlaceholder', { rate: avg.toLocaleString() });
        return t('exchange.enterNumber');
    };

    const handleSave = async () => {
        const rateVal = parseInt(rate.replace(/,/g, ''));

        if (isNaN(rateVal) || rateVal <= 0) {
            // If empty or 0, switch back to live source for this currency
            let key = 'primary_exchange_rate_source';
            let defaultLive = 'xeiqd';

            if (currency === 'EUR') {
                key = 'primary_eur_exchange_rate_source';
                defaultLive = 'forexfy';
            } else if (currency === 'TRY') {
                key = 'primary_try_exchange_rate_source';
                defaultLive = 'forexfy';
            }

            localStorage.setItem(key, defaultLive);
            localStorage.removeItem(`manual_rate_${currency.toLowerCase()}_iqd`);

            await refreshRates();
            onOpenChange(false);
            return;
        }

        // Switch to manual source for this currency
        let sourceKey = 'primary_exchange_rate_source';
        if (currency === 'EUR') sourceKey = 'primary_eur_exchange_rate_source';
        else if (currency === 'TRY') sourceKey = 'primary_try_exchange_rate_source';

        localStorage.setItem(sourceKey, 'manual');
        localStorage.setItem(`manual_rate_${currency.toLowerCase()}_iqd`, rateVal.toString());

        // Refresh and close
        await refreshRates();
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md rounded-2xl p-0 overflow-hidden border-emerald-500/20">
                <DialogHeader className="p-6 border-b bg-emerald-500/5 items-start text-start">
                    <DialogTitle className="flex items-center gap-2 text-emerald-600">
                        <Coins className="w-5 h-5" />
                        {t('exchange.manualEntryTitle')}
                    </DialogTitle>
                </DialogHeader>

                <div className="p-6 space-y-6">
                    <div className="space-y-2">
                        <Label>{t('common.currency', 'Currency')}</Label>
                        <Select value={currency} onValueChange={handleCurrencyChange}>
                            <SelectTrigger className="h-12 text-lg">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="USD">USD/IQD</SelectItem>
                                <SelectItem value="EUR">EUR/IQD</SelectItem>
                                <SelectItem value="TRY">TRY/IQD</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-2">
                        <Label>{t('exchange.manualRate')}</Label>
                        <div className="relative">
                            <Input
                                ref={inputRef}
                                value={rate}
                                onChange={handleRateChange}
                                placeholder={getPlaceholder()}
                                className="h-14 text-2xl font-bold tracking-tight pl-4 pr-16"
                                type="text"
                            />
                            <div className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground font-medium">
                                IQD
                            </div>
                        </div>
                        <div className="text-xs text-muted-foreground flex items-start gap-1">
                            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                            <span>{t('exchange.manualRateHint')}</span>
                        </div>
                    </div>
                </div>

                <DialogFooter className="p-4 bg-secondary/30 flex gap-2">
                    <Button variant="ghost" className="flex-1 rounded-xl h-12" onClick={() => onOpenChange(false)}>
                        <X className="w-4 h-4 mr-2" />
                        {t('common.cancel')}
                    </Button>
                    <Button className="flex-1 rounded-xl h-12 bg-emerald-500 hover:bg-emerald-600" onClick={handleSave}>
                        <Save className="w-4 h-4 mr-2" />
                        {t('common.save')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
