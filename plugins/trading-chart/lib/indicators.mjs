/**
 * Server-side Technical Indicator Library
 *
 * Computes 15 technical indicators from OHLCV data.
 * Each function returns an array of values aligned with the input candle array
 * (null where insufficient history exists).
 *
 * This is the server-side computation engine — separate from the frontend
 * indicators.ts which handles chart rendering only.
 *
 * @module @oboto/plugin-trading-chart/lib/indicators
 */

// ── Utility helpers ──────────────────────────────────────────────────────

/**
 * Compute simple moving average over a window.
 * @param {number[]} data
 * @param {number} period
 * @returns {(number|null)[]}
 */
export function sma(data, period) {
    const result = [];
    for (let i = 0; i < data.length; i++) {
        if (i < period - 1) {
            result.push(null);
        } else {
            let sum = 0;
            for (let j = i - period + 1; j <= i; j++) sum += data[j];
            result.push(sum / period);
        }
    }
    return result;
}

/**
 * Compute exponential moving average.
 * @param {number[]} data
 * @param {number} period
 * @returns {(number|null)[]}
 */
export function ema(data, period) {
    const result = [];
    const k = 2 / (period + 1);
    for (let i = 0; i < data.length; i++) {
        if (i < period - 1) {
            result.push(null);
        } else if (i === period - 1) {
            let sum = 0;
            for (let j = 0; j < period; j++) sum += data[j];
            result.push(sum / period);
        } else {
            result.push(data[i] * k + result[i - 1] * (1 - k));
        }
    }
    return result;
}

/**
 * True Range for a single bar.
 */
function trueRange(high, low, prevClose) {
    return Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
    );
}

// ── Core Indicators ──────────────────────────────────────────────────────

/**
 * RSI (Relative Strength Index)
 * @param {number[]} closes
 * @param {number} [period=14]
 * @returns {(number|null)[]}
 */
export function rsi(closes, period = 14) {
    const result = [];
    if (closes.length < period + 1) {
        return closes.map(() => null);
    }

    let avgGain = 0;
    let avgLoss = 0;

    // Initial average gain/loss
    for (let i = 1; i <= period; i++) {
        const change = closes[i] - closes[i - 1];
        if (change > 0) avgGain += change;
        else avgLoss += Math.abs(change);
    }
    avgGain /= period;
    avgLoss /= period;

    // Fill nulls for insufficient data
    for (let i = 0; i < period; i++) result.push(null);

    // First RSI value
    const rs0 = avgLoss === 0 ? 100 : avgGain / avgLoss;
    result.push(100 - 100 / (1 + rs0));

    // Subsequent values using smoothed average
    for (let i = period + 1; i < closes.length; i++) {
        const change = closes[i] - closes[i - 1];
        const gain = change > 0 ? change : 0;
        const loss = change < 0 ? Math.abs(change) : 0;

        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;

        const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        result.push(100 - 100 / (1 + rs));
    }

    return result;
}

/**
 * MACD (Moving Average Convergence Divergence)
 * @param {number[]} closes
 * @param {number} [fast=12]
 * @param {number} [slow=26]
 * @param {number} [signal=9]
 * @returns {{ line: (number|null)[], signal: (number|null)[], histogram: (number|null)[] }}
 */
export function macd(closes, fast = 12, slow = 26, signal = 9) {
    const emaFast = ema(closes, fast);
    const emaSlow = ema(closes, slow);

    // MACD line = fast EMA - slow EMA
    const macdLine = [];
    for (let i = 0; i < closes.length; i++) {
        if (emaFast[i] === null || emaSlow[i] === null) {
            macdLine.push(null);
        } else {
            macdLine.push(emaFast[i] - emaSlow[i]);
        }
    }

    // Signal line = EMA of MACD line
    // Only compute EMA on non-null values, preserving index alignment
    const nonNullStart = macdLine.findIndex(v => v !== null);
    const macdValues = macdLine.slice(nonNullStart).map(v => v ?? 0);
    const signalEma = ema(macdValues, signal);

    const signalLine = [];
    const histogram = [];
    for (let i = 0; i < closes.length; i++) {
        if (i < nonNullStart) {
            signalLine.push(null);
            histogram.push(null);
        } else {
            const sigVal = signalEma[i - nonNullStart];
            signalLine.push(sigVal);
            if (macdLine[i] !== null && sigVal !== null) {
                histogram.push(macdLine[i] - sigVal);
            } else {
                histogram.push(null);
            }
        }
    }

    return { line: macdLine, signal: signalLine, histogram };
}

/**
 * Bollinger Bands
 * @param {number[]} closes
 * @param {number} [period=20]
 * @param {number} [stdDevMul=2]
 * @returns {{ upper: (number|null)[], middle: (number|null)[], lower: (number|null)[], bandwidth: (number|null)[], percentB: (number|null)[] }}
 */
export function bollingerBands(closes, period = 20, stdDevMul = 2) {
    const middle = sma(closes, period);
    const upper = [];
    const lower = [];
    const bandwidth = [];
    const percentB = [];

    for (let i = 0; i < closes.length; i++) {
        const m = middle[i];
        if (m === null) {
            upper.push(null);
            lower.push(null);
            bandwidth.push(null);
            percentB.push(null);
        } else {
            let variance = 0;
            for (let j = i - period + 1; j <= i; j++) {
                variance += (closes[j] - m) ** 2;
            }
            const stdDev = Math.sqrt(variance / period);
            const u = m + stdDevMul * stdDev;
            const l = m - stdDevMul * stdDev;
            upper.push(u);
            lower.push(l);
            bandwidth.push(u - l);
            percentB.push(u !== l ? (closes[i] - l) / (u - l) : 0.5);
        }
    }

    return { upper, middle, lower, bandwidth, percentB };
}

/**
 * ATR (Average True Range)
 * @param {number[]} highs
 * @param {number[]} lows
 * @param {number[]} closes
 * @param {number} [period=14]
 * @returns {(number|null)[]}
 */
export function atr(highs, lows, closes, period = 14) {
    const result = [];
    if (closes.length < 2) return closes.map(() => null);

    // Compute true ranges
    const trValues = [highs[0] - lows[0]]; // First bar: just high - low
    for (let i = 1; i < closes.length; i++) {
        trValues.push(trueRange(highs[i], lows[i], closes[i - 1]));
    }

    // ATR = smoothed average of true range
    for (let i = 0; i < closes.length; i++) {
        if (i < period - 1) {
            result.push(null);
        } else if (i === period - 1) {
            let sum = 0;
            for (let j = 0; j < period; j++) sum += trValues[j];
            result.push(sum / period);
        } else {
            result.push((result[i - 1] * (period - 1) + trValues[i]) / period);
        }
    }

    return result;
}

/**
 * OBV (On-Balance Volume)
 * @param {number[]} closes
 * @param {number[]} volumes
 * @returns {number[]}
 */
export function obv(closes, volumes) {
    const result = [volumes[0] || 0];
    for (let i = 1; i < closes.length; i++) {
        const vol = volumes[i] || 0;
        if (closes[i] > closes[i - 1]) {
            result.push(result[i - 1] + vol);
        } else if (closes[i] < closes[i - 1]) {
            result.push(result[i - 1] - vol);
        } else {
            result.push(result[i - 1]);
        }
    }
    return result;
}

/**
 * VWAP (Volume Weighted Average Price)
 * Assumes all candles are in the same session.
 * @param {number[]} highs
 * @param {number[]} lows
 * @param {number[]} closes
 * @param {number[]} volumes
 * @returns {(number|null)[]}
 */
export function vwap(highs, lows, closes, volumes) {
    const result = [];
    let cumulativeTPV = 0;
    let cumulativeVolume = 0;

    for (let i = 0; i < closes.length; i++) {
        const typicalPrice = (highs[i] + lows[i] + closes[i]) / 3;
        const vol = volumes[i] || 0;
        cumulativeTPV += typicalPrice * vol;
        cumulativeVolume += vol;
        result.push(cumulativeVolume > 0 ? cumulativeTPV / cumulativeVolume : closes[i]);
    }

    return result;
}

/**
 * Stochastic RSI
 * @param {number[]} closes
 * @param {number} [rsiPeriod=14]
 * @param {number} [stochPeriod=14]
 * @param {number} [kSmooth=3]
 * @param {number} [dSmooth=3]
 * @returns {{ k: (number|null)[], d: (number|null)[] }}
 */
export function stochRsi(closes, rsiPeriod = 14, stochPeriod = 14, kSmooth = 3, dSmooth = 3) {
    const rsiValues = rsi(closes, rsiPeriod);

    // Stochastic of RSI
    const rawK = [];
    for (let i = 0; i < rsiValues.length; i++) {
        if (rsiValues[i] === null || i < stochPeriod - 1 + rsiPeriod) {
            rawK.push(null);
        } else {
            let minRsi = Infinity;
            let maxRsi = -Infinity;
            for (let j = i - stochPeriod + 1; j <= i; j++) {
                if (rsiValues[j] !== null) {
                    if (rsiValues[j] < minRsi) minRsi = rsiValues[j];
                    if (rsiValues[j] > maxRsi) maxRsi = rsiValues[j];
                }
            }
            const range = maxRsi - minRsi;
            rawK.push(range > 0 ? ((rsiValues[i] - minRsi) / range) * 100 : 50);
        }
    }

    // Smooth %K with SMA
    const k = smoothWithSMA(rawK, kSmooth);
    // %D = SMA of %K
    const d = smoothWithSMA(k, dSmooth);

    return { k, d };
}

/**
 * MFI (Money Flow Index)
 * @param {number[]} highs
 * @param {number[]} lows
 * @param {number[]} closes
 * @param {number[]} volumes
 * @param {number} [period=14]
 * @returns {(number|null)[]}
 */
export function mfi(highs, lows, closes, volumes, period = 14) {
    const result = [];
    const typicalPrices = closes.map((c, i) => (highs[i] + lows[i] + c) / 3);
    const moneyFlow = typicalPrices.map((tp, i) => tp * (volumes[i] || 0));

    for (let i = 0; i < closes.length; i++) {
        if (i < period) {
            result.push(null);
        } else {
            let positiveFlow = 0;
            let negativeFlow = 0;
            for (let j = i - period + 1; j <= i; j++) {
                if (typicalPrices[j] > typicalPrices[j - 1]) {
                    positiveFlow += moneyFlow[j];
                } else {
                    negativeFlow += moneyFlow[j];
                }
            }
            const mfRatio = negativeFlow === 0 ? 100 : positiveFlow / negativeFlow;
            result.push(100 - 100 / (1 + mfRatio));
        }
    }

    return result;
}

/**
 * ADX (Average Directional Index)
 * @param {number[]} highs
 * @param {number[]} lows
 * @param {number[]} closes
 * @param {number} [period=14]
 * @returns {{ adx: (number|null)[], plusDI: (number|null)[], minusDI: (number|null)[] }}
 */
export function adx(highs, lows, closes, period = 14) {
    if (closes.length < 2) {
        return {
            adx: closes.map(() => null),
            plusDI: closes.map(() => null),
            minusDI: closes.map(() => null),
        };
    }

    // Compute +DM, -DM, TR
    const plusDM = [0];
    const minusDM = [0];
    const tr = [highs[0] - lows[0]];

    for (let i = 1; i < closes.length; i++) {
        const upMove = highs[i] - highs[i - 1];
        const downMove = lows[i - 1] - lows[i];
        plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
        minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
        tr.push(trueRange(highs[i], lows[i], closes[i - 1]));
    }

    // Smooth with Wilder's method (EMA with period smoothing)
    const smoothedPlusDM = wilderSmooth(plusDM, period);
    const smoothedMinusDM = wilderSmooth(minusDM, period);
    const smoothedTR = wilderSmooth(tr, period);

    // +DI and -DI
    const plusDI = [];
    const minusDI = [];
    const dx = [];

    for (let i = 0; i < closes.length; i++) {
        if (smoothedTR[i] === null || smoothedTR[i] === 0) {
            plusDI.push(null);
            minusDI.push(null);
            dx.push(null);
        } else {
            const pdi = (smoothedPlusDM[i] / smoothedTR[i]) * 100;
            const mdi = (smoothedMinusDM[i] / smoothedTR[i]) * 100;
            plusDI.push(pdi);
            minusDI.push(mdi);
            const diSum = pdi + mdi;
            dx.push(diSum > 0 ? (Math.abs(pdi - mdi) / diSum) * 100 : 0);
        }
    }

    // ADX = smoothed DX
    const adxValues = wilderSmooth(
        dx.map(v => v ?? 0),
        period
    );

    // Re-null the leading values
    const adxResult = [];
    for (let i = 0; i < closes.length; i++) {
        if (i < period * 2 - 1) {
            adxResult.push(null);
        } else {
            adxResult.push(adxValues[i]);
        }
    }

    return { adx: adxResult, plusDI, minusDI };
}

/**
 * CCI (Commodity Channel Index)
 * @param {number[]} highs
 * @param {number[]} lows
 * @param {number[]} closes
 * @param {number} [period=20]
 * @returns {(number|null)[]}
 */
export function cci(highs, lows, closes, period = 20) {
    const typicalPrices = closes.map((c, i) => (highs[i] + lows[i] + c) / 3);
    const tpSMA = sma(typicalPrices, period);
    const result = [];

    for (let i = 0; i < closes.length; i++) {
        if (tpSMA[i] === null) {
            result.push(null);
        } else {
            // Mean deviation
            let meanDev = 0;
            for (let j = i - period + 1; j <= i; j++) {
                meanDev += Math.abs(typicalPrices[j] - tpSMA[i]);
            }
            meanDev /= period;
            result.push(meanDev > 0 ? (typicalPrices[i] - tpSMA[i]) / (0.015 * meanDev) : 0);
        }
    }

    return result;
}

/**
 * Williams %R
 * @param {number[]} highs
 * @param {number[]} lows
 * @param {number[]} closes
 * @param {number} [period=14]
 * @returns {(number|null)[]}
 */
export function williamsR(highs, lows, closes, period = 14) {
    const result = [];
    for (let i = 0; i < closes.length; i++) {
        if (i < period - 1) {
            result.push(null);
        } else {
            let highestHigh = -Infinity;
            let lowestLow = Infinity;
            for (let j = i - period + 1; j <= i; j++) {
                if (highs[j] > highestHigh) highestHigh = highs[j];
                if (lows[j] < lowestLow) lowestLow = lows[j];
            }
            const range = highestHigh - lowestLow;
            result.push(range > 0 ? ((highestHigh - closes[i]) / range) * -100 : -50);
        }
    }
    return result;
}

/**
 * Ichimoku Cloud
 * @param {number[]} highs
 * @param {number[]} lows
 * @param {number[]} closes
 * @param {number} [tenkanPeriod=9]
 * @param {number} [kijunPeriod=26]
 * @param {number} [senkouBPeriod=52]
 * @returns {{ tenkan: (number|null)[], kijun: (number|null)[], senkouA: (number|null)[], senkouB: (number|null)[], chikou: (number|null)[] }}
 */
export function ichimoku(highs, lows, closes, tenkanPeriod = 9, kijunPeriod = 26, senkouBPeriod = 52) {
    const midpoint = (high, low, period, i) => {
        if (i < period - 1) return null;
        let hh = -Infinity, ll = Infinity;
        for (let j = i - period + 1; j <= i; j++) {
            if (high[j] > hh) hh = high[j];
            if (low[j] < ll) ll = low[j];
        }
        return (hh + ll) / 2;
    };

    const tenkan = [];
    const kijun = [];
    const senkouA = [];
    const senkouB = [];
    const chikou = [];

    for (let i = 0; i < closes.length; i++) {
        const t = midpoint(highs, lows, tenkanPeriod, i);
        const k = midpoint(highs, lows, kijunPeriod, i);
        tenkan.push(t);
        kijun.push(k);

        // Senkou A = (tenkan + kijun) / 2, displaced forward 26 periods
        // We store at current index; the displacement is handled by the consumer
        senkouA.push(t !== null && k !== null ? (t + k) / 2 : null);

        // Senkou B = midpoint of 52-period high/low, displaced forward 26
        senkouB.push(midpoint(highs, lows, senkouBPeriod, i));

        // Chikou = close displaced back 26 periods
        // At index i, chikou represents close[i] plotted at i-26
        chikou.push(closes[i]); // Consumer handles displacement
    }

    return { tenkan, kijun, senkouA, senkouB, chikou };
}

/**
 * Pivot Points (Standard)
 * Uses previous candle's HLC to compute pivot levels for the current candle.
 * @param {number[]} highs
 * @param {number[]} lows
 * @param {number[]} closes
 * @returns {{ pivot: (number|null)[], r1: (number|null)[], r2: (number|null)[], r3: (number|null)[], s1: (number|null)[], s2: (number|null)[], s3: (number|null)[] }}
 */
export function pivotPoints(highs, lows, closes) {
    const pivot = [null];
    const r1 = [null], r2 = [null], r3 = [null];
    const s1 = [null], s2 = [null], s3 = [null];

    for (let i = 1; i < closes.length; i++) {
        const h = highs[i - 1];
        const l = lows[i - 1];
        const c = closes[i - 1];
        const p = (h + l + c) / 3;

        pivot.push(p);
        r1.push(2 * p - l);
        s1.push(2 * p - h);
        r2.push(p + (h - l));
        s2.push(p - (h - l));
        r3.push(h + 2 * (p - l));
        s3.push(l - 2 * (h - p));
    }

    return { pivot, r1, r2, r3, s1, s2, s3 };
}

// ── Helper functions ─────────────────────────────────────────────────────

/**
 * Wilder's smoothing (used by ADX, ATR, etc.)
 * @param {number[]} data
 * @param {number} period
 * @returns {(number|null)[]}
 */
function wilderSmooth(data, period) {
    const result = [];
    for (let i = 0; i < data.length; i++) {
        if (i < period - 1) {
            result.push(null);
        } else if (i === period - 1) {
            let sum = 0;
            for (let j = 0; j < period; j++) sum += data[j];
            result.push(sum / period);
        } else {
            const prev = result[i - 1] ?? 0;
            result.push((prev * (period - 1) + data[i]) / period);
        }
    }
    return result;
}

/**
 * Smooth a (number|null)[] array with SMA, preserving nulls.
 * @param {(number|null)[]} data
 * @param {number} period
 * @returns {(number|null)[]}
 */
function smoothWithSMA(data, period) {
    const result = [];
    let count = 0;
    for (let i = 0; i < data.length; i++) {
        if (data[i] === null) {
            result.push(null);
            count = 0;
        } else {
            count++;
            if (count < period) {
                result.push(null);
            } else {
                let sum = 0;
                for (let j = i - period + 1; j <= i; j++) {
                    sum += data[j] ?? 0;
                }
                result.push(sum / period);
            }
        }
    }
    return result;
}

// ── Batch computation ────────────────────────────────────────────────────

/**
 * Compute all requested indicators from OHLCV data.
 *
 * @param {Object} ohlcv
 * @param {number[]} ohlcv.opens
 * @param {number[]} ohlcv.highs
 * @param {number[]} ohlcv.lows
 * @param {number[]} ohlcv.closes
 * @param {number[]} ohlcv.volumes
 * @param {string[]} [requestedIndicators] - Which indicators to compute. Default: all.
 * @param {number} [lookback=20] - How many recent values to return.
 * @returns {Object} Map of indicator name → computed values (last `lookback` entries)
 */
export function computeAllIndicators(ohlcv, requestedIndicators, lookback = 20) {
    const { opens, highs, lows, closes, volumes } = ohlcv;
    const all = !requestedIndicators || requestedIndicators.length === 0;
    const requested = new Set(requestedIndicators || []);

    const result = {};
    const slice = (arr) => arr.slice(Math.max(0, arr.length - lookback));

    if (all || requested.has('rsi')) {
        result.rsi = slice(rsi(closes));
    }

    if (all || requested.has('macd')) {
        const m = macd(closes);
        result.macd = {
            line: slice(m.line),
            signal: slice(m.signal),
            histogram: slice(m.histogram),
        };
    }

    if (all || requested.has('ema')) {
        result.ema = {
            ema9: slice(ema(closes, 9)),
            ema21: slice(ema(closes, 21)),
            ema50: slice(ema(closes, 50)),
            ema200: slice(ema(closes, 200)),
        };
    }

    if (all || requested.has('sma')) {
        result.sma = {
            sma20: slice(sma(closes, 20)),
            sma50: slice(sma(closes, 50)),
            sma200: slice(sma(closes, 200)),
        };
    }

    if (all || requested.has('bollinger')) {
        const bb = bollingerBands(closes);
        result.bollinger = {
            upper: slice(bb.upper),
            middle: slice(bb.middle),
            lower: slice(bb.lower),
            bandwidth: slice(bb.bandwidth),
            percentB: slice(bb.percentB),
        };
    }

    if (all || requested.has('atr')) {
        result.atr = slice(atr(highs, lows, closes));
    }

    if (all || requested.has('obv')) {
        result.obv = slice(obv(closes, volumes));
    }

    if (all || requested.has('vwap')) {
        result.vwap = slice(vwap(highs, lows, closes, volumes));
    }

    if (all || requested.has('stoch_rsi')) {
        const sr = stochRsi(closes);
        result.stoch_rsi = {
            k: slice(sr.k),
            d: slice(sr.d),
        };
    }

    if (all || requested.has('mfi')) {
        result.mfi = slice(mfi(highs, lows, closes, volumes));
    }

    if (all || requested.has('adx')) {
        const a = adx(highs, lows, closes);
        result.adx = {
            adx: slice(a.adx),
            plusDI: slice(a.plusDI),
            minusDI: slice(a.minusDI),
        };
    }

    if (all || requested.has('cci')) {
        result.cci = slice(cci(highs, lows, closes));
    }

    if (all || requested.has('williams_r')) {
        result.williams_r = slice(williamsR(highs, lows, closes));
    }

    if (all || requested.has('ichimoku')) {
        const ich = ichimoku(highs, lows, closes);
        result.ichimoku = {
            tenkan: slice(ich.tenkan),
            kijun: slice(ich.kijun),
            senkouA: slice(ich.senkouA),
            senkouB: slice(ich.senkouB),
            chikou: slice(ich.chikou),
        };
    }

    if (all || requested.has('pivot_points')) {
        const pp = pivotPoints(highs, lows, closes);
        result.pivot_points = {
            pivot: slice(pp.pivot),
            r1: slice(pp.r1),
            r2: slice(pp.r2),
            r3: slice(pp.r3),
            s1: slice(pp.s1),
            s2: slice(pp.s2),
            s3: slice(pp.s3),
        };
    }

    return result;
}
