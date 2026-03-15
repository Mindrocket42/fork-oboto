/**
 * Tests for TrainablePredictor — neural network candle predictor.
 */

import {
    TrainablePredictor,
    PredictorStore,
    NUM_FEATURES,
    FEATURE_NAMES,
    extractFeaturesAt,
    precomputeIndicators,
    FeatureNormalizer,
} from '../trainable-predictor.mjs';

// ── Test helpers ─────────────────────────────────────────────────────────

/**
 * Generate synthetic OHLCV data with a trending pattern.
 * @param {number} count - Number of candles
 * @param {string} trend - 'up' | 'down' | 'mixed'
 * @returns {Object} ohlcv
 */
function generateSyntheticData(count, trend = 'up') {
    const opens = [], highs = [], lows = [], closes = [], volumes = [];
    let price = 100;

    for (let i = 0; i < count; i++) {
        const bias = trend === 'up' ? 0.1 : trend === 'down' ? -0.1 : 0;
        const change = (Math.random() - 0.5 + bias) * 2;

        const open = price;
        const close = price + change;
        const high = Math.max(open, close) + Math.random() * Math.abs(change) + 0.1;
        const low = Math.min(open, close) - Math.random() * Math.abs(change) - 0.1;
        const volume = 1000 + Math.random() * 5000;

        opens.push(open);
        highs.push(high);
        lows.push(low);
        closes.push(close);
        volumes.push(volume);

        price = close;
    }

    return { opens, highs, lows, closes, volumes };
}

// ── Feature Extraction ───────────────────────────────────────────────────

describe('Feature Extraction', () => {
    const ohlcv = generateSyntheticData(100);

    it('has the correct number of feature names', () => {
        expect(FEATURE_NAMES.length).toBe(NUM_FEATURES);
        expect(NUM_FEATURES).toBe(28);
    });

    it('precomputeIndicators returns all expected keys', () => {
        const indicators = precomputeIndicators(ohlcv);
        expect(indicators.rsi).toBeDefined();
        expect(indicators.macd_histogram).toBeDefined();
        expect(indicators.macd_line).toBeDefined();
        expect(indicators.ema9).toBeDefined();
        expect(indicators.ema21).toBeDefined();
        expect(indicators.bb_percentB).toBeDefined();
        expect(indicators.bb_bandwidth).toBeDefined();
        expect(indicators.atr).toBeDefined();
        expect(indicators.obv).toBeDefined();
        expect(indicators.stoch_k).toBeDefined();
        expect(indicators.stoch_d).toBeDefined();
        expect(indicators.mfi).toBeDefined();
        expect(indicators.adx).toBeDefined();
        expect(indicators.plusDI).toBeDefined();
        expect(indicators.minusDI).toBeDefined();
        expect(indicators.cci).toBeDefined();
        expect(indicators.williams_r).toBeDefined();
    });

    it('extracts correct number of features at a given index', () => {
        const indicators = precomputeIndicators(ohlcv);
        const features = extractFeaturesAt(indicators, ohlcv, 80);
        expect(features.length).toBe(NUM_FEATURES);
    });

    it('produces finite feature values', () => {
        const indicators = precomputeIndicators(ohlcv);
        const features = extractFeaturesAt(indicators, ohlcv, 80);
        for (let i = 0; i < features.length; i++) {
            expect(isFinite(features[i])).toBe(true);
        }
    });

    it('handles edge case at index 0 without crashing', () => {
        const indicators = precomputeIndicators(ohlcv);
        const features = extractFeaturesAt(indicators, ohlcv, 0);
        expect(features.length).toBe(NUM_FEATURES);
        for (const f of features) {
            expect(isFinite(f)).toBe(true);
        }
    });
});

// ── FeatureNormalizer ────────────────────────────────────────────────────

describe('FeatureNormalizer', () => {
    it('normalizes to approximately zero mean after fitting', () => {
        const norm = new FeatureNormalizer(3);
        const data = [
            [10, 20, 30],
            [12, 22, 28],
            [8, 18, 32],
            [11, 21, 29],
        ];
        norm.fit(data);

        // Normalized mean should be near 0
        const normalized = data.map(d => norm.normalize(d));
        const means = [0, 0, 0];
        for (const n of normalized) {
            for (let i = 0; i < 3; i++) means[i] += n[i];
        }
        for (let i = 0; i < 3; i++) {
            means[i] /= data.length;
            expect(Math.abs(means[i])).toBeLessThan(0.5);
        }
    });

    it('clips to [-3, 3]', () => {
        const norm = new FeatureNormalizer(1);
        norm.fit([[0], [1]]);
        const extreme = norm.normalize([1000]);
        expect(extreme[0]).toBe(3);
        const extremeNeg = norm.normalize([-1000]);
        expect(extremeNeg[0]).toBe(-3);
    });

    it('serializes and deserializes correctly', () => {
        const norm = new FeatureNormalizer(3);
        norm.fit([[1, 2, 3], [4, 5, 6]]);

        const data = norm.serialize();
        const restored = FeatureNormalizer.deserialize(data);

        expect(restored.numFeatures).toBe(3);
        expect(restored.mean).toEqual(norm.mean);
        expect(restored.variance).toEqual(norm.variance);
        expect(restored.count).toBe(2);

        // Should produce same normalization
        const input = [3, 4, 5];
        expect(restored.normalize(input)).toEqual(norm.normalize(input));
    });
});

// ── TrainablePredictor ───────────────────────────────────────────────────

describe('TrainablePredictor', () => {
    // Use enough data for training (need > 54 candles minimum)
    const ohlcv = generateSyntheticData(200, 'up');

    it('constructs with default config', () => {
        const predictor = new TrainablePredictor();
        expect(predictor.config.hiddenSize1).toBe(32);
        expect(predictor.config.hiddenSize2).toBe(16);
        expect(predictor.config.learningRate).toBe(0.001);
        expect(predictor.config.horizon).toBe(2);
        expect(predictor.trained).toBe(false);
    });

    it('constructs with custom config', () => {
        const predictor = new TrainablePredictor({
            hiddenSize1: 64,
            hiddenSize2: 32,
            learningRate: 0.0005,
            horizon: 1,
        });
        expect(predictor.config.hiddenSize1).toBe(64);
        expect(predictor.config.horizon).toBe(1);
    });

    it('throws when predicting without training', () => {
        const predictor = new TrainablePredictor();
        expect(() => predictor.predict(ohlcv)).toThrow('Model not trained');
    });

    it('throws on insufficient data', () => {
        const predictor = new TrainablePredictor();
        const smallData = generateSyntheticData(30);
        expect(() => predictor.train(smallData)).toThrow('Insufficient data');
    });

    it('trains successfully and returns metrics', () => {
        const predictor = new TrainablePredictor({ horizon: 2 });
        const metrics = predictor.train(ohlcv, { epochs: 10, earlyStopPatience: 20 });

        expect(predictor.trained).toBe(true);
        expect(metrics.epochs).toBeGreaterThan(0);
        expect(metrics.epochs).toBeLessThanOrEqual(10);
        expect(metrics.trainLoss).toBeGreaterThanOrEqual(0);
        expect(metrics.valLoss).toBeGreaterThanOrEqual(0);
        expect(metrics.trainMAE).toBeGreaterThanOrEqual(0);
        expect(metrics.valMAE).toBeGreaterThanOrEqual(0);
        expect(metrics.directionAccuracy).toBeGreaterThanOrEqual(0);
        expect(metrics.directionAccuracy).toBeLessThanOrEqual(100);
        expect(metrics.samplesUsed).toBeGreaterThan(0);
        expect(metrics.trainingTimeMs).toBeGreaterThanOrEqual(0);
        expect(metrics.lossHistory.length).toBe(metrics.epochs);
    });

    it('produces valid predictions after training', () => {
        const predictor = new TrainablePredictor({ horizon: 2 });
        predictor.train(ohlcv, { epochs: 5, earlyStopPatience: 20 });

        const result = predictor.predict(ohlcv);

        expect(result.candles.length).toBe(2);
        expect(result.raw_output.length).toBe(6);
        expect(result.features_used).toEqual(FEATURE_NAMES);

        for (const candle of result.candles) {
            expect(['LONG', 'SHORT', 'NEUTRAL']).toContain(candle.direction);
            expect(candle.confidence).toBeGreaterThanOrEqual(0);
            expect(candle.confidence).toBeLessThanOrEqual(1);
            expect(typeof candle.predicted_return_pct).toBe('number');
            expect(typeof candle.predicted_volatility).toBe('number');
            expect(typeof candle.predicted_close).toBe('number');
            expect(typeof candle.predicted_high).toBe('number');
            expect(typeof candle.predicted_low).toBe('number');
            expect(candle.predicted_high).toBeGreaterThanOrEqual(candle.predicted_low);
        }
    });

    it('horizon=1 produces single candle prediction', () => {
        const predictor = new TrainablePredictor({ horizon: 1 });
        predictor.train(ohlcv, { epochs: 3, earlyStopPatience: 20 });

        const result = predictor.predict(ohlcv);
        expect(result.candles.length).toBe(1);
        expect(result.raw_output.length).toBe(3);
    });

    it('loss decreases over training epochs', () => {
        const predictor = new TrainablePredictor({ horizon: 1 });
        const metrics = predictor.train(ohlcv, { epochs: 20, earlyStopPatience: 30 });

        // The first epoch's train loss should be higher than the last
        const firstLoss = metrics.lossHistory[0].train;
        const lastLoss = metrics.lossHistory[metrics.lossHistory.length - 1].train;
        // Training should generally reduce loss (with some tolerance for randomness)
        expect(lastLoss).toBeLessThanOrEqual(firstLoss * 1.2);
    });
});

// ── Serialization ────────────────────────────────────────────────────────

describe('Serialization', () => {
    it('serialize/deserialize round-trips correctly', () => {
        const ohlcv = generateSyntheticData(200, 'down');
        const predictor = new TrainablePredictor({ horizon: 2 });
        predictor.train(ohlcv, { epochs: 5, earlyStopPatience: 20 });

        // Get prediction before serialization
        const predBefore = predictor.predict(ohlcv);

        // Serialize & deserialize
        const serialized = predictor.serialize();
        expect(serialized.version).toBe(1);
        expect(serialized.trained).toBe(true);

        const restored = TrainablePredictor.deserialize(serialized);
        expect(restored.trained).toBe(true);
        expect(restored.config).toEqual(predictor.config);

        // Predictions should be identical
        const predAfter = restored.predict(ohlcv);
        expect(predAfter.raw_output).toEqual(predBefore.raw_output);
        expect(predAfter.candles.length).toBe(predBefore.candles.length);

        for (let i = 0; i < predAfter.candles.length; i++) {
            expect(predAfter.candles[i].direction).toBe(predBefore.candles[i].direction);
            expect(predAfter.candles[i].confidence).toBe(predBefore.candles[i].confidence);
        }
    });

    it('serialized data is JSON-safe', () => {
        const ohlcv = generateSyntheticData(100);
        const predictor = new TrainablePredictor({ horizon: 1 });
        predictor.train(ohlcv, { epochs: 3, earlyStopPatience: 20 });

        const serialized = predictor.serialize();
        const json = JSON.stringify(serialized);
        const parsed = JSON.parse(json);
        const restored = TrainablePredictor.deserialize(parsed);

        expect(restored.trained).toBe(true);
        const result = restored.predict(ohlcv);
        expect(result.candles.length).toBe(1);
    });
});

// ── PredictorStore ───────────────────────────────────────────────────────

describe('PredictorStore', () => {
    let store;

    beforeEach(() => {
        store = new PredictorStore();
    });

    it('stores and retrieves a predictor', () => {
        const predictor = new TrainablePredictor();
        store.set('BTCUSDT', '1m', predictor, 200);

        expect(store.has('BTCUSDT', '1m')).toBe(true);
        expect(store.has('ETHUSDT', '1m')).toBe(false);

        const entry = store.get('BTCUSDT', '1m');
        expect(entry).not.toBeNull();
        expect(entry.symbol).toBe('BTCUSDT');
        expect(entry.timeframe).toBe('1m');
        expect(entry.candleCount).toBe(200);
        expect(entry.trainedAt).toBeDefined();
    });

    it('is case-insensitive for symbol', () => {
        const predictor = new TrainablePredictor();
        store.set('btcusdt', '5m', predictor, 100);
        expect(store.has('BTCUSDT', '5m')).toBe(true);
    });

    it('lists all models with metrics', () => {
        const ohlcv = generateSyntheticData(120);

        const p1 = new TrainablePredictor({ horizon: 1 });
        p1.train(ohlcv, { epochs: 3, earlyStopPatience: 20 });
        store.set('BTCUSDT', '1m', p1, 120);

        const p2 = new TrainablePredictor({ horizon: 2 });
        p2.train(ohlcv, { epochs: 3, earlyStopPatience: 20 });
        store.set('ETHUSDT', '5m', p2, 120);

        const list = store.list();
        expect(list.length).toBe(2);

        for (const entry of list) {
            expect(entry.trained).toBe(true);
            expect(entry.metrics).not.toBeNull();
            expect(entry.metrics.directionAccuracy).toBeDefined();
            expect(entry.metrics.valLoss).toBeDefined();
        }
    });

    it('removes a model', () => {
        store.set('BTCUSDT', '1m', new TrainablePredictor(), 100);
        expect(store.has('BTCUSDT', '1m')).toBe(true);
        store.remove('BTCUSDT', '1m');
        expect(store.has('BTCUSDT', '1m')).toBe(false);
    });

    it('exports and imports all models', () => {
        const ohlcv = generateSyntheticData(120);

        const p1 = new TrainablePredictor({ horizon: 1 });
        p1.train(ohlcv, { epochs: 3, earlyStopPatience: 20 });
        store.set('BTCUSDT', '1m', p1, 120);

        // Export
        const exported = store.exportAll();
        expect(Object.keys(exported).length).toBe(1);

        // Import into new store
        const store2 = new PredictorStore();
        store2.importAll(exported);

        expect(store2.has('BTCUSDT', '1m')).toBe(true);
        const entry = store2.get('BTCUSDT', '1m');
        expect(entry.predictor.trained).toBe(true);

        // Predictions should match
        const pred1 = p1.predict(ohlcv);
        const pred2 = entry.predictor.predict(ohlcv);
        expect(pred2.raw_output).toEqual(pred1.raw_output);
    });

    it('clears all models', () => {
        store.set('BTCUSDT', '1m', new TrainablePredictor(), 100);
        store.set('ETHUSDT', '5m', new TrainablePredictor(), 100);
        expect(store.list().length).toBe(2);

        store.clear();
        expect(store.list().length).toBe(0);
    });
});
