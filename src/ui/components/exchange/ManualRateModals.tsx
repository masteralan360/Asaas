'use client';

import { useState, useEffect } from 'react';
import { useExchangeRate } from '@/context/ExchangeRateContext';
import { ManualRateEditorModal } from './ManualRateEditorModal';
import { RateDiscrepancyModal } from './RateDiscrepancyModal';
import { SnoozeSelectionModal } from './SnoozeSelectionModal';

export function ManualRateModals() {
    const { alerts, forceAlert } = useExchangeRate();
    const [editorOpen, setEditorOpen] = useState(false);
    const [discrepancyOpen, setDiscrepancyOpen] = useState(false);
    const [snoozeOpen, setSnoozeOpen] = useState(false);

    // Sync discrepancy alert to modal state
    useEffect(() => {
        if (alerts.hasDiscrepancy) {
            setDiscrepancyOpen(true);
            if (alerts.discrepancyData?.pair) {
                const currency = alerts.discrepancyData.pair.split('/')[0] as 'USD' | 'EUR' | 'TRY';
                setEditorCurrency(currency);
            }
        } else {
            setDiscrepancyOpen(false);
        }
    }, [alerts.hasDiscrepancy, alerts.discrepancyData?.pair]);

    const [editorCurrency, setEditorCurrency] = useState<'USD' | 'EUR' | 'TRY'>('USD');

    // Handle manual trigger events (e.g. from pen icons or settings)
    useEffect(() => {
        const handleOpenEditor = (e: any) => {
            if (e.detail?.currency) {
                setEditorCurrency(e.detail.currency);
            }
            setEditorOpen(true);
        };
        window.addEventListener('open-manual-rate-editor', handleOpenEditor);
        return () => window.removeEventListener('open-manual-rate-editor', handleOpenEditor);
    }, []);

    return (
        <>
            <ManualRateEditorModal
                open={editorOpen}
                onOpenChange={setEditorOpen}
                initialCurrency={editorCurrency}
            />

            <RateDiscrepancyModal
                open={discrepancyOpen}
                onOpenChange={(val) => {
                    setDiscrepancyOpen(val);
                    if (!val) forceAlert(null);
                }}
                onOpenEditor={() => setEditorOpen(true)}
                onOpenSnooze={() => setSnoozeOpen(true)}
            />

            <SnoozeSelectionModal
                open={snoozeOpen}
                onOpenChange={setSnoozeOpen}
            />
        </>
    );
}
