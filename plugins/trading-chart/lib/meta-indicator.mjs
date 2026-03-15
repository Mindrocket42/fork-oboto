/**
 * Meta-Indicator — Confluence Scoring Engine
 *
 * Combines all technical indicators into a single directional signal
 * with confidence level and intensity rating.
 *
 * The confluence score is a weighted sum of sub-scores:
 *   confluence = w_trend * trend + w_momentum * momentum
 *              + w_volatility * volatility + w_volume * volume
 *              + w_sr * support_resistance
 *
 * Each sub-score ranges from -100 (strong short) to +100 (strong long).
 * The final confluence score maps to direction, confidence, and intensity.
 *
 * @module @oboto/plugin-trading-chart/lib/meta-indicator
 */

import { computeAllIndicators } from './indicators.mjs';

// ── Default weights ──────────────────────────────────────────────────────

const DEFAULT_WEIGHTS = {
    trend: 0.30,
    momentum: 0.25,
    volatility: 0.20,
    volume: 0.15,
    support_resistance: 0.10,
};

// ── Sub-score computations ───────────────────────────────────────────────

/**
 * Get the last non-null value from an array.
 * @param {(number|null)[]} arr
 * @returns {number|null}
 */
function last(arr) {
    if (!arr) return null;
    for (let i = arr.length - 1; i >= 0; i--) {
        if (arr[i] !== null && arr[i] !== undefined) return arr[i];
    }
    return null;
}

/**
 * Get the Nth-from-last non-null value.
 * @param {(number|null)[]} arr
 * @param {number} n - 0 = last, 1 = second to last, etc.
 * @returns {number|null}
 */
function nthLast(arr, n) {
    if (!arr) return null;
    let count = 0;
    for (let i = arr.length - 1; i >= 0; i--) {
        if (arr[i] !== null && arr[i] !== undefined) {
            if (count === n) return arr[i];
            count++;
        }
    }
    return null;
}

/**
 * Clamp a value between -100 and +100.
 * @param {number} v
 * @returns {number}
 */
function clamp100(v) {
    return Math.max(-100, Math.min(100, v));
}

/**
 * Compute trend sub-score from EMA alignment, ADX, and Ichimoku.
 *
 * Components:
 * - EMA alignment (9 > 21 > 50 = bullish, inverse = bearish): ±40 points
 * - ADX trend strength: ±30 points (signed by +DI/-DI dominance)
 * - Ichimoku cloud position: ±30 points
 *
 * @param {Object} indicators - Computed indicators from computeAllIndicators
 * @param {number} currentPrice - Current close price
 * @returns {number} Score from -100 to +100
 */
function computeTrendScore(indicators, currentPrice) {
    let score = 0;

    // EMA alignment — check 9 > 21 > 50 (bullish) or 9 < 21 < 50 (bearish)
    if (indicators.ema) {
        const ema9 = last(indicators.ema.ema9);
        const ema21 = last(indicators.ema.ema21);
        const ema50 = last(indicators.ema.ema50);

        if (ema9 !== null && ema21 !== null && ema50 !== null) {
            if (ema9 > ema21 && ema21 > ema50) {
                // Perfect bullish alignment
                score += 40;
            } else if (ema9 < ema21 && ema21 < ema50) {
                // Perfect bearish alignment
                score -= 40;
            } else if (ema9 > ema21) {
                // Partial bullish — short-term up
                score += 20;
            } else if (ema9 < ema21) {
                // Partial bearish — short-term down
                score -= 20;
            }

            // EMA crossover detection (recent cross)
            const prevEma9 = nthLast(indicators.ema.ema9, 1);
            const prevEma21 = nthLast(indicators.ema.ema21, 1);
            if (prevEma9 !== null && prevEma21 !== null) {
                if (prevEma9 < prevEma21 && ema9 > ema21) {
                    score += 10; // Bullish crossover just happened
                } else if (prevEma9 > prevEma21 && ema9 < ema21) {
                    score -= 10; // Bearish crossover just happened
                }
            }
        }
    }

    // ADX trend strength — strong trend in +DI/-DI direction
    if (indicators.adx) {
        const adxVal = last(indicators.adx.adx);
        const plusDI = last(indicators.adx.plusDI);
        const minusDI = last(indicators.adx.minusDI);

        if (adxVal !== null && plusDI !== null && minusDI !== null) {
            const strength = Math.min(adxVal / 50, 1); // Normalize to 0-1
            if (plusDI > minusDI) {
                score += 30 * strength;
            } else {
                score -= 30 * strength;
            }
        }
    }

    // Ichimoku — price relative to cloud
    if (indicators.ichimoku) {
        const senkouA = last(indicators.ichimoku.senkouA);
        const senkouB = last(indicators.ichimoku.senkouB);

        if (senkouA !== null && senkouB !== null) {
            const cloudTop = Math.max(senkouA, senkouB);
            const cloudBottom = Math.min(senkouA, senkouB);

            if (currentPrice > cloudTop) {
                score += 30; // Above cloud = bullish
            } else if (currentPrice < cloudBottom) {
                score -= 30; // Below cloud = bearish
            } else {
                // Inside cloud = neutral/indecisive
                score += 0;
            }
        }
    }

    return clamp100(score);
}

/**
 * Compute momentum sub-score from RSI, MACD, and Stochastic RSI.
 *
 * Components:
 * - RSI position + direction: ±35 points
 * - MACD histogram direction + crossover: ±35 points
 * - Stochastic RSI crossover: ±30 points
 *
 * @param {Object} indicators
 * @returns {number} Score from -100 to +100
 */
function computeMomentumScore(indicators) {
    let score = 0;

    // RSI
    if (indicators.rsi) {
        const rsiVal = last(indicators.rsi);
        const prevRsi = nthLast(indicators.rsi, 1);

        if (rsiVal !== null) {
            // Overbought/Oversold zones
            if (rsiVal > 70) {
                score -= 15; // Overbought — bearish pressure
            } else if (rsiVal < 30) {
                score += 15; // Oversold — bullish pressure
            } else if (rsiVal > 50) {
                score += 10; // Bullish bias
            } else {
                score -= 10; // Bearish bias
            }

            // RSI direction (rising/falling)
            if (prevRsi !== null) {
                const rsiDelta = rsiVal - prevRsi;
                score += clamp100(rsiDelta * 2); // Scale direction, max ±20
            }
        }
    }

    // MACD
    if (indicators.macd) {
        const hist = last(indicators.macd.histogram);
        const prevHist = nthLast(indicators.macd.histogram, 1);
        const macdLine = last(indicators.macd.line);
        const signalLine = last(indicators.macd.signal);
        const prevMacdLine = nthLast(indicators.macd.line, 1);
        const prevSignalLine = nthLast(indicators.macd.signal, 1);

        if (hist !== null) {
            // Histogram direction
            score += hist > 0 ? 15 : -15;

            // Histogram momentum (expanding vs contracting)
            if (prevHist !== null) {
                if (Math.abs(hist) > Math.abs(prevHist)) {
                    score += hist > 0 ? 10 : -10; // Expanding = stronger signal
                }
            }
        }

        // MACD line crossover
        if (macdLine !== null && signalLine !== null && prevMacdLine !== null && prevSignalLine !== null) {
            if (prevMacdLine < prevSignalLine && macdLine > signalLine) {
                score += 10; // Bullish crossover
            } else if (prevMacdLine > prevSignalLine && macdLine < signalLine) {
                score -= 10; // Bearish crossover
            }
        }
    }

    // Stochastic RSI
    if (indicators.stoch_rsi) {
        const k = last(indicators.stoch_rsi.k);
        const d = last(indicators.stoch_rsi.d);
        const prevK = nthLast(indicators.stoch_rsi.k, 1);
        const prevD = nthLast(indicators.stoch_rsi.d, 1);

        if (k !== null && d !== null) {
            // Overbought/Oversold
            if (k > 80) score -= 10;
            else if (k < 20) score += 10;

            // Crossover
            if (prevK !== null && prevD !== null) {
                if (prevK < prevD && k > d) {
                    score += 20; // Bullish crossover
                } else if (prevK > prevD && k < d) {
                    score -= 20; // Bearish crossover
                }
            }
        }
    }

    return clamp100(score);
}

/**
 * Compute volatility sub-score from Bollinger Bands and ATR.
 *
 * Components:
 * - Bollinger %B position: ±40 points (near upper = overbought, near lower = oversold)
 * - BB squeeze/expansion: ±30 points (squeeze = pending breakout, expansion = trend)
 * - ATR direction: ±30 points (expanding ATR = growing momentum)
 *
 * @param {Object} indicators
 * @returns {number} Score from -100 to +100
 */
function computeVolatilityScore(indicators) {
    let score = 0;

    // Bollinger Bands
    if (indicators.bollinger) {
        const pctB = last(indicators.bollinger.percentB);
        const prevPctB = nthLast(indicators.bollinger.percentB, 1);
        const bw = last(indicators.bollinger.bandwidth);
        const prevBw = nthLast(indicators.bollinger.bandwidth, 1);

        if (pctB !== null) {
            // %B > 1 = above upper band (overbought), %B < 0 = below lower band (oversold)
            if (pctB > 1.0) {
                score -= 20; // Above upper band — potential reversal
            } else if (pctB < 0) {
                score += 20; // Below lower band — potential bounce
            } else if (pctB > 0.8) {
                score += 10; // Near upper — bullish momentum (unless extremely overbought)
            } else if (pctB < 0.2) {
                score -= 10; // Near lower — bearish momentum
            }

            // Direction of %B
            if (prevPctB !== null) {
                const pctBDelta = pctB - prevPctB;
                score += clamp100(pctBDelta * 40); // Rising %B = bullish
            }
        }

        // Bandwidth squeeze detection
        if (bw !== null && prevBw !== null) {
            const bwChange = (bw - prevBw) / (prevBw || 1);
            if (bwChange > 0.1) {
                // Expanding — breakout occurring; direction depends on price
                score += pctB !== null && pctB > 0.5 ? 15 : -15;
            } else if (bwChange < -0.05) {
                // Contracting — squeeze forming, pending breakout
                // Neutral until breakout direction is clear
                score += 0;
            }
        }
    }

    // ATR direction
    if (indicators.atr) {
        const atrVal = last(indicators.atr);
        const prevAtr = nthLast(indicators.atr, 1);

        if (atrVal !== null && prevAtr !== null && prevAtr > 0) {
            const atrChange = (atrVal - prevAtr) / prevAtr;
            // Expanding ATR with existing momentum = continuation
            // We use this as a magnitude amplifier, not directional
            // The direction comes from other scores
            if (atrChange > 0.1) {
                score += 15; // Volatility expanding — momentum increasing
            } else if (atrChange < -0.1) {
                score -= 5; // Volatility contracting — momentum fading
            }
        }
    }

    return clamp100(score);
}

/**
 * Compute volume sub-score from OBV, MFI, and volume trend.
 *
 * Components:
 * - OBV trend vs price trend (confirmation/divergence): ±40 points
 * - MFI overbought/oversold: ±30 points
 * - Volume spike detection: ±30 points
 *
 * @param {Object} indicators
 * @param {number[]} recentCloses - Last few close prices
 * @param {number[]} recentVolumes - Last few volume values
 * @returns {number} Score from -100 to +100
 */
function computeVolumeScore(indicators, recentCloses, recentVolumes) {
    let score = 0;

    // OBV trend — compare OBV direction with price direction
    if (indicators.obv) {
        const obvVal = last(indicators.obv);
        const prevObv = nthLast(indicators.obv, 1);
        const prevPrevObv = nthLast(indicators.obv, 3);

        if (obvVal !== null && prevObv !== null) {
            const obvRising = obvVal > prevObv;
            const priceRising = recentCloses.length >= 2 &&
                recentCloses[recentCloses.length - 1] > recentCloses[recentCloses.length - 2];

            if (obvRising && priceRising) {
                score += 20; // Bullish confirmation
            } else if (!obvRising && !priceRising) {
                score -= 20; // Bearish confirmation
            } else if (obvRising && !priceRising) {
                score += 15; // Bullish divergence — accumulation
            } else {
                score -= 15; // Bearish divergence — distribution
            }

            // OBV trend strength
            if (prevPrevObv !== null) {
                const obvTrend = obvVal - prevPrevObv;
                score += clamp100(obvTrend > 0 ? 20 : -20);
            }
        }
    }

    // MFI
    if (indicators.mfi) {
        const mfiVal = last(indicators.mfi);
        if (mfiVal !== null) {
            if (mfiVal > 80) {
                score -= 15; // Overbought
            } else if (mfiVal < 20) {
                score += 15; // Oversold
            } else if (mfiVal > 50) {
                score += 10;
            } else {
                score -= 10;
            }
        }
    }

    // Volume spike — current volume vs average
    if (recentVolumes.length >= 5) {
        const avgVol = recentVolumes.slice(-5).reduce((a, b) => a + b, 0) / 5;
        const currentVol = recentVolumes[recentVolumes.length - 1];
        if (avgVol > 0 && currentVol > avgVol * 1.5) {
            // Volume spike — amplifies whatever direction price moved
            const priceDir = recentCloses.length >= 2
                ? recentCloses[recentCloses.length - 1] > recentCloses[recentCloses.length - 2]
                : true;
            score += priceDir ? 15 : -15;
        }
    }

    return clamp100(score);
}

/**
 * Compute support/resistance sub-score from pivot points and CCI.
 *
 * Components:
 * - Price proximity to pivot levels: ±50 points
 * - CCI position: ±25 points
 * - Williams %R: ±25 points
 *
 * @param {Object} indicators
 * @param {number} currentPrice
 * @returns {number} Score from -100 to +100
 */
function computeSRScore(indicators, currentPrice) {
    let score = 0;

    // Pivot points — price relative to support/resistance levels
    if (indicators.pivot_points) {
        const pivot = last(indicators.pivot_points.pivot);
        const r1 = last(indicators.pivot_points.r1);
        const s1 = last(indicators.pivot_points.s1);
        const r2 = last(indicators.pivot_points.r2);
        const s2 = last(indicators.pivot_points.s2);

        if (pivot !== null) {
            // Above pivot = bullish bias
            if (currentPrice > pivot) {
                score += 15;
                // Near R1 = resistance ahead
                if (r1 !== null && currentPrice > r1 * 0.99) {
                    score -= 10; // Approaching resistance
                }
                // Broke through R1 = very bullish
                if (r1 !== null && currentPrice > r1) {
                    score += 15;
                }
            } else {
                score -= 15;
                // Near S1 = support ahead
                if (s1 !== null && currentPrice < s1 * 1.01) {
                    score += 10; // Approaching support
                }
                // Broke through S1 = very bearish
                if (s1 !== null && currentPrice < s1) {
                    score -= 15;
                }
            }
        }
    }

    // CCI
    if (indicators.cci) {
        const cciVal = last(indicators.cci);
        if (cciVal !== null) {
            if (cciVal > 100) score += 12;
            else if (cciVal < -100) score -= 12;
            else score += (cciVal / 100) * 12;
        }
    }

    // Williams %R
    if (indicators.williams_r) {
        const wrVal = last(indicators.williams_r);
        if (wrVal !== null) {
            if (wrVal > -20) {
                score -= 12; // Overbought
            } else if (wrVal < -80) {
                score += 12; // Oversold
            } else {
                score += ((wrVal + 50) / 50) * 12; // Linear mapping
            }
        }
    }

    return clamp100(score);
}

// ── Main prediction function ─────────────────────────────────────────────

/**
 * Generate a candle prediction using confluence scoring.
 *
 * @param {Object} ohlcv - { opens, highs, lows, closes, volumes }
 * @param {Object} [options]
 * @param {number} [options.horizon=1] - Predict next N candles
 * @param {Object} [options.weights] - Override default sub-score weights
 * @param {number} [options.neutralZone=15] - Confluence threshold for NEUTRAL
 * @returns {Object} Prediction result
 */
export function predictCandles(ohlcv, options = {}) {
    const {
        horizon = 1,
        weights = DEFAULT_WEIGHTS,
        neutralZone = 15,
    } = options;

    const { opens, highs, lows, closes, volumes } = ohlcv;

    if (closes.length < 30) {
        return {
            error: 'Insufficient data — need at least 30 candles for reliable prediction',
            prediction: null,
        };
    }

    // Compute all indicators (full lookback for accurate values)
    const indicators = computeAllIndicators(ohlcv, null, closes.length);
    const currentPrice = closes[closes.length - 1];

    // Compute sub-scores
    const trendScore = computeTrendScore(indicators, currentPrice);
    const momentumScore = computeMomentumScore(indicators);
    const volatilityScore = computeVolatilityScore(indicators);
    const volumeScore = computeVolumeScore(indicators, closes.slice(-5), volumes.slice(-5));
    const srScore = computeSRScore(indicators, currentPrice);

    // Weighted confluence
    const confluence = clamp100(
        weights.trend * trendScore +
        weights.momentum * momentumScore +
        weights.volatility * volatilityScore +
        weights.volume * volumeScore +
        weights.support_resistance * srScore
    );

    // Direction determination
    let direction;
    if (confluence > neutralZone) {
        direction = 'LONG';
    } else if (confluence < -neutralZone) {
        direction = 'SHORT';
    } else {
        direction = 'NEUTRAL';
    }

    // Confidence = normalized absolute confluence
    const confidence = Math.min(1.0, Math.abs(confluence) / 80);

    // Intensity
    let intensity;
    if (confidence < 0.4) intensity = 'WEAK';
    else if (confidence < 0.7) intensity = 'MODERATE';
    else intensity = 'STRONG';

    // Expected move % — based on ATR and confluence strength
    const atrVal = last(indicators.atr) || 0;
    const atrPct = currentPrice > 0 ? (atrVal / currentPrice) * 100 : 0;
    const expectedMovePct = atrPct * confidence * horizon * (direction === 'SHORT' ? -1 : 1);

    // Entry, SL, TP calculations
    const entryPrice = currentPrice;
    const slMultiplier = direction === 'LONG' ? (1 - 0.05) : (1 + 0.05); // 5% default SL
    const tpMultiplier = direction === 'LONG' ? (1 + 0.03) : (1 - 0.03); // 3% default TP
    const stopLoss = entryPrice * slMultiplier;
    const takeProfit = entryPrice * tpMultiplier;

    // Risk/reward ratio
    const risk = Math.abs(entryPrice - stopLoss);
    const reward = Math.abs(takeProfit - entryPrice);
    const riskRewardRatio = risk > 0 ? reward / risk : 0;

    return {
        prediction: {
            direction,
            confidence: Math.round(confidence * 1000) / 1000,
            intensity,
            expected_move_pct: Math.round(expectedMovePct * 1000) / 1000,
            entry_price: entryPrice,
            stop_loss: Math.round(stopLoss * 100) / 100,
            take_profit: Math.round(takeProfit * 100) / 100,
        },
        signal_components: {
            trend_score: Math.round(trendScore * 10) / 10,
            momentum_score: Math.round(momentumScore * 10) / 10,
            volatility_score: Math.round(volatilityScore * 10) / 10,
            volume_score: Math.round(volumeScore * 10) / 10,
            support_resistance: Math.round(srScore * 10) / 10,
        },
        confluence_score: Math.round(confluence * 10) / 10,
        risk_reward_ratio: Math.round(riskRewardRatio * 100) / 100,
        horizon,
        indicators_snapshot: summarizeIndicators(indicators),
    };
}

/**
 * Create a compact summary of current indicator values for LLM context.
 * @param {Object} indicators
 * @returns {Object}
 */
function summarizeIndicators(indicators) {
    const summary = {};

    if (indicators.rsi) {
        summary.rsi = last(indicators.rsi);
    }
    if (indicators.macd) {
        summary.macd_histogram = last(indicators.macd.histogram);
        summary.macd_line = last(indicators.macd.line);
    }
    if (indicators.stoch_rsi) {
        summary.stoch_rsi_k = last(indicators.stoch_rsi.k);
        summary.stoch_rsi_d = last(indicators.stoch_rsi.d);
    }
    if (indicators.bollinger) {
        summary.bb_percentB = last(indicators.bollinger.percentB);
        summary.bb_bandwidth = last(indicators.bollinger.bandwidth);
    }
    if (indicators.adx) {
        summary.adx = last(indicators.adx.adx);
        summary.plus_di = last(indicators.adx.plusDI);
        summary.minus_di = last(indicators.adx.minusDI);
    }
    if (indicators.atr) {
        summary.atr = last(indicators.atr);
    }
    if (indicators.mfi) {
        summary.mfi = last(indicators.mfi);
    }
    if (indicators.williams_r) {
        summary.williams_r = last(indicators.williams_r);
    }
    if (indicators.cci) {
        summary.cci = last(indicators.cci);
    }

    return summary;
}
