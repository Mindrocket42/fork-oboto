/**
 * Type definitions for the TradingChart DSL.
 * Matches the JSON schema produced by the trading-chart plugin.
 */

export interface Candle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface IndicatorConfig {
  type: 'sma' | 'ema' | 'bollinger';
  period: number;
  color: string;
  lineWidth?: number;
  /** For bollinger bands — standard deviation multiplier (default 2) */
  stdDev?: number;
}

export interface HLineAnnotation {
  type: 'hline';
  price: number;
  color: string;
  style?: 'solid' | 'dashed' | 'dotted';
  label?: string;
}

export interface LabelAnnotation {
  type: 'label';
  time: string | number;
  price: number;
  text: string;
  color: string;
  position?: 'above' | 'below';
}

export interface RegionAnnotation {
  type: 'region';
  from: string | number;
  to: string | number;
  color: string;
  label?: string;
}

export interface TrendlineAnnotation {
  type: 'trendline';
  from: { time: string | number; price: number };
  to: { time: string | number; price: number };
  color: string;
  style?: 'solid' | 'dashed';
}

export interface ArrowAnnotation {
  type: 'arrow';
  time: string | number;
  price: number;
  direction: 'up' | 'down';
  color: string;
  label?: string;
}

export type Annotation =
  | HLineAnnotation
  | LabelAnnotation
  | RegionAnnotation
  | TrendlineAnnotation
  | ArrowAnnotation;

export interface AnimationConfig {
  enabled: boolean;
  /** Number of candles shown before animation starts */
  initialCandles: number;
  /** Milliseconds per candle during playback */
  speed: number;
}

export interface TradingChartConfig {
  title?: string;
  symbol?: string;
  timeframe?: string;
  width?: number;
  height?: number;
  theme?: 'dark' | 'light';

  candles: Candle[];
  indicators?: IndicatorConfig[];
  annotations?: Annotation[];
  animation?: AnimationConfig;

  showVolume?: boolean;
  showGrid?: boolean;
  showCrosshair?: boolean;
}

/** Computed indicator data for rendering */
export interface IndicatorLine {
  config: IndicatorConfig;
  /** One value per candle index — null where insufficient data */
  values: (number | null)[];
  /** For bollinger: upper band values */
  upper?: (number | null)[];
  /** For bollinger: lower band values */
  lower?: (number | null)[];
}

/** Theme colors resolved from the theme name */
export interface ThemeColors {
  background: string;
  gridLine: string;
  axisText: string;
  candleUp: string;
  candleDown: string;
  wickUp: string;
  wickDown: string;
  volumeUp: string;
  volumeDown: string;
  crosshair: string;
  tooltipBg: string;
  tooltipText: string;
  tooltipBorder: string;
}
