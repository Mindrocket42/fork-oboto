/**
 * Technical indicator calculations for TradingChart.
 *
 * Each function takes the full candle array and returns one value per candle index,
 * with `null` where insufficient history exists.
 */

import type { Candle, IndicatorConfig, IndicatorLine } from './types';

/** Simple Moving Average */
function computeSMA(closes: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      result.push(null);
    } else {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += closes[j];
      result.push(sum / period);
    }
  }
  return result;
}

/** Exponential Moving Average */
function computeEMA(closes: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  const k = 2 / (period + 1);

  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      result.push(null);
    } else if (i === period - 1) {
      // First EMA value is the SMA
      let sum = 0;
      for (let j = 0; j < period; j++) sum += closes[j];
      result.push(sum / period);
    } else {
      const prev = result[i - 1] as number;
      result.push(closes[i] * k + prev * (1 - k));
    }
  }
  return result;
}

/** Bollinger Bands (middle = SMA, upper/lower = SMA ± stdDev * σ) */
function computeBollinger(
  closes: number[],
  period: number,
  stdDevMul: number
): { middle: (number | null)[]; upper: (number | null)[]; lower: (number | null)[] } {
  const middle = computeSMA(closes, period);
  const upper: (number | null)[] = [];
  const lower: (number | null)[] = [];

  for (let i = 0; i < closes.length; i++) {
    const m = middle[i];
    if (m === null) {
      upper.push(null);
      lower.push(null);
    } else {
      let variance = 0;
      for (let j = i - period + 1; j <= i; j++) {
        variance += (closes[j] - m) ** 2;
      }
      const stdDev = Math.sqrt(variance / period);
      upper.push(m + stdDevMul * stdDev);
      lower.push(m - stdDevMul * stdDev);
    }
  }

  return { middle, upper, lower };
}

/** Compute all indicators for a given set of candles and configs */
export function computeIndicators(
  candles: Candle[],
  configs: IndicatorConfig[]
): IndicatorLine[] {
  const closes = candles.map((c) => c.close);
  const lines: IndicatorLine[] = [];

  for (const cfg of configs) {
    switch (cfg.type) {
      case 'sma': {
        lines.push({
          config: cfg,
          values: computeSMA(closes, cfg.period),
        });
        break;
      }
      case 'ema': {
        lines.push({
          config: cfg,
          values: computeEMA(closes, cfg.period),
        });
        break;
      }
      case 'bollinger': {
        const { middle, upper, lower } = computeBollinger(
          closes,
          cfg.period,
          cfg.stdDev ?? 2
        );
        lines.push({
          config: cfg,
          values: middle,
          upper,
          lower,
        });
        break;
      }
    }
  }

  return lines;
}
