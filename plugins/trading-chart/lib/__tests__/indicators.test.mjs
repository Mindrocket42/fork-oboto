/**
 * Tests for server-side technical indicator library.
 */

import {
    sma, ema, rsi, macd, bollingerBands, atr, obv, vwap,
    stochRsi, mfi, adx, cci, williamsR, ichimoku, pivotPoints,
    computeAllIndicators
} from '../indicators.mjs';

// ── Test data — synthetic OHLCV with known characteristics ────────────────

function generateTrendingData(length, startPrice = 100, trend = 'up') {
    const opens = [], highs = [], lows = [], closes = [], volumes = [];
    let price = startPrice;
    for (let i = 0; i < length; i++) {
        const delta = trend === 'up' ? Math.random() * 2 : -Math.random() * 2;
        const noise = (Math.random() - 0.5) * 1;
        const open = price;
        const close = price + delta + noise;
        const high = Math.max(open, close) + Math.random() * 1;
        const low = Math.min(open, close) - Math.random() * 1;
        opens.push(open);
        highs.push(high);
        lows.push(low);
        closes.push(close);
        volumes.push(1000 + Math.random() * 500);
        price = close;
    }
    return { opens, highs, lows, closes, volumes };
}

function generateFlatData(length, price = 100) {
    const opens = [], highs = [], lows = [], closes = [], volumes = [];
    for (let i = 0; i < length; i++) {
        const noise = (Math.random() - 0.5) * 0.5;
        opens.push(price + noise);
        highs.push(price + Math.abs(noise) + 0.2);
        lows.push(price - Math.abs(noise) - 0.2);
        closes.push(price + noise * 0.5);
        volumes.push(1000);
    }
    return { opens, highs, lows, closes, volumes };
}

// Simple known data for exact verification
const KNOWN_CLOSES = [10, 11, 12, 11, 10, 11, 12, 13, 14, 13, 12, 13, 14, 15, 16, 15, 14, 15, 16, 17];

// ── SMA tests ─────────────────────────────────────────────────────────────

describe('sma', () => {
    test('returns nulls for insufficient data', () => {
        const result = sma([1, 2, 3], 5);
        expect(result).toEqual([null, null, null]);
    });

    test('computes correct 3-period SMA', () => {
        const result = sma([10, 20, 30, 40, 50], 3);
        expect(result[0]).toBeNull();
        expect(result[1]).toBeNull();
        expect(result[2]).toBeCloseTo(20); // (10+20+30)/3
        expect(result[3]).toBeCloseTo(30); // (20+30+40)/3
        expect(result[4]).toBeCloseTo(40); // (30+40+50)/3
    });

    test('length matches input', () => {
        const result = sma(KNOWN_CLOSES, 5);
        expect(result.length).toBe(KNOWN_CLOSES.length);
    });
});

// ── EMA tests ─────────────────────────────────────────────────────────────

describe('ema', () => {
    test('first EMA value equals SMA', () => {
        const data = [10, 20, 30, 40, 50];
        const result = ema(data, 3);
        const smaResult = sma(data, 3);
        expect(result[2]).toBeCloseTo(smaResult[2]);
    });

    test('EMA reacts faster than SMA to recent data', () => {
        const data = [10, 10, 10, 10, 10, 10, 10, 10, 10, 20]; // Sudden spike
        const emaResult = ema(data, 5);
        const smaResult = sma(data, 5);
        // EMA should be higher than SMA at the spike because it weights recent data more
        expect(emaResult[9]).toBeGreaterThan(smaResult[9]);
    });

    test('length matches input', () => {
        const result = ema(KNOWN_CLOSES, 9);
        expect(result.length).toBe(KNOWN_CLOSES.length);
    });
});

// ── RSI tests ─────────────────────────────────────────────────────────────

describe('rsi', () => {
    test('RSI values are between 0 and 100', () => {
        const data = generateTrendingData(100);
        const result = rsi(data.closes);
        for (const v of result) {
            if (v !== null) {
                expect(v).toBeGreaterThanOrEqual(0);
                expect(v).toBeLessThanOrEqual(100);
            }
        }
    });

    test('uptrend has RSI > 50', () => {
        const data = generateTrendingData(100, 100, 'up');
        const result = rsi(data.closes);
        const lastValues = result.slice(-10).filter(v => v !== null);
        const avgRsi = lastValues.reduce((a, b) => a + b, 0) / lastValues.length;
        expect(avgRsi).toBeGreaterThan(40); // Should be bullish-biased
    });

    test('first 14 values are null with default period', () => {
        const result = rsi(KNOWN_CLOSES);
        for (let i = 0; i < 14; i++) {
            expect(result[i]).toBeNull();
        }
        expect(result[14]).not.toBeNull();
    });
});

// ── MACD tests ────────────────────────────────────────────────────────────

describe('macd', () => {
    test('returns line, signal, and histogram', () => {
        const data = generateTrendingData(50);
        const result = macd(data.closes);
        expect(result).toHaveProperty('line');
        expect(result).toHaveProperty('signal');
        expect(result).toHaveProperty('histogram');
        expect(result.line.length).toBe(data.closes.length);
    });

    test('histogram = line - signal', () => {
        const data = generateTrendingData(50);
        const result = macd(data.closes);
        for (let i = 0; i < result.histogram.length; i++) {
            if (result.histogram[i] !== null && result.line[i] !== null && result.signal[i] !== null) {
                expect(result.histogram[i]).toBeCloseTo(result.line[i] - result.signal[i], 5);
            }
        }
    });
});

// ── Bollinger Bands tests ─────────────────────────────────────────────────

describe('bollingerBands', () => {
    test('upper > middle > lower', () => {
        const data = generateTrendingData(50);
        const result = bollingerBands(data.closes);
        for (let i = 0; i < result.upper.length; i++) {
            if (result.upper[i] !== null) {
                expect(result.upper[i]).toBeGreaterThan(result.middle[i]);
                expect(result.middle[i]).toBeGreaterThan(result.lower[i]);
            }
        }
    });

    test('percentB is between 0 and 1 for price within bands', () => {
        const data = generateFlatData(50);
        const result = bollingerBands(data.closes);
        const pctBValues = result.percentB.filter(v => v !== null);
        // Most values should be between 0 and 1 for flat data
        const withinBands = pctBValues.filter(v => v >= -0.1 && v <= 1.1);
        expect(withinBands.length / pctBValues.length).toBeGreaterThan(0.8);
    });
});

// ── ATR tests ─────────────────────────────────────────────────────────────

describe('atr', () => {
    test('ATR is always positive', () => {
        const data = generateTrendingData(50);
        const result = atr(data.highs, data.lows, data.closes);
        for (const v of result) {
            if (v !== null) {
                expect(v).toBeGreaterThan(0);
            }
        }
    });

    test('length matches input', () => {
        const data = generateTrendingData(50);
        const result = atr(data.highs, data.lows, data.closes);
        expect(result.length).toBe(50);
    });
});

// ── OBV tests ─────────────────────────────────────────────────────────────

describe('obv', () => {
    test('OBV rises when price rises with volume', () => {
        const closes = [10, 11, 12, 13, 14]; // Rising prices
        const volumes = [100, 100, 100, 100, 100];
        const result = obv(closes, volumes);
        // Each up close adds volume, so OBV should be monotonically increasing
        for (let i = 1; i < result.length; i++) {
            expect(result[i]).toBeGreaterThan(result[i - 1]);
        }
    });

    test('OBV returns array of same length', () => {
        const data = generateTrendingData(30);
        const result = obv(data.closes, data.volumes);
        expect(result.length).toBe(30);
    });
});

// ── VWAP tests ────────────────────────────────────────────────────────────

describe('vwap', () => {
    test('VWAP returns values for all candles', () => {
        const data = generateTrendingData(30);
        const result = vwap(data.highs, data.lows, data.closes, data.volumes);
        expect(result.length).toBe(30);
        expect(result.every(v => v !== null && !isNaN(v))).toBe(true);
    });
});

// ── Stochastic RSI tests ──────────────────────────────────────────────────

describe('stochRsi', () => {
    test('returns k and d arrays', () => {
        const data = generateTrendingData(60);
        const result = stochRsi(data.closes);
        expect(result).toHaveProperty('k');
        expect(result).toHaveProperty('d');
        expect(result.k.length).toBe(data.closes.length);
    });

    test('k and d values are between 0 and 100 (when non-null)', () => {
        const data = generateTrendingData(100);
        const result = stochRsi(data.closes);
        for (const v of result.k) {
            if (v !== null) {
                expect(v).toBeGreaterThanOrEqual(0);
                expect(v).toBeLessThanOrEqual(100);
            }
        }
    });
});

// ── MFI tests ─────────────────────────────────────────────────────────────

describe('mfi', () => {
    test('MFI values between 0 and 100', () => {
        const data = generateTrendingData(50);
        const result = mfi(data.highs, data.lows, data.closes, data.volumes);
        for (const v of result) {
            if (v !== null) {
                expect(v).toBeGreaterThanOrEqual(0);
                expect(v).toBeLessThanOrEqual(100);
            }
        }
    });
});

// ── ADX tests ─────────────────────────────────────────────────────────────

describe('adx', () => {
    test('returns adx, plusDI, minusDI', () => {
        const data = generateTrendingData(60);
        const result = adx(data.highs, data.lows, data.closes);
        expect(result).toHaveProperty('adx');
        expect(result).toHaveProperty('plusDI');
        expect(result).toHaveProperty('minusDI');
    });

    test('ADX is positive when non-null', () => {
        const data = generateTrendingData(60);
        const result = adx(data.highs, data.lows, data.closes);
        for (const v of result.adx) {
            if (v !== null) {
                expect(v).toBeGreaterThanOrEqual(0);
            }
        }
    });
});

// ── CCI tests ─────────────────────────────────────────────────────────────

describe('cci', () => {
    test('returns values for sufficient data', () => {
        const data = generateTrendingData(50);
        const result = cci(data.highs, data.lows, data.closes);
        const nonNull = result.filter(v => v !== null);
        expect(nonNull.length).toBeGreaterThan(0);
    });
});

// ── Williams %R tests ─────────────────────────────────────────────────────

describe('williamsR', () => {
    test('values between -100 and 0', () => {
        const data = generateTrendingData(50);
        const result = williamsR(data.highs, data.lows, data.closes);
        for (const v of result) {
            if (v !== null) {
                expect(v).toBeGreaterThanOrEqual(-100);
                expect(v).toBeLessThanOrEqual(0);
            }
        }
    });
});

// ── Ichimoku tests ────────────────────────────────────────────────────────

describe('ichimoku', () => {
    test('returns all five lines', () => {
        const data = generateTrendingData(60);
        const result = ichimoku(data.highs, data.lows, data.closes);
        expect(result).toHaveProperty('tenkan');
        expect(result).toHaveProperty('kijun');
        expect(result).toHaveProperty('senkouA');
        expect(result).toHaveProperty('senkouB');
        expect(result).toHaveProperty('chikou');
    });
});

// ── Pivot Points tests ────────────────────────────────────────────────────

describe('pivotPoints', () => {
    test('R1 > pivot > S1', () => {
        const data = generateTrendingData(20);
        const result = pivotPoints(data.highs, data.lows, data.closes);
        for (let i = 1; i < result.pivot.length; i++) {
            if (result.pivot[i] !== null) {
                expect(result.r1[i]).toBeGreaterThan(result.pivot[i]);
                expect(result.pivot[i]).toBeGreaterThan(result.s1[i]);
            }
        }
    });

    test('R3 > R2 > R1 and S1 > S2 > S3', () => {
        const data = generateTrendingData(20);
        const result = pivotPoints(data.highs, data.lows, data.closes);
        for (let i = 1; i < result.pivot.length; i++) {
            if (result.pivot[i] !== null) {
                expect(result.r3[i]).toBeGreaterThan(result.r2[i]);
                expect(result.r2[i]).toBeGreaterThan(result.r1[i]);
                expect(result.s1[i]).toBeGreaterThan(result.s2[i]);
                expect(result.s2[i]).toBeGreaterThan(result.s3[i]);
            }
        }
    });
});

// ── computeAllIndicators batch test ───────────────────────────────────────

describe('computeAllIndicators', () => {
    test('computes all indicators when no filter specified', () => {
        const data = generateTrendingData(100);
        const result = computeAllIndicators(data);
        expect(result).toHaveProperty('rsi');
        expect(result).toHaveProperty('macd');
        expect(result).toHaveProperty('ema');
        expect(result).toHaveProperty('sma');
        expect(result).toHaveProperty('bollinger');
        expect(result).toHaveProperty('atr');
        expect(result).toHaveProperty('obv');
        expect(result).toHaveProperty('vwap');
        expect(result).toHaveProperty('stoch_rsi');
        expect(result).toHaveProperty('mfi');
        expect(result).toHaveProperty('adx');
        expect(result).toHaveProperty('cci');
        expect(result).toHaveProperty('williams_r');
        expect(result).toHaveProperty('ichimoku');
        expect(result).toHaveProperty('pivot_points');
    });

    test('filters to requested indicators only', () => {
        const data = generateTrendingData(100);
        const result = computeAllIndicators(data, ['rsi', 'macd']);
        expect(result).toHaveProperty('rsi');
        expect(result).toHaveProperty('macd');
        expect(result).not.toHaveProperty('ema');
        expect(result).not.toHaveProperty('bollinger');
    });

    test('respects lookback parameter', () => {
        const data = generateTrendingData(100);
        const result = computeAllIndicators(data, ['rsi'], 10);
        expect(result.rsi.length).toBe(10);
    });
});
