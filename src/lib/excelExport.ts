import * as XLSX from 'xlsx';
import { isTauri } from './platform';
import { platformService } from '@/services/platformService';

/**
 * Utility to export an array of data to an Excel file.
 * @param data Array of objects to be exported.
 * @param fileName Name of the file (without extension).
 * @param sheetName Name of the worksheet.
 */
export const exportToExcel = async (data: any[], fileName: string = 'export', sheetName: string = 'Sheet1'): Promise<boolean> => {
    // Create a new workbook and worksheet
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();

    // Append worksheet to workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

    if (isTauri()) {
        try {
            // Generate buffer for Tauri native save
            const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
            const savedPath = await platformService.saveAs(
                new Uint8Array(excelBuffer),
                `${fileName}.xlsx`,
                [{ name: 'Excel', extensions: ['xlsx'] }]
            );
            return !!savedPath;
        } catch (error) {
            console.error('Tauri export failed:', error);
            return false;
        }
    } else {
        // Fallback for standard browser download
        XLSX.writeFile(workbook, `${fileName}.xlsx`);
        return true;
    }
};

/**
 * Maps sale records to the format expected for the Excel export.
 * This excludes technical metadata and uses friendly headers.
 */
export const mapSalesForExport = (sales: any[], t: any) => {
    return sales.map(sale => ({
        [t('common.date') || 'Date']: new Date(sale.created_at).toLocaleString(),
        [t('sales.id') || 'Sale ID']: sale.sequenceId ? `#${String(sale.sequenceId).padStart(5, '0')}` : sale.id.slice(0, 8),
        [t('sales.cashier') || 'Cashier']: sale.cashier_name || 'Staff',
        [t('sales.total') || 'Total']: sale.total_amount,
        [t('common.currency') || 'Currency']: sale.settlement_currency?.toUpperCase() || 'USD',
        [t('sales.paymentMethod') || 'Payment Method']: sale.payment_method?.toUpperCase() || 'CASH',
        [t('sales.notes.title') || 'Notes']: sale.notes || ''
    }));
};

/**
 * Maps revenue/profit analysis records to the format expected for the Excel export.
 */
export const mapRevenueForExport = (saleStats: any[], t: any) => {
    return saleStats.map(sale => ({
        [t('common.date') || 'Date']: new Date(sale.date).toLocaleString(),
        [t('sales.id') || 'Sale ID']: sale.sequenceId ? `#${String(sale.sequenceId).padStart(5, '0')}` : sale.id.slice(0, 8),
        [t('sales.origin') || 'Origin']: sale.origin?.toUpperCase() || 'POS',
        [t('sales.cashier') || 'Cashier']: sale.cashier || 'Staff',
        [t('common.currency') || 'Currency']: sale.currency?.toUpperCase() || 'USD',
        [t('revenue.table.revenue') || 'Revenue']: sale.revenue,
        [t('revenue.table.cost') || 'Cost']: sale.cost,
        [t('revenue.table.profit') || 'Profit']: sale.profit,
        [t('revenue.table.margin') || 'Margin (%)']: `${(sale.margin ?? 0).toFixed(2)}%`
    }));
};
