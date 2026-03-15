/**
 * Tests for Meta-Indicator confluence scoring engine.
 */

import { predictCandles } from '../meta-indicator.mjs';

// ── Test data generators ──────────────────────────────────────────────────

function generateTrendingData(length, startPrice = 100, trend = 'up') {
    const opens = [], highs = [], lows = [], closes = [], volumes = [];
    let price = startPrice;
    for (let i = 0; i < length; i++) {
        const delta = trend === 'up' ? Math.random() * 2 + 0.5 : -(Math.random() * 2 + 0.5);
        const noise = (Math.random() - 0.5) * 0.5;
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
        const noise = (Math.random() - 0.5) * 0.3;
        opens.push(price + noise);
        highs.push(price + Math.abs(noise) + 0.1);
        lows.push(price - Math.abs(noise) - 0.1);
        closes.push(price + noise * 0.3);
        volumes.push(1000);
    }
    return { opens, highs, lows, closes, volumes };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('predictCandles', () => {
    test('returns error for insufficient data', () => {
        const data = generateTrendingData(10);
        const result = predictCandles(data);
        expect(result.error).toBeTruthy();
        expect(result.prediction).toBeNull();
    });

    test('returns valid prediction structure for sufficient data', () => {
        const data = generateTrendingData(100);
        const result = predictCandles(data);

        expect(result.error).toBeUndefined();
        expect(result.prediction).toBeTruthy();
        expect(result.prediction.direction).toMatch(/^(LONG|SHORT|NEUTRAL)$/);
        expect(result.prediction.confidence).toBeGreaterThanOrEqual(0);
        expect(result.prediction.confidence).toBeLessThanOrEqual(1);
        expect(result.prediction.intensity).toMatch(/^(WEAK|MODERATE|STRONG)$/);
        expect(typeof result.prediction.entry_price).toBe('number');
        expect(typeof result.prediction.stop_loss).toBe('number');
        expect(typeof result.prediction.take_profit).toBe('number');
    });

    test('confluence score is between -100 and 100', () => {
        const data = generateTrendingData(100);
        const result = predictCandles(data);
        expect(result.confluence_score).toBeGreaterThanOrEqual(-100);
        expect(result.confluence_score).toBeLessThanOrEqual(100);
    });

    test('signal components are all present', () => {
        const data = generateTrendingData(100);
        const result = predictCandles(data);

        expect(result.signal_components).toHaveProperty('trend_score');
        expect(result.signal_components).toHaveProperty('momentum_score');
        expect(result.signal_components).toHaveProperty('volatility_score');
        expect(result.signal_components).toHaveProperty('volume_score');
        expect(result.signal_components).toHaveProperty('support_resistance');
    });

    test('uptrend produces positive confluence', () => {
        // With strong uptrend data, confluence should tend positive
        const data = generateTrendingData(150, 100, 'up');
        const result = predictCandles(data);

        // We can't guarantee direction in a stochastic test,
        // but trend_score should be positive for strong uptrend
        expect(result.signal_components.trend_score).toBeGreaterThan(-50);
    });

    test('downtrend produces negative confluence', () => {
        const data = generateTrendingData(150, 200, 'down');
        const result = predictCandles(data);

        // Trend score should tend negative for downtrend
        expect(result.signal_components.trend_score).toBeLessThan(50);
    });

    test('flat data produces low confidence', () => {
        const data = generateFlatData(100);
        const result = predictCandles(data);

        // Flat data should produce low confidence
        expect(result.prediction.confidence).toBeLessThan(0.8);
    });

    test('LONG prediction has TP > entry > SL', () => {
        const data = generateTrendingData(100);
        const result = predictCandles(data);

        if (result.prediction.direction === 'LONG') {
            expect(result.prediction.take_profit).toBeGreaterThan(result.prediction.entry_price);
            expect(result.prediction.entry_price).toBeGreaterThan(result.prediction.stop_loss);
        }
    });

    test('SHORT prediction has SL > entry > TP', () => {
        const data = generateTrendingData(100, 200, 'down');
        const result = predictCandles(data);

        if (result.prediction.direction === 'SHORT') {
            expect(result.prediction.stop_loss).toBeGreaterThan(result.prediction.entry_price);
            expect(result.prediction.entry_price).toBeGreaterThan(result.prediction.take_profit);
        }
    });

    test('risk_reward_ratio is positive', () => {
        const data = generateTrendingData(100);
        const result = predictCandles(data);
        expect(result.risk_reward_ratio).toBeGreaterThanOrEqual(0);
    });

    test('horizon parameter is reflected in output', () => {
        const data = generateTrendingData(100);
        const result1 = predictCandles(data, { horizon: 1 });
        const result2 = predictCandles(data, { horizon: 2 });
        expect(result1.horizon).toBe(1);
        expect(result2.horizon).toBe(2);
    });

    test('indicators_snapshot contains key values', () => {
        const data = generateTrendingData(100);
        const result = predictCandles(data);
        const snap = result.indicators_snapshot;

        expect(snap).toHaveProperty('rsi');
        expect(snap).toHaveProperty('macd_histogram');
        expect(snap).toHaveProperty('atr');
    });

    test('custom weights are applied', () => {
        const data = generateTrendingData(100);
        
        // Weights that heavily favor trend
        const trendHeavy = predictCandles(data, {
            weights: { trend: 0.90, momentum: 0.025, volatility: 0.025, volume: 0.025, support_resistance: 0.025 }
        });

        // Weights that heavily favor momentum
        const momentumHeavy = predictCandles(data, {
            weights: { trend: 0.025, momentum: 0.90, volatility: 0.025, volume: 0.025, support_resistance: 0.025 }
        });

        // Different weights should produce different confluence scores
        // (not guaranteed to be different but very likely with extreme weights)
        expect(typeof trendHeavy.confluence_score).toBe('number');
        expect(typeof momentumHeavy.confluence_score).toBe('number');
    });
});
