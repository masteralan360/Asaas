'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, Button } from '@/ui/components';
import { useTranslation } from 'react-i18next';
import { BellOff, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useExchangeRate } from '@/context/ExchangeRateContext';
import { useTheme } from '../theme-provider';

interface SnoozeSelectionModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function SnoozeSelectionModal({ open, onOpenChange }: SnoozeSelectionModalProps) {
    const { t } = useTranslation();
    const { style } = useTheme();
    const { snooze } = useExchangeRate();
    const [selectedMinutes, setSelectedMinutes] = useState<number>(0);

    const options = [
        { label: t('exchange.snooze.ignore'), value: 0 },
        { label: t('exchange.snooze.15m'), value: 15 },
        { label: t('exchange.snooze.30m'), value: 30 },
        { label: t('exchange.snooze.2h'), value: 120 },
        { label: t('exchange.snooze.6h'), value: 360 },
        { label: t('exchange.snooze.24h'), value: 1440 },
    ];

    const handleConfirm = () => {
        if (selectedMinutes > 0) {
            snooze(selectedMinutes);
        }
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className={cn(
                "max-w-sm p-0 overflow-hidden",
                style === 'neo-orange' ? "rounded-[var(--radius)] border-2 border-black dark:border-white shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]" : "rounded-2xl"
            )}>
                <DialogHeader className="p-6 border-b bg-secondary/5 items-center text-center">
                    <div className={cn(
                        "w-12 h-12 flex items-center justify-center mb-2",
                        style === 'neo-orange' ? "rounded-none bg-black text-white border-2 border-white" : "rounded-full bg-secondary/10"
                    )}>
                        <BellOff className="w-6 h-6" />
                    </div>
                    <DialogTitle>{t('exchange.snoozeTitle')}</DialogTitle>
                    <DialogDescription>
                        {t('exchange.snoozeDesc')}
                    </DialogDescription>
                </DialogHeader>

                <div className="p-4 space-y-2">
                    {options.map((option) => (
                        <button
                            key={option.value}
                            onClick={() => setSelectedMinutes(option.value)}
                            className={cn(
                                "w-full flex items-center justify-between p-4 border transition-all h-14",
                                style === 'neo-orange'
                                    ? cn(
                                        "rounded-[var(--radius)]",
                                        selectedMinutes === option.value
                                            ? "border-2 border-black dark:border-white bg-emerald-500 text-black font-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]"
                                            : "border-black/20 dark:border-white/20 hover:border-black dark:hover:border-white"
                                    )
                                    : cn(
                                        "rounded-xl",
                                        selectedMinutes === option.value
                                            ? "border-emerald-500 bg-emerald-50/50 text-emerald-700 font-medium shadow-sm"
                                            : "border-border hover:border-border/80 hover:bg-secondary/20"
                                    )
                            )}
                        >
                            <span className="text-sm">{option.label}</span>
                            {selectedMinutes === option.value && <Check className={cn("w-4 h-4", style === 'neo-orange' ? "text-black" : "text-emerald-600")} />}
                        </button>
                    ))}
                </div>

                <DialogFooter className="p-4 bg-secondary/30">
                    <Button
                        disabled={selectedMinutes === null}
                        className={cn(
                            "w-full h-12 font-black",
                            style === 'neo-orange' ? "rounded-[var(--radius)] bg-emerald-600 text-black border-2 border-black dark:border-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]" : "rounded-xl bg-emerald-600 hover:bg-emerald-700"
                        )}
                        onClick={handleConfirm}
                    >
                        {t('common.confirm')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
