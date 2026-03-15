/**
 * Candle Fetcher — Retrieves historical OHLCV candle data from public APIs.
 *
 * Source priority:
 * 1. Binance.com (highest liquidity, 6000 req/min — but geo-blocked in some regions)
 * 2. Binance.US (US-accessible, same API schema)
 * 3. MEXC (no geo-restrictions, target exchange — uses different interval names)
 *
 * All three APIs return kline data in the same array-of-arrays format:
 * [openTime, open, high, low, close, volume, closeTime, quoteVol, trades, ...]
 *
 * @module @oboto/plugin-trading-chart/lib/candle-fetcher
 */

/**
 * Timeframe mapping: user-friendly label → Binance interval string.
 * MEXC uses a slightly different naming convention (see MEXC_INTERVAL_MAP).
 */
const BINANCE_INTERVAL_MAP = {
    '1m': '1m',
    '3m': '3m',
    '5m': '5m',
    '15m': '15m',
    '30m': '30m',
    '1h': '1h',
    '2h': '2h',
    '4h': '4h',
    '6h': '6h',
    '8h': '8h',
    '12h': '12h',
    '1d': '1d',
    '3d': '3d',
    '1w': '1w',
    '1M': '1M',
};

/**
 * MEXC interval mapping — MEXC uses minute-based names for hourly intervals
 * and does not support '1w'.
 */
const MEXC_INTERVAL_MAP = {
    '1m': '1m',
    '3m': '3m',
    '5m': '5m',
    '15m': '15m',
    '30m': '30m',
    '1h': '60m',
    '2h': '120m',
    '4h': '4h',
    '6h': '6h',
    '8h': '8h',
    '12h': '12h',
    '1d': '1d',
    '3d': '3d',
    // '1w' is NOT supported by MEXC
    '1M': '1M',
};

const SOURCES = [
    {
        key: 'binance',
        name: 'Binance',
        spotUrl: 'https://api.binance.com/api/v3/klines',
        futuresUrl: 'https://fapi.binance.com/fapi/v1/klines',
        intervalMap: BINANCE_INTERVAL_MAP,
        maxCandles: 1000,
    },
    {
        key: 'binance_us',
        name: 'Binance.US',
        spotUrl: 'https://api.binance.us/api/v3/klines',
        futuresUrl: null, // Binance.US does not offer futures
        intervalMap: BINANCE_INTERVAL_MAP,
        maxCandles: 1000,
    },
    {
        key: 'mexc',
        name: 'MEXC',
        spotUrl: 'https://api.mexc.com/api/v3/klines',
        futuresUrl: null,
        intervalMap: MEXC_INTERVAL_MAP,
        maxCandles: 1000,
    },
];

/**
 * Fetch historical candles from a public exchange API.
 *
 * Tries sources in order: Binance.com → Binance.US → MEXC.
 * Each source may fail due to geo-restrictions, unsupported intervals,
 * or network issues — the next source is tried automatically.
 *
 * @param {Object} opts
 * @param {string} opts.symbol — Trading pair (e.g. 'BTCUSDT')
 * @param {string} opts.interval — Candle timeframe (e.g. '1m', '5m', '1h', '1d')
 * @param {number} [opts.limit=500] — Number of candles to fetch (max 1000)
 * @param {number} [opts.startTime] — Start time in milliseconds epoch
 * @param {number} [opts.endTime] — End time in milliseconds epoch
 * @param {string} [opts.market='spot'] — 'spot' or 'futures'
 * @param {number} [opts.timeoutMs=15000] — Request timeout in ms
 * @returns {Promise<{ candles: Array, source: string, symbol: string, interval: string }>}
 */
export async function fetchCandles({
    symbol,
    interval,
    limit = 500,
    startTime,
    endTime,
    market = 'spot',
    timeoutMs = 15000,
}) {
    // Validate interval exists in at least one source
    const validIntervals = new Set([
        ...Object.keys(BINANCE_INTERVAL_MAP),
        ...Object.keys(MEXC_INTERVAL_MAP),
    ]);
    if (!validIntervals.has(interval)) {
        throw new Error(`Unsupported interval "${interval}". Valid: ${[...validIntervals].join(', ')}`);
    }

    const normalizedSymbol = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const clampedLimit = Math.max(1, Math.min(1000, limit));

    let lastError;

    for (const src of SOURCES) {
        // Skip if this source doesn't support the requested interval
        const apiInterval = src.intervalMap[interval];
        if (!apiInterval) continue;

        // Skip if requesting futures but source has no futures endpoint
        if (market === 'futures' && !src.futuresUrl) continue;

        try {
            const raw = await _fetchKlines(src, {
                symbol: normalizedSymbol,
                interval: apiInterval,
                limit: clampedLimit,
                startTime,
                endTime,
                market,
                timeoutMs,
            });

            const candles = _parseKlines(raw);

            if (candles.length === 0) {
                throw new Error(`No candle data returned for ${normalizedSymbol} from ${src.name}`);
            }

            return {
                candles,
                source: src.name,
                symbol: normalizedSymbol,
                interval,
            };
        } catch (err) {
            lastError = err;
            // Continue to next source
        }
    }

    throw new Error(
        `Failed to fetch candles for ${normalizedSymbol} (${interval}) from all sources. Last error: ${lastError?.message}`
    );
}

/**
 * Fetch klines from a specific source.
 *
 * @param {Object} src — Source configuration object
 * @param {Object} opts
 * @returns {Promise<Array>} Raw kline arrays
 */
async function _fetchKlines(src, { symbol, interval, limit, startTime, endTime, market, timeoutMs }) {
    const baseUrl = market === 'futures' ? src.futuresUrl : src.spotUrl;

    const params = new URLSearchParams({
        symbol,
        interval,
        limit: String(limit),
    });

    if (startTime) params.set('startTime', String(startTime));
    if (endTime) params.set('endTime', String(endTime));

    const url = `${baseUrl}?${params.toString()}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const res = await fetch(url, {
            signal: controller.signal,
            headers: { 'Accept': 'application/json' },
        });

        if (!res.ok) {
            const body = await res.text().catch(() => '');
            throw new Error(`${src.name} API error ${res.status}: ${body.slice(0, 200)}`);
        }

        const data = await res.json();

        if (!Array.isArray(data)) {
            throw new Error(`${src.name} returned non-array response`);
        }

        return data;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Parse kline arrays into standardized candle objects.
 *
 * Both Binance and MEXC use the same kline format:
 * [openTime, open, high, low, close, volume, closeTime, quoteAssetVolume, numberOfTrades, ...]
 *
 * @param {Array<Array>} klines
 * @returns {Array<{ time: string, open: number, high: number, low: number, close: number, volume: number }>}
 */
function _parseKlines(klines) {
    return klines
        .map(k => {
            const openTime = typeof k[0] === 'number' ? k[0] : Number(k[0]);

            return {
                time: new Date(openTime).toISOString(),
                open: parseFloat(k[1]),
                high: parseFloat(k[2]),
                low: parseFloat(k[3]),
                close: parseFloat(k[4]),
                volume: parseFloat(k[5]),
            };
        })
        .filter(
            c =>
                !isNaN(c.open) &&
                !isNaN(c.high) &&
                !isNaN(c.low) &&
                !isNaN(c.close) &&
                !isNaN(c.volume)
        );
}

/**
 * Get available timeframes.
 * @returns {string[]}
 */
export function getAvailableIntervals() {
    return Object.keys(BINANCE_INTERVAL_MAP);
}

/**
 * Get source info for display.
 * @returns {Array<{ key: string, name: string, maxCandles: number }>}
 */
export function getSources() {
    return SOURCES.map(src => ({
        key: src.key,
        name: src.name,
        maxCandles: src.maxCandles,
    }));
}
