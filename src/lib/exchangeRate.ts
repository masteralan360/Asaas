export type ExchangeRateSource = 'xeiqd' | 'egcurrency';

export interface ExchangeRateResult {
    rate: number;
    source: ExchangeRateSource;
    isFallback: boolean;
    timestamp?: string;
}

export async function fetchUSDToIQDRate(primarySource?: ExchangeRateSource): Promise<ExchangeRateResult> {
    if (!navigator.onLine) {
        throw new Error('Offline: Cannot fetch live exchange rate');
    }

    // Get primary from localStorage if not provided (for direct calls from component)
    const favoredSource = primarySource || (localStorage.getItem('primary_exchange_rate_source') as ExchangeRateSource) || 'xeiqd';

    const sources: ExchangeRateSource[] = [
        favoredSource,
        favoredSource === 'xeiqd' ? 'egcurrency' : 'xeiqd'
    ];

    // --- TRY SOURCES IN ORDER ---
    for (let i = 0; i < sources.length; i++) {
        const currentSource = sources[i];
        const isFallback = i > 0;

        try {
            console.log(`[ExchangeRate] Fetching from ${isFallback ? 'Fallback' : 'Primary'} Source (${currentSource})...`);
            const rate = currentSource === 'xeiqd' ? await fetchFromXEIQD() : await fetchFromEGCurrency();
            console.log(`[ExchangeRate] ${currentSource} Success! Rate:`, rate);
            return { rate, source: currentSource, isFallback };
        } catch (error) {
            console.warn(`[ExchangeRate] Source (${currentSource}) Failed:`, error);
        }
    }

    throw new Error('All exchange rate sources failed');
}

async function fetchFromXEIQD(): Promise<number> {
    const response = await fetch('/api-xeiqd', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP Error ${response.status}`);

    const html = await response.text();

    // 1. Try Sulaymaniyah spot rate
    const sulyRegex = /السليمانية.*?(?:IQD|د\.ع)\s*([0-9\u0660-\u0669]{1,3}(?:[.,\u066B\u066C][0-9\u0660-\u0669]{3})+)/s;
    const sulyMatch = html.match(sulyRegex);

    if (sulyMatch && sulyMatch[1]) {
        let rawValue = sulyMatch[1];
        const arabicDigits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
        for (let i = 0; i < 10; i++) {
            rawValue = rawValue.split(arabicDigits[i]).join(i.toString());
        }
        const cleanedValue = rawValue.replace(/[.,\u066B\u066C]/g, '');
        const rate = parseInt(cleanedValue);
        if (!isNaN(rate) && rate > 100000) return rate;
    }

    // 2. Fallback to chart data
    const regex = /cachedData:\s*JSON\.parse\(['"](.+?)['"]\)/s;
    const match = html.match(regex);
    if (!match || !match[1]) throw new Error('Pattern not found');

    const jsonStr = match[1]
        .replace(/&quot;/g, '"')
        .replace(/\\\\u/g, '\\u')
        .replace(/\\u([0-9a-fA-F]{4})/g, (_, p1) => String.fromCharCode(parseInt(p1, 16)))
        .replace(/\\'/g, "'")
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\");

    const data = JSON.parse(jsonStr);
    const usdDataset = data.datasets.find((ds: any) => ds.label === "USD" || ds.label === "دولار أمريكي");
    if (!usdDataset || !usdDataset.data) throw new Error('USD dataset not found');

    const entries = Object.entries(usdDataset.data);
    if (entries.length === 0) throw new Error('No entries');

    const latestValueStr = entries[entries.length - 1][1] as string;
    const latestValue = parseFloat(latestValueStr);
    if (isNaN(latestValue)) throw new Error('Invalid value');

    return Math.round(latestValue * 100);
}

async function fetchFromEGCurrency(): Promise<number> {
    const response = await fetch('/api-egcurrency/en/currency/USD-to-IQD/blackMarket', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP Error ${response.status}`);

    const html = await response.text();

    /**
     * User requested "Sell Price" which currently is 1,453.95
     * Based on research, the HTML structure is:
     * <span class="margin-me-1">Sell Price:</span> <b class="fs-5">1,453.95</b>
     * Alternatively, there's a script tag with:
     * const rates = {"IQD":{"sell":1,"buy":1},"USD":{"sell":1453.95,"buy":1468.64,"unit":1}};
     */

    // Try script extraction first (more robust)
    const scriptRegex = /const\s+rates\s*=\s*({.*?});/s;
    const scriptMatch = html.match(scriptRegex);
    if (scriptMatch && scriptMatch[1]) {
        try {
            const rates = JSON.parse(scriptMatch[1]);
            if (rates.USD && rates.USD.sell) {
                const sellValue = parseFloat(rates.USD.sell);
                if (!isNaN(sellValue)) {
                    // Multiply by 100 as per user requirement (1453.95 -> 145395)
                    return Math.round(sellValue * 100);
                }
            }
        } catch (e) {
            console.warn('[EGCurrency] JSON parse failed, falling back to regex');
        }
    }

    // Fallback to regex on HTML
    const htmlRegex = /Sell Price:<\/span>\s*<b class="fs-5">([\d,.]+)<\/b>/;
    const htmlMatch = html.match(htmlRegex);
    if (htmlMatch && htmlMatch[1]) {
        const rawValue = htmlMatch[1].replace(/,/g, '');
        const sellValue = parseFloat(rawValue);
        if (!isNaN(sellValue)) {
            return Math.round(sellValue * 100);
        }
    }

    throw new Error('Could not extract Sell Price from egcurrency.com');
}

export type ExchangePath = 'USD-to-IQD' | 'USD-to-EUR' | 'EUR-to-IQD';

export async function fetchEgRate(path: ExchangePath): Promise<number> {
    const response = await fetch(`/api-egcurrency/en/currency/${path}/blackMarket`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP Error ${response.status}`);

    const html = await response.text();

    const scriptRegex = /const\s+rates\s*=\s*({.*?});/s;
    const scriptMatch = html.match(scriptRegex);
    if (scriptMatch && scriptMatch[1]) {
        try {
            const rates = JSON.parse(scriptMatch[1]);
            const source = path.split('-to-')[0]; // USD or EUR
            if (rates[source] && rates[source].sell) {
                const sellValue = parseFloat(rates[source].sell);
                if (!isNaN(sellValue)) {
                    return Math.round(sellValue * 100);
                }
            }
        } catch (e) {
            console.warn(`[EGCurrency] ${path} JSON parse failed, falling back to regex`);
        }
    }

    const htmlRegex = /Sell Price:<\/span>\s*<b class="fs-5">([\d,.]+)<\/b>/;
    const htmlMatch = html.match(htmlRegex);
    if (htmlMatch && htmlMatch[1]) {
        const rawValue = htmlMatch[1].replace(/,/g, '');
        const sellValue = parseFloat(rawValue);
        if (!isNaN(sellValue)) {
            return Math.round(sellValue * 100);
        }
    }

    throw new Error(`Could not extract rate for ${path} from egcurrency.com`);
}
