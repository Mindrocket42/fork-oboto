/**
 * Trainable Candle Predictor — Pure JavaScript Neural Network
 *
 * A lightweight feedforward neural network that learns to predict the next
 * 1-2 candles from technical indicator features. Trained via backpropagation
 * with the Adam optimizer.
 *
 * Architecture:
 *   Input (28 features) → Hidden1 (32, tanh) → Hidden2 (16, tanh) → Output (6, tanh)
 *
 * Output encodes:
 *   [candle1_direction, candle1_magnitude, candle1_volatility,
 *    candle2_direction, candle2_magnitude, candle2_volatility]
 *
 * Features are extracted from the 15 technical indicators + price/volume
 * patterns, normalized to [-1, 1] using running statistics stored with
 * the model.
 *
 * @module @oboto/plugin-trading-chart/lib/trainable-predictor
 */

import {
    rsi, macd, ema, sma, bollingerBands, atr, obv,
    stochRsi, mfi, adx, cci, williamsR,
} from './indicators.mjs';

// ── Neural Network Primitives ────────────────────────────────────────────

/** Xavier/Glorot initialization */
function initWeight(fanIn, fanOut) {
    const limit = Math.sqrt(6 / (fanIn + fanOut));
    return (Math.random() * 2 - 1) * limit;
}

/** Activation functions */
const activations = {
    tanh: {
        fn: (x) => Math.tanh(x),
        dfn: (y) => 1 - y * y,
    },
    linear: {
        fn: (x) => x,
        dfn: () => 1,
    },
};

/**
 * Dense (fully connected) layer.
 */
class DenseLayer {
    /**
     * @param {number} inputSize
     * @param {number} outputSize
     * @param {string} activation - 'tanh' | 'linear'
     */
    constructor(inputSize, outputSize, activation = 'tanh') {
        this.inputSize = inputSize;
        this.outputSize = outputSize;
        this.activation = activations[activation];
        this.activationName = activation;

        // Weights: [outputSize x inputSize]
        this.weights = [];
        for (let o = 0; o < outputSize; o++) {
            const row = [];
            for (let i = 0; i < inputSize; i++) {
                row.push(initWeight(inputSize, outputSize));
            }
            this.weights.push(row);
        }

        // Biases: [outputSize]
        this.biases = new Array(outputSize).fill(0);

        // Cache for backprop
        this.input = null;
        this.preActivation = null;
        this.output = null;

        // Adam optimizer state
        this.mW = this.weights.map(row => row.map(() => 0));
        this.vW = this.weights.map(row => row.map(() => 0));
        this.mB = new Array(outputSize).fill(0);
        this.vB = new Array(outputSize).fill(0);
    }

    /**
     * Forward pass.
     * @param {number[]} input
     * @returns {number[]}
     */
    forward(input) {
        this.input = input;
        this.preActivation = [];
        this.output = [];

        for (let o = 0; o < this.outputSize; o++) {
            let sum = this.biases[o];
            for (let i = 0; i < this.inputSize; i++) {
                sum += this.weights[o][i] * input[i];
            }
            this.preActivation.push(sum);
            this.output.push(this.activation.fn(sum));
        }

        return this.output;
    }

    /**
     * Backward pass — computes gradients and returns input gradient.
     * @param {number[]} outputGrad
     * @param {number} lr
     * @param {number} t - Adam timestep
     * @param {number} beta1
     * @param {number} beta2
     * @param {number} epsilon
     * @returns {number[]} gradient w.r.t. input
     */
    backward(outputGrad, lr, t, beta1 = 0.9, beta2 = 0.999, epsilon = 1e-8) {
        const inputGrad = new Array(this.inputSize).fill(0);

        for (let o = 0; o < this.outputSize; o++) {
            const dActivation = this.activation.dfn(this.output[o]);
            const delta = outputGrad[o] * dActivation;

            for (let i = 0; i < this.inputSize; i++) {
                const grad = delta * this.input[i];
                inputGrad[i] += delta * this.weights[o][i];

                // Adam update for weight
                this.mW[o][i] = beta1 * this.mW[o][i] + (1 - beta1) * grad;
                this.vW[o][i] = beta2 * this.vW[o][i] + (1 - beta2) * grad * grad;
                const mHat = this.mW[o][i] / (1 - Math.pow(beta1, t));
                const vHat = this.vW[o][i] / (1 - Math.pow(beta2, t));
                this.weights[o][i] -= lr * mHat / (Math.sqrt(vHat) + epsilon);
            }

            // Adam update for bias
            const bGrad = delta;
            this.mB[o] = beta1 * this.mB[o] + (1 - beta1) * bGrad;
            this.vB[o] = beta2 * this.vB[o] + (1 - beta2) * bGrad * bGrad;
            const mHatB = this.mB[o] / (1 - Math.pow(beta1, t));
            const vHatB = this.vB[o] / (1 - Math.pow(beta2, t));
            this.biases[o] -= lr * mHatB / (Math.sqrt(vHatB) + epsilon);
        }

        return inputGrad;
    }

    serialize() {
        return {
            inputSize: this.inputSize,
            outputSize: this.outputSize,
            activation: this.activationName,
            weights: this.weights.map(row => [...row]),
            biases: [...this.biases],
        };
    }

    static deserialize(data) {
        const layer = new DenseLayer(data.inputSize, data.outputSize, data.activation);
        layer.weights = data.weights.map(row => [...row]);
        layer.biases = [...data.biases];
        layer.mW = layer.weights.map(row => row.map(() => 0));
        layer.vW = layer.weights.map(row => row.map(() => 0));
        layer.mB = new Array(data.outputSize).fill(0);
        layer.vB = new Array(data.outputSize).fill(0);
        return layer;
    }
}

// ── Feature Extraction ───────────────────────────────────────────────────

const NUM_FEATURES = 28;

const FEATURE_NAMES = [
    'return_1', 'return_2', 'return_3', 'return_5',
    'body_ratio_1', 'body_ratio_2',
    'upper_wick_ratio', 'lower_wick_ratio',
    'rsi_14', 'macd_histogram', 'macd_line',
    'ema9_ratio', 'ema21_ratio', 'ema_cross',
    'bb_percentB', 'bb_bandwidth',
    'atr_ratio',
    'stoch_rsi_k', 'stoch_rsi_d',
    'mfi_14',
    'adx_14', 'di_diff',
    'cci_20', 'williams_r_14',
    'vol_ratio_1', 'vol_ratio_3', 'vol_ratio_5', 'obv_slope',
];

/**
 * Extract raw features from OHLCV + indicator arrays at a given position.
 */
function extractFeaturesAt(indicators, ohlcv, idx) {
    const { opens, highs, lows, closes, volumes } = ohlcv;
    const c = closes[idx];
    const o = opens[idx];
    const h = highs[idx];
    const l = lows[idx];

    const ret = (i) => idx >= i ? (closes[idx] - closes[idx - i]) / closes[idx - i] * 100 : 0;
    const return_1 = ret(1);
    const return_2 = ret(2);
    const return_3 = ret(3);
    const return_5 = ret(5);

    const range = h - l || 1e-10;
    const body = Math.abs(c - o);
    const body_ratio_1 = body / range;
    const body_ratio_2 = idx >= 1
        ? Math.abs(closes[idx - 1] - opens[idx - 1]) / (highs[idx - 1] - lows[idx - 1] || 1e-10)
        : 0.5;
    const upper_wick = h - Math.max(o, c);
    const lower_wick = Math.min(o, c) - l;
    const upper_wick_ratio = upper_wick / range;
    const lower_wick_ratio = lower_wick / range;

    const val = (arr, i) => (arr && arr[i] != null) ? arr[i] : 0;

    const rsi_14 = val(indicators.rsi, idx) / 50 - 1;
    const macd_hist = val(indicators.macd_histogram, idx);
    const macd_l = val(indicators.macd_line, idx);

    const atrVal = val(indicators.atr, idx) || c * 0.01;
    const ema9Val = val(indicators.ema9, idx) || c;
    const ema21Val = val(indicators.ema21, idx) || c;
    const ema9_ratio = (c - ema9Val) / atrVal;
    const ema21_ratio = (c - ema21Val) / atrVal;
    const ema_cross = (ema9Val - ema21Val) / atrVal;

    const bb_pctB = val(indicators.bb_percentB, idx) * 2 - 1;
    const bb_bw = val(indicators.bb_bandwidth, idx) / (c || 1) * 10;

    const atr_ratio = atrVal / c * 100;

    const stoch_k = val(indicators.stoch_k, idx) / 50 - 1;
    const stoch_d = val(indicators.stoch_d, idx) / 50 - 1;
    const mfi_val = val(indicators.mfi, idx) / 50 - 1;

    const adx_val = val(indicators.adx, idx) / 50 - 1;
    const plusDI = val(indicators.plusDI, idx);
    const minusDI = val(indicators.minusDI, idx);
    const di_diff = (plusDI - minusDI) / 50;

    const cci_val = val(indicators.cci, idx) / 200;
    const wr_val = val(indicators.williams_r, idx) / 50 + 1;

    const avgVol = (n) => {
        if (idx < n) return volumes[idx] || 1;
        let s = 0;
        for (let j = idx - n; j < idx; j++) s += volumes[j] || 0;
        return (s / n) || 1;
    };
    const vol_ratio_1 = (volumes[idx] || 0) / avgVol(10);
    const vol_ratio_3 = avgVol(3) / avgVol(10);
    const vol_ratio_5 = avgVol(5) / avgVol(20);

    const obv_slope_val = idx >= 5
        ? (val(indicators.obv, idx) - val(indicators.obv, idx - 5)) / (avgVol(10) * 5 || 1)
        : 0;

    return [
        return_1, return_2, return_3, return_5,
        body_ratio_1, body_ratio_2,
        upper_wick_ratio, lower_wick_ratio,
        rsi_14, macd_hist, macd_l,
        ema9_ratio, ema21_ratio, ema_cross,
        bb_pctB, bb_bw,
        atr_ratio,
        stoch_k, stoch_d,
        mfi_val,
        adx_val, di_diff,
        cci_val, wr_val,
        vol_ratio_1, vol_ratio_3, vol_ratio_5, obv_slope_val,
    ];
}

/**
 * Pre-compute all indicator arrays (full-length) for feature extraction.
 */
function precomputeIndicators(ohlcv) {
    const { highs, lows, closes, volumes } = ohlcv;

    const rsiArr = rsi(closes, 14);
    const macdResult = macd(closes, 12, 26, 9);
    const ema9Arr = ema(closes, 9);
    const ema21Arr = ema(closes, 21);
    const bbResult = bollingerBands(closes, 20, 2);
    const atrArr = atr(highs, lows, closes, 14);
    const obvArr = obv(closes, volumes);
    const stochResult = stochRsi(closes, 14, 14, 3, 3);
    const mfiArr = mfi(highs, lows, closes, volumes, 14);
    const adxResult = adx(highs, lows, closes, 14);
    const cciArr = cci(highs, lows, closes, 20);
    const wrArr = williamsR(highs, lows, closes, 14);

    return {
        rsi: rsiArr,
        macd_histogram: macdResult.histogram,
        macd_line: macdResult.line,
        ema9: ema9Arr,
        ema21: ema21Arr,
        bb_percentB: bbResult.percentB,
        bb_bandwidth: bbResult.bandwidth,
        atr: atrArr,
        obv: obvArr,
        stoch_k: stochResult.k,
        stoch_d: stochResult.d,
        mfi: mfiArr,
        adx: adxResult.adx,
        plusDI: adxResult.plusDI,
        minusDI: adxResult.minusDI,
        cci: cciArr,
        williams_r: wrArr,
    };
}

// ── Feature Normalizer ───────────────────────────────────────────────────

class FeatureNormalizer {
    constructor(numFeatures) {
        this.numFeatures = numFeatures;
        this.mean = new Array(numFeatures).fill(0);
        this.variance = new Array(numFeatures).fill(1);
        this.count = 0;
    }

    /**
     * Fit normalizer on a batch of feature vectors (Welford's online algorithm).
     */
    fit(featureBatch) {
        for (const features of featureBatch) {
            this.count++;
            for (let i = 0; i < this.numFeatures; i++) {
                const delta = features[i] - this.mean[i];
                this.mean[i] += delta / this.count;
                const delta2 = features[i] - this.mean[i];
                this.variance[i] += (delta * delta2 - this.variance[i]) / this.count;
            }
        }
    }

    /**
     * Normalize a single feature vector (z-score, clipped to [-3, 3]).
     */
    normalize(features) {
        return features.map((f, i) => {
            const std = Math.sqrt(Math.max(0, this.variance[i])) || 1;
            return Math.max(-3, Math.min(3, (f - this.mean[i]) / std));
        });
    }

    serialize() {
        return {
            numFeatures: this.numFeatures,
            mean: [...this.mean],
            variance: [...this.variance],
            count: this.count,
        };
    }

    static deserialize(data) {
        const norm = new FeatureNormalizer(data.numFeatures);
        norm.mean = [...data.mean];
        norm.variance = [...data.variance];
        norm.count = data.count;
        return norm;
    }
}

// ── Trainable Predictor ──────────────────────────────────────────────────

export class TrainablePredictor {
    constructor(config = {}) {
        this.config = {
            hiddenSize1: config.hiddenSize1 || 32,
            hiddenSize2: config.hiddenSize2 || 16,
            learningRate: config.learningRate || 0.001,
            horizon: config.horizon || 2,
        };

        const outputSize = this.config.horizon * 3;

        this.layers = [
            new DenseLayer(NUM_FEATURES, this.config.hiddenSize1, 'tanh'),
            new DenseLayer(this.config.hiddenSize1, this.config.hiddenSize2, 'tanh'),
            new DenseLayer(this.config.hiddenSize2, outputSize, 'tanh'),
        ];

        this.normalizer = new FeatureNormalizer(NUM_FEATURES);
        this.trained = false;
        this.trainStep = 0;
        this.metrics = null;
    }

    _forward(input) {
        let x = input;
        for (const layer of this.layers) {
            x = layer.forward(x);
        }
        return x;
    }

    _backward(lossGrad) {
        this.trainStep++;
        let grad = lossGrad;
        for (let i = this.layers.length - 1; i >= 0; i--) {
            grad = this.layers[i].backward(
                grad, this.config.learningRate, this.trainStep
            );
        }
    }

    /**
     * Build training dataset from OHLCV data.
     *
     * Targets per candle: [direction, magnitude, volatility]
     *   - direction: tanh(return * 10)
     *   - magnitude: tanh(abs(return) * 5)
     *   - volatility: tanh((high-low)/close * 100)
     */
    _buildDataset(ohlcv) {
        const { highs, lows, closes } = ohlcv;
        const indicators = precomputeIndicators(ohlcv);
        const horizon = this.config.horizon;

        const minIdx = 52; // need history for longest indicator (Ichimoku)
        const maxIdx = closes.length - horizon;

        if (maxIdx <= minIdx) {
            throw new Error(`Insufficient data: need at least ${minIdx + horizon + 1} candles, got ${closes.length}`);
        }

        const features = [];
        const targets = [];

        for (let i = minIdx; i < maxIdx; i++) {
            const feat = extractFeaturesAt(indicators, ohlcv, i);

            const target = [];
            for (let h = 1; h <= horizon; h++) {
                const futureIdx = i + h;
                const returnPct = (closes[futureIdx] - closes[i]) / closes[i] * 100;
                const volatilityPct = (highs[futureIdx] - lows[futureIdx]) / closes[i] * 100;

                target.push(
                    Math.tanh(returnPct * 10),
                    Math.tanh(Math.abs(returnPct) * 5),
                    Math.tanh(volatilityPct * 5),
                );
            }

            features.push(feat);
            targets.push(target);
        }

        return { features, targets };
    }

    /**
     * Train the network on OHLCV data.
     *
     * @param {Object} ohlcv - { opens, highs, lows, closes, volumes }
     * @param {Object} [options]
     * @param {number} [options.epochs=50]
     * @param {number} [options.validationSplit=0.2]
     * @param {boolean} [options.shuffle=true]
     * @param {number} [options.earlyStopPatience=10]
     * @returns {TrainingResult}
     */
    train(ohlcv, options = {}) {
        const {
            epochs = 50,
            validationSplit = 0.2,
            shuffle = true,
            earlyStopPatience = 10,
        } = options;

        const startTime = Date.now();

        const { features, targets } = this._buildDataset(ohlcv);

        // Fit normalizer
        this.normalizer = new FeatureNormalizer(NUM_FEATURES);
        this.normalizer.fit(features);

        const normalizedFeatures = features.map(f => this.normalizer.normalize(f));

        // Split train/validation
        const splitIdx = Math.floor(normalizedFeatures.length * (1 - validationSplit));
        const trainX = normalizedFeatures.slice(0, splitIdx);
        const trainY = targets.slice(0, splitIdx);
        const valX = normalizedFeatures.slice(splitIdx);
        const valY = targets.slice(splitIdx);

        // Re-initialize layers
        const outputSize = this.config.horizon * 3;
        this.layers = [
            new DenseLayer(NUM_FEATURES, this.config.hiddenSize1, 'tanh'),
            new DenseLayer(this.config.hiddenSize1, this.config.hiddenSize2, 'tanh'),
            new DenseLayer(this.config.hiddenSize2, outputSize, 'tanh'),
        ];
        this.trainStep = 0;

        const lossHistory = [];
        let bestValLoss = Infinity;
        let patience = 0;
        let bestWeights = null;

        for (let epoch = 0; epoch < epochs; epoch++) {
            const indices = Array.from({ length: trainX.length }, (_, i) => i);
            if (shuffle) {
                for (let i = indices.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [indices[i], indices[j]] = [indices[j], indices[i]];
                }
            }

            let epochLoss = 0;
            for (const idx of indices) {
                const output = this._forward(trainX[idx]);
                const target = trainY[idx];

                const lossGrad = [];
                let sampleLoss = 0;
                for (let k = 0; k < output.length; k++) {
                    const diff = output[k] - target[k];
                    sampleLoss += diff * diff;
                    lossGrad.push(2 * diff / output.length);
                }
                epochLoss += sampleLoss / output.length;
                this._backward(lossGrad);
            }
            epochLoss /= trainX.length;

            let valLoss = 0;
            for (let i = 0; i < valX.length; i++) {
                const output = this._forward(valX[i]);
                for (let k = 0; k < output.length; k++) {
                    const diff = output[k] - valY[i][k];
                    valLoss += diff * diff / output.length;
                }
            }
            valLoss /= valX.length || 1;

            lossHistory.push({ epoch, trainLoss: epochLoss, valLoss });

            if (valLoss < bestValLoss) {
                bestValLoss = valLoss;
                patience = 0;
                bestWeights = this.serialize();
            } else {
                patience++;
                if (patience >= earlyStopPatience) {
                    if (bestWeights) {
                        const restored = TrainablePredictor.deserialize(bestWeights);
                        this.layers = restored.layers;
                        this.normalizer = restored.normalizer;
                    }
                    break;
                }
            }
        }

        // Final metrics
        const trainMetrics = this._computeMetrics(trainX, trainY);
        const valMetrics = this._computeMetrics(valX, valY);

        // Direction accuracy on validation
        let correctDir = 0;
        for (let i = 0; i < valX.length; i++) {
            const output = this._forward(valX[i]);
            const predDir = output[0] > 0 ? 1 : -1;
            const actualDir = valY[i][0] > 0 ? 1 : -1;
            if (predDir === actualDir) correctDir++;
        }
        const directionAccuracy = valX.length > 0 ? (correctDir / valX.length) * 100 : 0;

        this.trained = true;
        this.metrics = {
            epochs: lossHistory.length,
            trainLoss: trainMetrics.mse,
            valLoss: valMetrics.mse,
            trainMAE: trainMetrics.mae,
            valMAE: valMetrics.mae,
            directionAccuracy: Math.round(directionAccuracy * 100) / 100,
            lossHistory: lossHistory.map(h => ({ epoch: h.epoch, train: h.trainLoss, val: h.valLoss })),
            samplesUsed: trainX.length + valX.length,
            trainingTimeMs: Date.now() - startTime,
        };

        return this.metrics;
    }

    _computeMetrics(X, Y) {
        if (X.length === 0) return { mse: 0, mae: 0 };
        let mse = 0, mae = 0;
        for (let i = 0; i < X.length; i++) {
            const output = this._forward(X[i]);
            for (let k = 0; k < output.length; k++) {
                const diff = output[k] - Y[i][k];
                mse += diff * diff;
                mae += Math.abs(diff);
            }
        }
        const n = X.length * Y[0].length;
        return {
            mse: Math.round((mse / n) * 100000) / 100000,
            mae: Math.round((mae / n) * 100000) / 100000,
        };
    }

    /**
     * Generate predictions for the next candles.
     */
    predict(ohlcv) {
        if (!this.trained) {
            throw new Error('Model not trained. Call train() first.');
        }

        const { closes } = ohlcv;
        const indicators = precomputeIndicators(ohlcv);
        const lastIdx = closes.length - 1;

        const rawFeatures = extractFeaturesAt(indicators, ohlcv, lastIdx);
        const normalized = this.normalizer.normalize(rawFeatures);
        const output = this._forward(normalized);

        const currentPrice = closes[lastIdx];

        const candles = [];
        for (let h = 0; h < this.config.horizon; h++) {
            const dirSignal = output[h * 3];
            const magSignal = output[h * 3 + 1];
            const volSignal = output[h * 3 + 2];

            const direction = dirSignal > 0.1 ? 'LONG' : dirSignal < -0.1 ? 'SHORT' : 'NEUTRAL';
            const confidence = Math.min(1, Math.abs(dirSignal));

            // Inverse-tanh to recover the encoded return percentage
            const clampedDir = Math.max(-0.99, Math.min(0.99, dirSignal));
            const returnPct = Math.atanh(clampedDir) / 10;

            const clampedVol = Math.max(0.01, Math.min(0.99, Math.abs(volSignal)));
            const volatilityPct = Math.atanh(clampedVol) / 5;

            const predictedClose = currentPrice * (1 + returnPct / 100);
            const halfRange = currentPrice * volatilityPct / 100 / 2;

            candles.push({
                candle: h + 1,
                direction,
                confidence: Math.round(confidence * 1000) / 1000,
                predicted_return_pct: Math.round(returnPct * 10000) / 10000,
                predicted_volatility: Math.round(volatilityPct * 10000) / 10000,
                predicted_close: Math.round(predictedClose * 100) / 100,
                predicted_high: Math.round((predictedClose + halfRange) * 100) / 100,
                predicted_low: Math.round((predictedClose - halfRange) * 100) / 100,
            });
        }

        return {
            candles,
            raw_output: output.map(v => Math.round(v * 10000) / 10000),
            features_used: FEATURE_NAMES,
        };
    }

    getMetrics() {
        return this.metrics;
    }

    serialize() {
        return {
            version: 1,
            config: { ...this.config },
            layers: this.layers.map(l => l.serialize()),
            normalizer: this.normalizer.serialize(),
            trained: this.trained,
            trainStep: this.trainStep,
            metrics: this.metrics ? {
                epochs: this.metrics.epochs,
                trainLoss: this.metrics.trainLoss,
                valLoss: this.metrics.valLoss,
                trainMAE: this.metrics.trainMAE,
                valMAE: this.metrics.valMAE,
                directionAccuracy: this.metrics.directionAccuracy,
                samplesUsed: this.metrics.samplesUsed,
                trainingTimeMs: this.metrics.trainingTimeMs,
            } : null,
        };
    }

    static deserialize(data) {
        const predictor = new TrainablePredictor(data.config);
        predictor.layers = data.layers.map(l => DenseLayer.deserialize(l));
        predictor.normalizer = FeatureNormalizer.deserialize(data.normalizer);
        predictor.trained = data.trained;
        predictor.trainStep = data.trainStep;
        predictor.metrics = data.metrics;
        return predictor;
    }
}

// ── Model Store ──────────────────────────────────────────────────────────

/**
 * In-memory store for trained predictor models, keyed by symbol_timeframe.
 */
export class PredictorStore {
    constructor() {
        this.models = new Map();
    }

    _key(symbol, timeframe) {
        return `${symbol.toUpperCase()}_${timeframe}`;
    }

    set(symbol, timeframe, predictor, candleCount) {
        this.models.set(this._key(symbol, timeframe), {
            predictor,
            trainedAt: new Date().toISOString(),
            symbol: symbol.toUpperCase(),
            timeframe,
            candleCount,
        });
    }

    get(symbol, timeframe) {
        return this.models.get(this._key(symbol, timeframe)) || null;
    }

    has(symbol, timeframe) {
        return this.models.has(this._key(symbol, timeframe));
    }

    list() {
        const results = [];
        for (const [key, entry] of this.models) {
            const metrics = entry.predictor.getMetrics();
            results.push({
                key,
                symbol: entry.symbol,
                timeframe: entry.timeframe,
                trainedAt: entry.trainedAt,
                candleCount: entry.candleCount,
                trained: entry.predictor.trained,
                metrics: metrics ? {
                    epochs: metrics.epochs,
                    trainLoss: metrics.trainLoss,
                    valLoss: metrics.valLoss,
                    trainMAE: metrics.trainMAE,
                    valMAE: metrics.valMAE,
                    directionAccuracy: metrics.directionAccuracy,
                    samplesUsed: metrics.samplesUsed,
                    trainingTimeMs: metrics.trainingTimeMs,
                } : null,
            });
        }
        return results;
    }

    remove(symbol, timeframe) {
        return this.models.delete(this._key(symbol, timeframe));
    }

    exportAll() {
        const data = {};
        for (const [key, entry] of this.models) {
            data[key] = {
                symbol: entry.symbol,
                timeframe: entry.timeframe,
                trainedAt: entry.trainedAt,
                candleCount: entry.candleCount,
                predictor: entry.predictor.serialize(),
            };
        }
        return data;
    }

    importAll(data) {
        for (const [key, entry] of Object.entries(data)) {
            this.models.set(key, {
                symbol: entry.symbol,
                timeframe: entry.timeframe,
                trainedAt: entry.trainedAt,
                candleCount: entry.candleCount,
                predictor: TrainablePredictor.deserialize(entry.predictor),
            });
        }
    }

    clear() {
        this.models.clear();
    }
}

// Export for testing
export { NUM_FEATURES, FEATURE_NAMES, extractFeaturesAt, precomputeIndicators, FeatureNormalizer };
