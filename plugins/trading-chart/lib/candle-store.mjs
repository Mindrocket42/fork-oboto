/**
 * CandleStore — In-memory ring buffer for OHLCV candle data.
 *
 * Provides per-symbol storage with configurable max capacity.
 * Candles are stored in chronological order (oldest first).
 * When capacity is reached, oldest candles are evicted.
 *
 * @module @oboto/plugin-trading-chart/lib/candle-store
 */

/**
 * @typedef {Object} Candle
 * @property {string} time   - ISO timestamp or label
 * @property {number} open
 * @property {number} high
 * @property {number} low
 * @property {number} close
 * @property {number} [volume]
 */

export class CandleStore {
    /**
     * @param {Object} [options]
     * @param {number} [options.maxCandles=500] - Max candles per symbol
     */
    constructor(options = {}) {
        this.maxCandles = options.maxCandles || 500;
        /** @type {Map<string, { timeframe: string, candles: Candle[] }>} */
        this._store = new Map();
    }

    /**
     * Get the storage key for a symbol+timeframe pair.
     * @param {string} symbol
     * @param {string} timeframe
     * @returns {string}
     */
    _key(symbol, timeframe) {
        return `${symbol.toUpperCase()}:${timeframe}`;
    }

    /**
     * Store candles for a symbol. Merges with existing data if timestamps overlap.
     * @param {string} symbol
     * @param {string} timeframe - e.g., '1m', '5m', '1h'
     * @param {Candle[]} candles - Candles in chronological order
     */
    set(symbol, timeframe, candles) {
        const key = this._key(symbol, timeframe);
        const existing = this._store.get(key);

        if (!existing) {
            // First write — just store (trim to max)
            const trimmed = candles.length > this.maxCandles
                ? candles.slice(candles.length - this.maxCandles)
                : [...candles];
            this._store.set(key, { timeframe, candles: trimmed });
            return;
        }

        // Merge: find overlap point and append new data
        const existingTimes = new Set(existing.candles.map(c => c.time));
        const newCandles = candles.filter(c => !existingTimes.has(c.time));

        if (newCandles.length > 0) {
            existing.candles.push(...newCandles);
            // Trim from front if over capacity
            if (existing.candles.length > this.maxCandles) {
                existing.candles.splice(0, existing.candles.length - this.maxCandles);
            }
        }

        // Update any existing candles that may have changed (e.g., current candle still forming)
        for (const candle of candles) {
            if (existingTimes.has(candle.time)) {
                const idx = existing.candles.findIndex(c => c.time === candle.time);
                if (idx !== -1) {
                    existing.candles[idx] = candle;
                }
            }
        }
    }

    /**
     * Get candles for a symbol.
     * @param {string} symbol
     * @param {string} timeframe
     * @param {number} [count] - Number of most recent candles to return. Default: all.
     * @returns {{ timeframe: string, candles: Candle[] } | null}
     */
    get(symbol, timeframe, count) {
        const key = this._key(symbol, timeframe);
        const entry = this._store.get(key);
        if (!entry) return null;

        const candles = count && count < entry.candles.length
            ? entry.candles.slice(entry.candles.length - count)
            : entry.candles;

        return { timeframe: entry.timeframe, candles };
    }

    /**
     * Get the most recent candle for a symbol.
     * @param {string} symbol
     * @param {string} timeframe
     * @returns {Candle | null}
     */
    getLatest(symbol, timeframe) {
        const key = this._key(symbol, timeframe);
        const entry = this._store.get(key);
        if (!entry || entry.candles.length === 0) return null;
        return entry.candles[entry.candles.length - 1];
    }

    /**
     * Get closing prices as a flat array (useful for indicator computation).
     * @param {string} symbol
     * @param {string} timeframe
     * @param {number} [count]
     * @returns {number[]}
     */
    getCloses(symbol, timeframe, count) {
        const data = this.get(symbol, timeframe, count);
        return data ? data.candles.map(c => c.close) : [];
    }

    /**
     * Get high prices as a flat array.
     * @param {string} symbol
     * @param {string} timeframe
     * @param {number} [count]
     * @returns {number[]}
     */
    getHighs(symbol, timeframe, count) {
        const data = this.get(symbol, timeframe, count);
        return data ? data.candles.map(c => c.high) : [];
    }

    /**
     * Get low prices as a flat array.
     * @param {string} symbol
     * @param {string} timeframe
     * @param {number} [count]
     * @returns {number[]}
     */
    getLows(symbol, timeframe, count) {
        const data = this.get(symbol, timeframe, count);
        return data ? data.candles.map(c => c.low) : [];
    }

    /**
     * Get volumes as a flat array.
     * @param {string} symbol
     * @param {string} timeframe
     * @param {number} [count]
     * @returns {number[]}
     */
    getVolumes(symbol, timeframe, count) {
        const data = this.get(symbol, timeframe, count);
        return data ? data.candles.map(c => c.volume || 0) : [];
    }

    /**
     * Check if we have data for a symbol.
     * @param {string} symbol
     * @param {string} timeframe
     * @returns {boolean}
     */
    has(symbol, timeframe) {
        return this._store.has(this._key(symbol, timeframe));
    }

    /**
     * Get the number of candles stored for a symbol.
     * @param {string} symbol
     * @param {string} timeframe
     * @returns {number}
     */
    count(symbol, timeframe) {
        const entry = this._store.get(this._key(symbol, timeframe));
        return entry ? entry.candles.length : 0;
    }

    /**
     * Remove data for a symbol.
     * @param {string} symbol
     * @param {string} timeframe
     */
    remove(symbol, timeframe) {
        this._store.delete(this._key(symbol, timeframe));
    }

    /**
     * List all stored symbol:timeframe keys.
     * @returns {string[]}
     */
    listKeys() {
        return [...this._store.keys()];
    }

    /**
     * Clear all stored data.
     */
    clear() {
        this._store.clear();
    }
}
