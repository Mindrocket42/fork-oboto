/**
 * Trading Chart Plugin — Extended with LLM-Driven Trading Bot
 *
 * Enables the AI to produce interactive TradingView-style candlestick charts
 * inline in chat, AND provides a full suite of crypto scalping tools:
 *
 * Chart Features:
 * - Candlestick / OHLC rendering
 * - Technical indicators (SMA, EMA, Bollinger Bands)
 * - Annotations (horizontal lines, labels, shaded regions)
 * - Volume bars
 * - Optional candle-by-candle animation with replay controls
 *
 * Trading Bot Features:
 * - Market scanning for volatile opportunities
 * - OHLCV candle data fetching (MEXC browser scraping)
 * - 15 technical indicators (RSI, MACD, EMA, SMA, Bollinger, ATR, OBV, VWAP,
 *   Stochastic RSI, MFI, ADX, CCI, Williams %R, Ichimoku, Pivot Points)
 * - Meta-indicator confluence scoring engine (candle predictor)
 * - Position management (open/close/modify via MEXC browser)
 * - Risk management (position sizing, SL/TP, daily loss limits)
 * - Automated trading loop with configurable cadence
 * - Trade history and performance analytics
 *
 * @module @oboto/plugin-trading-chart
 */

import { registerSettingsHandlers } from '../../src/plugins/plugin-settings-handlers.mjs';
import { consoleStyler } from '../../src/ui/console-styler.mjs';
import { CandleStore } from './lib/candle-store.mjs';
import { fetchCandles, getAvailableIntervals } from './lib/candle-fetcher.mjs';
import { computeAllIndicators } from './lib/indicators.mjs';
import { predictCandles } from './lib/meta-indicator.mjs';
import { RiskManager } from './lib/risk-manager.mjs';
import { TrainablePredictor, PredictorStore } from './lib/trainable-predictor.mjs';

// ── Settings ─────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS = {
    // Chart settings
    enabled: true,
    defaultWidth: 800,
    defaultHeight: 450,
    defaultAnimationSpeed: 100,
    defaultTheme: 'dark',

    // Trading bot settings
    trading_enabled: false,
    max_position_size_usdt: 50,
    max_leverage: 20,
    max_concurrent_positions: 3,
    default_stop_loss_pct: 5,
    default_take_profit_pct: 3,
    default_cadence_seconds: 60,
    default_timeframe: '1m',
    max_daily_loss_usdt: 150,
    trading_mode: 'paper',

    // Predictor settings
    min_confidence_threshold: 0.5,
    min_signal_intensity: 'MODERATE',
    confluence_threshold: 25,

    // Indicator weights for meta-indicator
    weight_trend: 0.30,
    weight_momentum: 0.25,
    weight_volatility: 0.20,
    weight_volume: 0.15,
    weight_support_resistance: 0.10,
};

const SETTINGS_SCHEMA = [
    // ── Chart ──
    {
        key: 'enabled',
        label: 'Enabled',
        type: 'boolean',
        description: 'Enable or disable trading chart rendering',
        default: true,
    },
    {
        key: 'defaultWidth',
        label: 'Default Width (px)',
        type: 'number',
        description: 'Default canvas width for charts',
        default: 800,
        min: 400,
        max: 1400,
    },
    {
        key: 'defaultHeight',
        label: 'Default Height (px)',
        type: 'number',
        description: 'Default canvas height for charts',
        default: 450,
        min: 250,
        max: 900,
    },
    {
        key: 'defaultAnimationSpeed',
        label: 'Default Animation Speed (ms/candle)',
        type: 'number',
        description: 'Milliseconds per candle during animation playback',
        default: 100,
        min: 20,
        max: 1000,
    },
    {
        key: 'defaultTheme',
        label: 'Default Theme',
        type: 'select',
        description: 'Default color theme for charts',
        default: 'dark',
        options: ['dark', 'light'],
    },

    // ── Trading Bot ──
    {
        key: 'trading_enabled',
        label: 'Trading Bot Enabled',
        type: 'boolean',
        description: 'Enable trading bot tools (market scanning, position management, auto-trading)',
        default: false,
    },
    {
        key: 'trading_mode',
        label: 'Trading Mode',
        type: 'select',
        description: 'Paper mode logs trades without executing. Live mode executes real trades.',
        default: 'paper',
        options: ['paper', 'live'],
    },
    {
        key: 'max_position_size_usdt',
        label: 'Max Position Size (USDT)',
        type: 'number',
        description: 'Maximum position size per trade in USDT',
        default: 50,
        min: 5,
        max: 10000,
    },
    {
        key: 'max_leverage',
        label: 'Max Leverage',
        type: 'number',
        description: 'Maximum leverage multiplier',
        default: 20,
        min: 1,
        max: 125,
    },
    {
        key: 'max_concurrent_positions',
        label: 'Max Concurrent Positions',
        type: 'number',
        description: 'Maximum number of positions open simultaneously',
        default: 3,
        min: 1,
        max: 20,
    },
    {
        key: 'default_stop_loss_pct',
        label: 'Default Stop-Loss (%)',
        type: 'number',
        description: 'Default stop-loss percentage from entry price',
        default: 5,
        min: 0.5,
        max: 50,
    },
    {
        key: 'default_take_profit_pct',
        label: 'Default Take-Profit (%)',
        type: 'number',
        description: 'Default take-profit percentage from entry price',
        default: 3,
        min: 0.5,
        max: 100,
    },
    {
        key: 'default_cadence_seconds',
        label: 'Bot Cadence (seconds)',
        type: 'number',
        description: 'How often the bot runs its trading cycle',
        default: 60,
        min: 10,
        max: 3600,
    },
    {
        key: 'default_timeframe',
        label: 'Default Timeframe',
        type: 'select',
        description: 'Default candle timeframe for analysis',
        default: '1m',
        options: ['1m', '5m', '15m', '30m', '1h', '4h', '1d'],
    },
    {
        key: 'max_daily_loss_usdt',
        label: 'Max Daily Loss (USDT)',
        type: 'number',
        description: 'Maximum daily loss before bot halts trading',
        default: 150,
        min: 10,
        max: 50000,
    },
    {
        key: 'min_confidence_threshold',
        label: 'Min Signal Confidence',
        type: 'number',
        description: 'Minimum prediction confidence (0-1) to consider a trade',
        default: 0.5,
        min: 0.1,
        max: 1.0,
    },
    {
        key: 'min_signal_intensity',
        label: 'Min Signal Intensity',
        type: 'select',
        description: 'Minimum signal intensity to consider a trade',
        default: 'MODERATE',
        options: ['WEAK', 'MODERATE', 'STRONG'],
    },
    {
        key: 'weight_trend',
        label: 'Trend Weight',
        type: 'number',
        description: 'Weight for trend sub-score in confluence calculation (0-1)',
        default: 0.30,
        min: 0,
        max: 1,
    },
    {
        key: 'weight_momentum',
        label: 'Momentum Weight',
        type: 'number',
        description: 'Weight for momentum sub-score in confluence calculation (0-1)',
        default: 0.25,
        min: 0,
        max: 1,
    },
    {
        key: 'weight_volatility',
        label: 'Volatility Weight',
        type: 'number',
        description: 'Weight for volatility sub-score in confluence calculation (0-1)',
        default: 0.20,
        min: 0,
        max: 1,
    },
    {
        key: 'weight_volume',
        label: 'Volume Weight',
        type: 'number',
        description: 'Weight for volume sub-score in confluence calculation (0-1)',
        default: 0.15,
        min: 0,
        max: 1,
    },
    {
        key: 'weight_support_resistance',
        label: 'Support/Resistance Weight',
        type: 'number',
        description: 'Weight for S/R sub-score in confluence calculation (0-1)',
        default: 0.10,
        min: 0,
        max: 1,
    },
];

// ── DSL generation prompt (original chart tool) ──────────────────────────

const TRADING_CHART_GENERATION_PROMPT = `
You are a financial charting expert. Create a JSON specification for a TradingView-style candlestick chart.

The JSON must follow this schema:
{
  "title": "string — chart title (e.g., 'AAPL Daily')",
  "symbol": "string — ticker symbol (e.g., 'AAPL')",
  "timeframe": "string — e.g., '1D', '4H', '1W'",
  "width": 800,
  "height": 450,
  "theme": "dark",

  "candles": [
    {
      "time": "string — date/time label (e.g., '2024-01-15' or 'Jan 15')",
      "open": number,
      "high": number,
      "low": number,
      "close": number,
      "volume": number  // optional
    }
  ],

  "indicators": [
    {
      "type": "sma" | "ema" | "bollinger",
      "period": number,
      "color": "string — CSS color",
      "lineWidth": number  // optional, default 1.5
      // For bollinger: "stdDev": number (default 2)
    }
  ],

  "annotations": [
    {
      "type": "hline" | "label" | "region" | "trendline" | "arrow",
      // For hline: "price": number, "color": string, "style": "solid"|"dashed"|"dotted", "label": string
      // For label: "time": string|number (index), "price": number, "text": string, "color": string, "position": "above"|"below"
      // For region: "from": string|number, "to": string|number, "color": string (with alpha), "label": string
      // For trendline: "from": {time, price}, "to": {time, price}, "color": string, "style": "solid"|"dashed"
      // For arrow: "time": string|number, "price": number, "direction": "up"|"down", "color": string, "label": string
    }
  ],

  "animation": {
    "enabled": true | false,
    "initialCandles": number,
    "speed": number
  },

  "showVolume": true | false,
  "showGrid": true | false,
  "showCrosshair": true | false
}

Rules:
1. Generate realistic-looking price data with proper OHLC relationships (high >= open,close >= low)
2. Volume should correlate roughly with price movement magnitude
3. Use 20-80 candles for good visual density
4. Indicator periods should make sense for the data length (e.g., SMA 20 needs at least 20 candles)
5. Annotations should highlight meaningful chart patterns or levels
6. Colors should be visible on the specified theme background

Return ONLY valid JSON. No explanations, no markdown wrapping.
`;

// ── Plugin lifecycle ─────────────────────────────────────────────────────

export async function activate(api) {
    // Pre-create instance so settings callback can reference it
    const instance = {
        candleStore: null,
        riskManager: null,
        predictorStore: null,
        botTimer: null,
        botRunning: false,
        botConfig: null,
        settings: null,
    };
    api.setInstance(instance);

    const { pluginSettings } = await registerSettingsHandlers(
        api, 'trading-chart', DEFAULT_SETTINGS, SETTINGS_SCHEMA,
        () => {
            instance.settings = pluginSettings;
            if (instance.riskManager) {
                instance.riskManager.updateSettings({
                    maxPositionSizeUsdt: pluginSettings.max_position_size_usdt,
                    maxLeverage: pluginSettings.max_leverage,
                    maxConcurrentPositions: pluginSettings.max_concurrent_positions,
                    defaultStopLossPct: pluginSettings.default_stop_loss_pct,
                    defaultTakeProfitPct: pluginSettings.default_take_profit_pct,
                    maxDailyLossUsdt: pluginSettings.max_daily_loss_usdt,
                    minConfidenceThreshold: pluginSettings.min_confidence_threshold,
                    minSignalIntensity: pluginSettings.min_signal_intensity,
                });
            }
        }
    );

    instance.settings = pluginSettings;
    instance.candleStore = new CandleStore({ maxCandles: 500 });
    instance.riskManager = new RiskManager({
        maxPositionSizeUsdt: pluginSettings.max_position_size_usdt,
        maxLeverage: pluginSettings.max_leverage,
        maxConcurrentPositions: pluginSettings.max_concurrent_positions,
        defaultStopLossPct: pluginSettings.default_stop_loss_pct,
        defaultTakeProfitPct: pluginSettings.default_take_profit_pct,
        maxDailyLossUsdt: pluginSettings.max_daily_loss_usdt,
        minConfidenceThreshold: pluginSettings.min_confidence_threshold,
        minSignalIntensity: pluginSettings.min_signal_intensity,
    });
    instance.predictorStore = new PredictorStore();

    // ── Tool 0: Original chart generation tool ───────────────────────────

    api.tools.register({
        useOriginalName: true,
        surfaceSafe: true,
        name: 'generate_trading_chart',
        description:
            'Generate an interactive TradingView-style candlestick chart. Produces a tradingchart code block that renders as an interactive chart inline in chat. Supports OHLC candles, volume, technical indicators (SMA, EMA, Bollinger Bands), annotations (support/resistance lines, labels, regions), and optional candle-by-candle animation with replay controls.',
        parameters: {
            type: 'object',
            properties: {
                description: {
                    type: 'string',
                    description: 'Description of the chart to generate.',
                },
                animate: {
                    type: 'boolean',
                    description: 'Whether to animate candles appearing one by one (default: false).',
                },
                candleCount: {
                    type: 'number',
                    description: 'Number of candles to generate (default: 40). Range: 10-100.',
                },
            },
            required: ['description'],
        },
        handler: async ({ description, animate = false, candleCount = 40 }) => {
            if (!pluginSettings.enabled) {
                return 'Trading Chart plugin is disabled.';
            }

            const clampedCount = Math.max(10, Math.min(100, candleCount));

            const prompt = `${TRADING_CHART_GENERATION_PROMPT}

Default canvas: ${pluginSettings.defaultWidth}x${pluginSettings.defaultHeight}
Theme: "${pluginSettings.defaultTheme}"
Number of candles: ${clampedCount}
Animation: ${animate ? `enabled with initialCandles=${Math.max(5, Math.floor(clampedCount * 0.3))}, speed=${pluginSettings.defaultAnimationSpeed}` : 'disabled'}

Create this chart: ${description}`;

            try {
                const response = await api.ai.ask(prompt);
                let code =
                    typeof response === 'object' && response.text
                        ? response.text
                        : response;

                code = code
                    .replace(/```json\s*/gi, '')
                    .replace(/```tradingchart\s*/gi, '')
                    .replace(/```/g, '')
                    .trim();

                const jsonStart = code.indexOf('{');
                const jsonEnd = code.lastIndexOf('}');
                if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
                    return 'Error generating trading chart: LLM response did not contain a JSON object.';
                }
                code = code.substring(jsonStart, jsonEnd + 1);

                const parsed = JSON.parse(code);
                if (!parsed.candles || !Array.isArray(parsed.candles) || parsed.candles.length === 0) {
                    return 'Error: generated chart is missing required "candles" array';
                }

                for (const c of parsed.candles) {
                    if (typeof c.open !== 'number' || typeof c.high !== 'number' ||
                        typeof c.low !== 'number' || typeof c.close !== 'number') {
                        return 'Error: each candle must have numeric open, high, low, close values';
                    }
                }

                for (const c of parsed.candles) {
                    c.high = Math.max(c.high, c.open, c.close);
                    c.low = Math.min(c.low, c.open, c.close);
                }

                const canonical = JSON.stringify(parsed);
                return { __directMarkdown: `\`\`\`tradingchart\n${canonical}\n\`\`\`` };
            } catch (e) {
                return `Error generating trading chart: ${e.message}`;
            }
        },
    });

    // ── Tool 1: trading_compute_indicators ────────────────────────────────

    api.tools.register({
        surfaceSafe: true,
        useOriginalName: true,
        name: 'trading_compute_indicators',
        description:
            'Compute technical indicators on candle data stored in the candle store. Returns all indicator values for the most recent candles. Supports: rsi, macd, ema, sma, bollinger, atr, obv, vwap, stoch_rsi, mfi, adx, cci, williams_r, ichimoku, pivot_points.',
        parameters: {
            type: 'object',
            properties: {
                symbol: {
                    type: 'string',
                    description: 'Symbol to compute indicators for. Must have candle data loaded via trading_get_candles first.',
                },
                timeframe: {
                    type: 'string',
                    description: 'Candle timeframe. Default: from settings.',
                },
                indicators: {
                    type: 'array',
                    description: 'Which indicators to compute. Default: all.',
                    items: {
                        type: 'string',
                        enum: ['rsi', 'macd', 'ema', 'sma', 'bollinger', 'atr', 'obv', 'vwap', 'stoch_rsi', 'mfi', 'adx', 'cci', 'williams_r', 'ichimoku', 'pivot_points'],
                    },
                },
                lookback: {
                    type: 'number',
                    description: 'Number of recent candles to return indicator values for. Default: 20.',
                },
            },
            required: ['symbol'],
        },
        handler: async ({ symbol, timeframe, indicators: requestedIndicators, lookback = 20 }) => {
            const tf = timeframe || pluginSettings.default_timeframe;
            const data = instance.candleStore.get(symbol, tf);

            if (!data || data.candles.length === 0) {
                return `Error: No candle data for ${symbol} (${tf}). Use trading_get_candles first.`;
            }

            const ohlcv = {
                opens: data.candles.map(c => c.open),
                highs: data.candles.map(c => c.high),
                lows: data.candles.map(c => c.low),
                closes: data.candles.map(c => c.close),
                volumes: data.candles.map(c => c.volume || 0),
            };

            const result = computeAllIndicators(ohlcv, requestedIndicators, lookback);

            return JSON.stringify({
                symbol: symbol.toUpperCase(),
                timeframe: tf,
                candle_count: data.candles.length,
                lookback,
                indicators: result,
            }, null, 2);
        },
    });

    // ── Tool 2: trading_predict_candles ───────────────────────────────────

    api.tools.register({
        surfaceSafe: true,
        useOriginalName: true,
        name: 'trading_predict_candles',
        description:
            'Generate a prediction for the next 1-2 candles using the confluence scoring engine. Combines 15 technical indicators into a single directional signal with confidence level. Returns direction (LONG/SHORT/NEUTRAL), confidence (0-1), intensity (WEAK/MODERATE/STRONG), and component scores.',
        parameters: {
            type: 'object',
            properties: {
                symbol: {
                    type: 'string',
                    description: 'Symbol to predict. Must have candle data loaded.',
                },
                timeframe: {
                    type: 'string',
                    description: 'Candle timeframe. Default: from settings.',
                },
                horizon: {
                    type: 'number',
                    description: 'Predict next N candles (1 or 2). Default: 1.',
                },
            },
            required: ['symbol'],
        },
        handler: async ({ symbol, timeframe, horizon = 1 }) => {
            const tf = timeframe || pluginSettings.default_timeframe;
            const data = instance.candleStore.get(symbol, tf);

            if (!data || data.candles.length < 30) {
                return `Error: Need at least 30 candles for ${symbol} (${tf}). Have ${data?.candles.length || 0}. Use trading_get_candles first.`;
            }

            const ohlcv = {
                opens: data.candles.map(c => c.open),
                highs: data.candles.map(c => c.high),
                lows: data.candles.map(c => c.low),
                closes: data.candles.map(c => c.close),
                volumes: data.candles.map(c => c.volume || 0),
            };

            const weights = {
                trend: pluginSettings.weight_trend,
                momentum: pluginSettings.weight_momentum,
                volatility: pluginSettings.weight_volatility,
                volume: pluginSettings.weight_volume,
                support_resistance: pluginSettings.weight_support_resistance,
            };

            const result = predictCandles(ohlcv, {
                horizon: Math.max(1, Math.min(2, horizon)),
                weights,
                neutralZone: pluginSettings.confluence_threshold,
            });

            return JSON.stringify({
                symbol: symbol.toUpperCase(),
                timeframe: tf,
                timestamp: new Date().toISOString(),
                ...result,
            }, null, 2);
        },
    });

    // ── Tool 3: trading_get_candles ───────────────────────────────────────
    // NOTE: This tool stores candles in the CandleStore. For the browser
    // scraping implementation, it accepts candles directly as input
    // (the LLM or another tool provides the raw data from MEXC browser).

    api.tools.register({
        surfaceSafe: true,
        useOriginalName: true,
        name: 'trading_get_candles',
        description:
            'Store OHLCV candle data for a crypto futures pair. The candle data can come from browser scraping of MEXC or be provided directly. Once stored, use trading_compute_indicators and trading_predict_candles for analysis.',
        parameters: {
            type: 'object',
            properties: {
                symbol: {
                    type: 'string',
                    description: 'Trading pair symbol, e.g. BTCUSDT',
                },
                timeframe: {
                    type: 'string',
                    enum: ['1m', '5m', '15m', '30m', '1h', '4h', '1d'],
                    description: 'Candle timeframe. Default: from settings.',
                },
                candles: {
                    type: 'array',
                    description: 'Array of OHLCV candle objects in chronological order.',
                    items: {
                        type: 'object',
                        properties: {
                            time: { type: 'string', description: 'ISO timestamp or label' },
                            open: { type: 'number' },
                            high: { type: 'number' },
                            low: { type: 'number' },
                            close: { type: 'number' },
                            volume: { type: 'number' },
                        },
                        required: ['time', 'open', 'high', 'low', 'close'],
                    },
                },
            },
            required: ['symbol', 'candles'],
        },
        handler: async ({ symbol, timeframe, candles }) => {
            const tf = timeframe || pluginSettings.default_timeframe;

            if (!candles || candles.length === 0) {
                return 'Error: No candle data provided.';
            }

            // Validate and repair OHLC integrity
            for (const c of candles) {
                c.high = Math.max(c.high, c.open, c.close);
                c.low = Math.min(c.low, c.open, c.close);
            }

            instance.candleStore.set(symbol, tf, candles);
            const count = instance.candleStore.count(symbol, tf);

            return JSON.stringify({
                symbol: symbol.toUpperCase(),
                timeframe: tf,
                candles_stored: count,
                latest_candle: candles[candles.length - 1],
                message: `Stored ${candles.length} candles for ${symbol.toUpperCase()} (${tf}). Total in store: ${count}.`,
            });
        },
    });

    // ── Tool 16: trading_fetch_candles ───────────────────────────────────
    // Fetches historical candle data from public exchange APIs (Binance + MEXC)
    // and automatically stores them in the CandleStore.

    api.tools.register({
        surfaceSafe: true,
        useOriginalName: true,
        name: 'trading_fetch_candles',
        description:
            'Fetch historical OHLCV candle data from public exchange APIs (Binance with MEXC fallback). ' +
            'No API key required. Automatically stores the fetched candles in the candle store for use ' +
            'with trading_compute_indicators, trading_predict_candles, and trading_visualize. ' +
            'Supports all standard timeframes from 1m to 1M and up to 1000 candles per request.',
        parameters: {
            type: 'object',
            properties: {
                symbol: {
                    type: 'string',
                    description: 'Trading pair symbol, e.g. BTCUSDT, ETHUSDT, SOLUSDT.',
                },
                interval: {
                    type: 'string',
                    enum: ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M'],
                    description: 'Candle timeframe/interval. Default: from plugin settings.',
                },
                limit: {
                    type: 'number',
                    description: 'Number of candles to fetch (1–1000). Default: 500.',
                },
                market: {
                    type: 'string',
                    enum: ['spot', 'futures'],
                    description: 'Market type. Default: spot. Use futures for perpetual contract data.',
                },
                start_time: {
                    type: 'string',
                    description: 'Start time as ISO 8601 string (e.g. "2026-03-01T00:00:00Z"). Optional — if omitted, fetches the most recent candles.',
                },
                end_time: {
                    type: 'string',
                    description: 'End time as ISO 8601 string. Optional.',
                },
            },
            required: ['symbol'],
        },
        handler: async ({ symbol, interval, limit = 500, market = 'spot', start_time, end_time }) => {
            // No trading_enabled gate — fetching candle data is a read-only
            // operation against public exchange APIs (no API key, no positions,
            // no execution risk).  Only position/bot tools require the gate.

            const tf = interval || pluginSettings.default_timeframe;

            // Convert ISO timestamps to epoch milliseconds if provided
            let startTime, endTime;
            if (start_time) {
                const d = new Date(start_time);
                if (isNaN(d.getTime())) {
                    return `Error: Invalid start_time "${start_time}". Use ISO 8601 format (e.g. "2026-03-01T00:00:00Z").`;
                }
                startTime = d.getTime();
            }
            if (end_time) {
                const d = new Date(end_time);
                if (isNaN(d.getTime())) {
                    return `Error: Invalid end_time "${end_time}". Use ISO 8601 format.`;
                }
                endTime = d.getTime();
            }

            try {
                const result = await fetchCandles({
                    symbol,
                    interval: tf,
                    limit,
                    startTime,
                    endTime,
                    market,
                    timeoutMs: 15000,
                });

                // Repair OHLC integrity (ensure high >= max(open, close), low <= min(open, close))
                for (const c of result.candles) {
                    c.high = Math.max(c.high, c.open, c.close);
                    c.low = Math.min(c.low, c.open, c.close);
                }

                // Store in candle store
                instance.candleStore.set(symbol, tf, result.candles);
                const totalCount = instance.candleStore.count(symbol, tf);

                const first = result.candles[0];
                const last = result.candles[result.candles.length - 1];

                return JSON.stringify({
                    success: true,
                    symbol: result.symbol,
                    interval: result.interval,
                    market,
                    source: result.source,
                    candles_fetched: result.candles.length,
                    total_in_store: totalCount,
                    time_range: {
                        from: first.time,
                        to: last.time,
                    },
                    latest_candle: {
                        time: last.time,
                        open: last.open,
                        high: last.high,
                        low: last.low,
                        close: last.close,
                        volume: last.volume,
                    },
                    message: `Fetched ${result.candles.length} candles for ${result.symbol} (${result.interval}) from ${result.source}. ` +
                             `Range: ${first.time} → ${last.time}. Total in store: ${totalCount}.`,
                }, null, 2);
            } catch (err) {
                return `Error fetching candles: ${err.message}`;
            }
        },
    });

    // ── Tool 4: trading_scan_markets ──────────────────────────────────────

    api.tools.register({
        useOriginalName: true,
        name: 'trading_scan_markets',
        description:
            'Scan MEXC futures markets for high-volatility trading opportunities. Use the browser to navigate to MEXC futures market list and extract pair data. Returns instructions for browser-based scanning.',
        parameters: {
            type: 'object',
            properties: {
                min_volume_24h: {
                    type: 'number',
                    description: 'Minimum 24h volume in USDT. Default: 1000000',
                },
                min_volatility: {
                    type: 'number',
                    description: 'Minimum price change % in last hour. Default: 1.0',
                },
                max_results: {
                    type: 'number',
                    description: 'Max pairs to return. Default: 10',
                },
                category: {
                    type: 'string',
                    enum: ['all', 'hot', 'new', 'gainers', 'losers'],
                    description: 'Filter category. Default: hot',
                },
            },
        },
        handler: async ({ min_volume_24h = 1000000, min_volatility = 1.0, max_results = 10, category = 'hot' }) => {
            if (!pluginSettings.trading_enabled) {
                return 'Error: Trading bot is disabled. Enable it in plugin settings.';
            }

            return JSON.stringify({
                action: 'scan_markets',
                instructions: `To scan MEXC futures markets:
1. Use browse_open to navigate to https://futures.mexc.com/exchange
2. Wait for the market list to load
3. Look for the ${category} tab/category
4. Extract pair data: symbol, price, 24h change %, 24h volume
5. Filter: volume > $${min_volume_24h.toLocaleString()}, volatility > ${min_volatility}%
6. Return top ${max_results} results sorted by volatility
7. For each promising pair, use trading_get_candles to load data, then trading_predict_candles to generate signals`,
                filters: { min_volume_24h, min_volatility, max_results, category },
                mexc_url: 'https://futures.mexc.com/exchange',
            });
        },
    });

    // ── Tool 5: trading_open_position ─────────────────────────────────────

    api.tools.register({
        useOriginalName: true,
        name: 'trading_open_position',
        description:
            'Open a leveraged futures position on MEXC. In paper mode, records the trade without executing. In live mode, provides browser automation instructions. Risk limits are enforced automatically.',
        parameters: {
            type: 'object',
            properties: {
                symbol: { type: 'string', description: 'Trading pair, e.g. BTCUSDT' },
                direction: { type: 'string', enum: ['LONG', 'SHORT'], description: 'Position direction' },
                size_usdt: { type: 'number', description: 'Position size in USDT' },
                leverage: { type: 'number', description: 'Leverage multiplier' },
                stop_loss_pct: { type: 'number', description: 'Stop-loss as % from entry. Default from settings.' },
                take_profit_pct: { type: 'number', description: 'Take-profit as % from entry. Default from settings.' },
                entry_price: { type: 'number', description: 'Entry price (for paper mode tracking). In live mode, market price is used.' },
            },
            required: ['symbol', 'direction', 'size_usdt'],
        },
        handler: async ({ symbol, direction, size_usdt, leverage, stop_loss_pct, take_profit_pct, entry_price }) => {
            if (!pluginSettings.trading_enabled) {
                return 'Error: Trading bot is disabled. Enable it in plugin settings.';
            }

            const lev = leverage || pluginSettings.max_leverage;
            const validation = instance.riskManager.validateTrade({
                symbol,
                direction,
                sizeUsdt: size_usdt,
                leverage: lev,
            });

            if (!validation.allowed) {
                return `Trade REJECTED by risk manager: ${validation.reason}`;
            }

            const actualSize = validation.adjustedSize;
            const actualLeverage = validation.adjustedLeverage;

            // For paper mode or when entry_price is provided
            const price = entry_price || instance.candleStore.getLatest(symbol, pluginSettings.default_timeframe)?.close;
            if (!price) {
                return `Error: No price available for ${symbol}. Provide entry_price or load candle data first.`;
            }

            const sl = instance.riskManager.calculateStopLoss(price, direction, stop_loss_pct);
            const tp = instance.riskManager.calculateTakeProfit(price, direction, take_profit_pct);

            const position = {
                symbol: symbol.toUpperCase(),
                direction,
                entryPrice: price,
                sizeUsdt: actualSize,
                leverage: actualLeverage,
                stopLoss: Math.round(sl * 100) / 100,
                takeProfit: Math.round(tp * 100) / 100,
                openedAt: new Date().toISOString(),
            };

            if (pluginSettings.trading_mode === 'paper') {
                instance.riskManager.addPosition(position);
                return JSON.stringify({
                    success: true,
                    mode: 'paper',
                    position,
                    message: `PAPER TRADE: Opened ${direction} ${symbol} — $${actualSize} @ ${price} (${actualLeverage}x) | SL: ${position.stopLoss} | TP: ${position.takeProfit}`,
                    risk_note: validation.reason,
                });
            }

            // Live mode — return browser instructions
            instance.riskManager.addPosition(position);
            return JSON.stringify({
                success: true,
                mode: 'live',
                position,
                browser_instructions: `To open this position on MEXC:
1. browse_open https://futures.mexc.com/exchange/${symbol}
2. Set leverage to ${actualLeverage}x
3. Select ${direction === 'LONG' ? 'Buy/Long' : 'Sell/Short'} tab
4. Set order type to Market
5. Enter margin: $${actualSize}
6. Set TP: ${position.takeProfit} / SL: ${position.stopLoss}
7. Click to submit order
8. Confirm in popup
9. Verify position in open positions table`,
                risk_note: validation.reason,
            });
        },
    });

    // ── Tool 6: trading_close_position ────────────────────────────────────

    api.tools.register({
        useOriginalName: true,
        name: 'trading_close_position',
        description:
            'Close an open futures position. In paper mode, records the close. In live mode, provides browser instructions.',
        parameters: {
            type: 'object',
            properties: {
                symbol: { type: 'string', description: 'Symbol of position to close' },
                close_price: { type: 'number', description: 'Close price (for paper mode). In live mode, market price is used.' },
            },
            required: ['symbol'],
        },
        handler: async ({ symbol, close_price }) => {
            if (!pluginSettings.trading_enabled) {
                return 'Error: Trading bot is disabled.';
            }

            const price = close_price || instance.candleStore.getLatest(symbol, pluginSettings.default_timeframe)?.close;
            if (!price) {
                return `Error: No price for ${symbol}. Provide close_price or load candle data.`;
            }

            const closed = instance.riskManager.closePosition(symbol, price);
            if (!closed) {
                return `Error: No open position found for ${symbol}.`;
            }

            if (pluginSettings.trading_mode === 'paper') {
                return JSON.stringify({
                    success: true,
                    mode: 'paper',
                    closed_position: closed,
                    message: `PAPER TRADE CLOSED: ${closed.direction} ${symbol} — PnL: $${closed.pnlUsdt} (${closed.pnlPct}%)`,
                });
            }

            return JSON.stringify({
                success: true,
                mode: 'live',
                closed_position: closed,
                browser_instructions: `To close position on MEXC:
1. Navigate to open positions table
2. Find ${symbol} position
3. Click "Close" or "Market Close"
4. Confirm close
5. Verify position removed from open positions`,
            });
        },
    });

    // ── Tool 7: trading_get_positions ─────────────────────────────────────

    api.tools.register({
        surfaceSafe: true,
        useOriginalName: true,
        name: 'trading_get_positions',
        description: 'Get all currently tracked open positions with unrealized PnL.',
        parameters: {
            type: 'object',
            properties: {},
        },
        handler: async () => {
            const positions = instance.riskManager.getOpenPositions();

            const enriched = positions.map(p => {
                const currentPrice = instance.candleStore.getLatest(p.symbol, pluginSettings.default_timeframe)?.close;
                if (currentPrice) {
                    const { pnlUsdt, pnlPct } = instance.riskManager.calculatePnL(p, currentPrice);
                    const { shouldClose, reason } = instance.riskManager.checkStopConditions(p, currentPrice);
                    return { ...p, currentPrice, unrealizedPnlUsdt: pnlUsdt, unrealizedPnlPct: pnlPct, shouldClose, closeReason: reason };
                }
                return { ...p, currentPrice: null, unrealizedPnlUsdt: null, unrealizedPnlPct: null };
            });

            return JSON.stringify({
                positions: enriched,
                count: positions.length,
                available_slots: instance.riskManager.availableSlots(),
                daily_summary: instance.riskManager.getDailySummary(),
            }, null, 2);
        },
    });

    // ── Tool 8: trading_get_account ───────────────────────────────────────

    api.tools.register({
        surfaceSafe: true,
        useOriginalName: true,
        name: 'trading_get_account',
        description: 'Get trading account summary: daily PnL, positions, risk status, halt conditions.',
        parameters: {
            type: 'object',
            properties: {},
        },
        handler: async () => {
            const summary = instance.riskManager.getDailySummary();
            const halt = instance.riskManager.checkHaltConditions();

            return JSON.stringify({
                ...summary,
                halt_status: halt,
                settings: {
                    mode: pluginSettings.trading_mode,
                    max_position_size: pluginSettings.max_position_size_usdt,
                    max_leverage: pluginSettings.max_leverage,
                    max_concurrent: pluginSettings.max_concurrent_positions,
                    default_sl_pct: pluginSettings.default_stop_loss_pct,
                    default_tp_pct: pluginSettings.default_take_profit_pct,
                    cadence: pluginSettings.default_cadence_seconds,
                    timeframe: pluginSettings.default_timeframe,
                },
                bot_running: instance.botRunning,
            }, null, 2);
        },
    });

    // ── Tool 9: trading_modify_position ───────────────────────────────────

    api.tools.register({
        useOriginalName: true,
        name: 'trading_modify_position',
        description: 'Modify stop-loss or take-profit on an open position.',
        parameters: {
            type: 'object',
            properties: {
                symbol: { type: 'string', description: 'Symbol of position to modify' },
                new_stop_loss: { type: 'number', description: 'New stop-loss price' },
                new_take_profit: { type: 'number', description: 'New take-profit price' },
            },
            required: ['symbol'],
        },
        handler: async ({ symbol, new_stop_loss, new_take_profit }) => {
            const positions = instance.riskManager.getOpenPositions();
            const pos = positions.find(p => p.symbol === symbol.toUpperCase());
            if (!pos) {
                return `Error: No open position for ${symbol}.`;
            }

            if (new_stop_loss !== undefined) pos.stopLoss = new_stop_loss;
            if (new_take_profit !== undefined) pos.takeProfit = new_take_profit;

            return JSON.stringify({
                success: true,
                symbol: pos.symbol,
                direction: pos.direction,
                stop_loss: pos.stopLoss,
                take_profit: pos.takeProfit,
                message: `Position ${symbol} modified. SL: ${pos.stopLoss} | TP: ${pos.takeProfit}`,
            });
        },
    });

    // ── Tool 15: trading_set_risk_limits ─────────────────────────────────

    api.tools.register({
        useOriginalName: true,
        name: 'trading_set_risk_limits',
        description:
            'Adjust risk management limits at runtime. Changes take effect immediately for all subsequent trades. ' +
            'At least one parameter must be provided. Values are clamped to the same safety bounds enforced by the settings UI.',
        parameters: {
            type: 'object',
            properties: {
                max_position_size_usdt: {
                    type: 'number',
                    description: 'Maximum position size per trade in USDT (5–10000).',
                },
                max_leverage: {
                    type: 'number',
                    description: 'Maximum leverage multiplier (1–125).',
                },
                max_concurrent_positions: {
                    type: 'number',
                    description: 'Maximum number of positions open simultaneously (1–20).',
                },
                default_stop_loss_pct: {
                    type: 'number',
                    description: 'Default stop-loss percentage from entry price (0.5–50).',
                },
                default_take_profit_pct: {
                    type: 'number',
                    description: 'Default take-profit percentage from entry price (0.5–100).',
                },
                max_daily_loss_usdt: {
                    type: 'number',
                    description: 'Maximum daily loss before bot halts trading (10–50000).',
                },
            },
        },
        handler: async ({
            max_position_size_usdt,
            max_leverage,
            max_concurrent_positions,
            default_stop_loss_pct,
            default_take_profit_pct,
            max_daily_loss_usdt,
        }) => {
            // Require at least one parameter
            const provided = { max_position_size_usdt, max_leverage, max_concurrent_positions, default_stop_loss_pct, default_take_profit_pct, max_daily_loss_usdt };
            const specified = Object.entries(provided).filter(([, v]) => v !== undefined);
            if (specified.length === 0) {
                return 'Error: Provide at least one risk limit to change (max_position_size_usdt, max_leverage, max_concurrent_positions, default_stop_loss_pct, default_take_profit_pct, max_daily_loss_usdt).';
            }

            // Clamp values to settings schema bounds
            const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

            const updates = {};
            const changes = [];

            if (max_position_size_usdt !== undefined) {
                const v = clamp(max_position_size_usdt, 5, 10000);
                updates.maxPositionSizeUsdt = v;
                pluginSettings.max_position_size_usdt = v;
                changes.push(`max_position_size: $${v}`);
            }
            if (max_leverage !== undefined) {
                const v = clamp(Math.floor(max_leverage), 1, 125);
                updates.maxLeverage = v;
                pluginSettings.max_leverage = v;
                changes.push(`max_leverage: ${v}x`);
            }
            if (max_concurrent_positions !== undefined) {
                const v = clamp(Math.floor(max_concurrent_positions), 1, 20);
                updates.maxConcurrentPositions = v;
                pluginSettings.max_concurrent_positions = v;
                changes.push(`max_concurrent_positions: ${v}`);
            }
            if (default_stop_loss_pct !== undefined) {
                const v = clamp(default_stop_loss_pct, 0.5, 50);
                updates.defaultStopLossPct = v;
                pluginSettings.default_stop_loss_pct = v;
                changes.push(`default_stop_loss: ${v}%`);
            }
            if (default_take_profit_pct !== undefined) {
                const v = clamp(default_take_profit_pct, 0.5, 100);
                updates.defaultTakeProfitPct = v;
                pluginSettings.default_take_profit_pct = v;
                changes.push(`default_take_profit: ${v}%`);
            }
            if (max_daily_loss_usdt !== undefined) {
                const v = clamp(max_daily_loss_usdt, 10, 50000);
                updates.maxDailyLossUsdt = v;
                pluginSettings.max_daily_loss_usdt = v;
                changes.push(`max_daily_loss: $${v}`);
            }

            // Push to RiskManager immediately
            instance.riskManager.updateSettings(updates);

            // Persist to disk so settings survive restart
            try {
                await api.settings.setAll({ ...pluginSettings });
            } catch (persistErr) {
                // Non-fatal: log but continue — in-memory values are still active
                consoleStyler.log('warn', `[trading-chart] Failed to persist risk limits: ${persistErr.message}`);
            }

            return JSON.stringify({
                success: true,
                changes,
                current_limits: {
                    max_position_size_usdt: instance.riskManager.settings.maxPositionSizeUsdt,
                    max_leverage: instance.riskManager.settings.maxLeverage,
                    max_concurrent_positions: instance.riskManager.settings.maxConcurrentPositions,
                    default_stop_loss_pct: instance.riskManager.settings.defaultStopLossPct,
                    default_take_profit_pct: instance.riskManager.settings.defaultTakeProfitPct,
                    max_daily_loss_usdt: instance.riskManager.settings.maxDailyLossUsdt,
                },
                open_positions: instance.riskManager.getOpenPositions().length,
                available_slots: instance.riskManager.availableSlots(),
                message: `Risk limits updated: ${changes.join(', ')}`,
            }, null, 2);
        },
    });

    // ── Tool 10: trading_start_bot ────────────────────────────────────────

    api.tools.register({
        useOriginalName: true,
        name: 'trading_start_bot',
        description:
            'Start the automated trading bot loop. Runs on a repeating cadence, checking positions and scanning for opportunities. The bot uses the prediction engine and LLM validation to make trading decisions.',
        parameters: {
            type: 'object',
            properties: {
                cadence_seconds: { type: 'number', description: 'How often to run in seconds. Default: from settings.' },
                symbols: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Specific symbols to trade. If empty, uses scanner.',
                },
                mode: {
                    type: 'string',
                    enum: ['live', 'paper'],
                    description: 'Trading mode. Default: from settings.',
                },
            },
        },
        handler: async ({ cadence_seconds, symbols = [], mode }) => {
            if (!pluginSettings.trading_enabled) {
                return 'Error: Trading bot is disabled. Enable it in plugin settings.';
            }

            if (instance.botRunning) {
                return 'Error: Bot is already running. Stop it first with trading_stop_bot.';
            }

            const cadence = (cadence_seconds || pluginSettings.default_cadence_seconds) * 1000;
            const tradingMode = mode || pluginSettings.trading_mode;

            instance.botConfig = {
                cadence,
                symbols,
                mode: tradingMode,
                startedAt: new Date().toISOString(),
            };
            instance.botRunning = true;

            // Note: The actual bot loop implementation will invoke the LLM
            // on each tick via api.ai.ask() with the prediction data and
            // available tools. For now, we set up the timer and return.
            instance.botTimer = setInterval(async () => {
                try {
                    // Check halt conditions
                    const halt = instance.riskManager.checkHaltConditions();
                    if (halt.halted) {
                        clearInterval(instance.botTimer);
                        instance.botRunning = false;
                        instance.botTimer = null;

                        // Broadcast halt event so the UI is notified immediately
                        const haltPayload = {
                            reason: halt.reason || 'Risk limit reached',
                            stoppedAt: new Date().toISOString(),
                            dailySummary: instance.riskManager.getDailySummary(),
                            openPositions: instance.riskManager.getOpenPositions().length,
                        };
                        if (api.events && typeof api.events.emit === 'function') {
                            api.events.emit('trading:bot:halted', haltPayload);
                        }
                        consoleStyler.log('warning', `[Trading Bot] Auto-halted: ${halt.reason}`);
                        return;
                    }

                    // The bot tick will be implemented in Phase 4
                    // For now, log that a tick occurred
                    consoleStyler.log('system', `[Trading Bot] Tick at ${new Date().toISOString()} — ${instance.riskManager.getOpenPositions().length} open positions`);
                } catch (e) {
                    consoleStyler.log('error', `[Trading Bot] Error in tick: ${e.message}`);
                }
            }, cadence);
            // Don't keep the Node.js process alive just for the trading bot timer
            if (instance.botTimer.unref) instance.botTimer.unref();

            return JSON.stringify({
                bot_id: `bot-${Date.now()}`,
                status: 'running',
                cadence_seconds: cadence / 1000,
                mode: tradingMode,
                symbols: symbols.length > 0 ? symbols : 'auto-scan',
                started_at: instance.botConfig.startedAt,
                message: `Trading bot started in ${tradingMode.toUpperCase()} mode. Cadence: ${cadence / 1000}s.`,
            });
        },
    });

    // ── Tool 11: trading_stop_bot ─────────────────────────────────────────

    api.tools.register({
        useOriginalName: true,
        name: 'trading_stop_bot',
        description: 'Stop the automated trading bot. Does not close open positions unless specified.',
        parameters: {
            type: 'object',
            properties: {
                close_all: {
                    type: 'boolean',
                    description: 'Also close all open positions. Default: false.',
                },
            },
        },
        handler: async ({ close_all = false }) => {
            if (!instance.botRunning) {
                return 'Bot is not running.';
            }

            if (instance.botTimer) {
                clearInterval(instance.botTimer);
                instance.botTimer = null;
            }
            instance.botRunning = false;

            let closedPositions = [];
            if (close_all) {
                const positions = instance.riskManager.getOpenPositions();
                for (const pos of positions) {
                    const price = instance.candleStore.getLatest(pos.symbol, pluginSettings.default_timeframe)?.close || pos.entryPrice;
                    const closed = instance.riskManager.closePosition(pos.symbol, price);
                    if (closed) closedPositions.push(closed);
                }
            }

            return JSON.stringify({
                status: 'stopped',
                ran_from: instance.botConfig?.startedAt,
                stopped_at: new Date().toISOString(),
                positions_closed: closedPositions.length,
                closed_positions: closedPositions,
                remaining_open: instance.riskManager.getOpenPositions().length,
                daily_summary: instance.riskManager.getDailySummary(),
            }, null, 2);
        },
    });

    // ── Tool 12: trading_get_trade_history ────────────────────────────────

    api.tools.register({
        surfaceSafe: true,
        useOriginalName: true,
        name: 'trading_get_trade_history',
        description: 'Get trading performance summary including PnL, win rate, and daily metrics.',
        parameters: {
            type: 'object',
            properties: {},
        },
        handler: async () => {
            return JSON.stringify(instance.riskManager.getDailySummary(), null, 2);
        },
    });

    // ── Tool 13: trading_visualize ────────────────────────────────────────

    api.tools.register({
        useOriginalName: true,
        surfaceSafe: true,
        name: 'trading_visualize',
        description:
            'Generate an interactive trading chart from stored candle data with indicators and prediction signals overlaid.',
        parameters: {
            type: 'object',
            properties: {
                symbol: { type: 'string', description: 'Symbol to chart' },
                timeframe: { type: 'string', description: 'Timeframe. Default: from settings.' },
                show_prediction: { type: 'boolean', description: 'Show prediction arrow. Default: true.' },
                indicators_to_show: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Indicator overlays. Default: ema, bollinger.',
                },
                candle_count: { type: 'number', description: 'Number of candles to display. Default: 60.' },
            },
            required: ['symbol'],
        },
        handler: async ({ symbol, timeframe, show_prediction = true, indicators_to_show = ['ema', 'bollinger'], candle_count = 60 }) => {
            const tf = timeframe || pluginSettings.default_timeframe;
            const data = instance.candleStore.get(symbol, tf, candle_count);

            if (!data || data.candles.length === 0) {
                return `Error: No candle data for ${symbol} (${tf}). Use trading_get_candles first.`;
            }

            // Build chart config
            const chartConfig = {
                title: `${symbol.toUpperCase()} ${tf}`,
                symbol: symbol.toUpperCase(),
                timeframe: tf,
                width: pluginSettings.defaultWidth,
                height: pluginSettings.defaultHeight,
                theme: pluginSettings.defaultTheme,
                candles: data.candles,
                indicators: [],
                annotations: [],
                showVolume: true,
                showGrid: true,
                showCrosshair: true,
            };

            // Add indicator overlays
            const indicatorColors = {
                ema: ['#f59e0b', '#3b82f6', '#8b5cf6', '#ef4444'],
                sma: ['#22c55e', '#06b6d4'],
                bollinger: ['#a855f7'],
            };

            for (const ind of indicators_to_show) {
                if (ind === 'ema') {
                    chartConfig.indicators.push(
                        { type: 'ema', period: 9, color: indicatorColors.ema[0] },
                        { type: 'ema', period: 21, color: indicatorColors.ema[1] },
                    );
                } else if (ind === 'sma') {
                    chartConfig.indicators.push(
                        { type: 'sma', period: 20, color: indicatorColors.sma[0] },
                    );
                } else if (ind === 'bollinger') {
                    chartConfig.indicators.push(
                        { type: 'bollinger', period: 20, color: indicatorColors.bollinger[0], stdDev: 2 },
                    );
                }
            }

            // Add prediction arrow if requested
            if (show_prediction && data.candles.length >= 30) {
                const ohlcv = {
                    opens: data.candles.map(c => c.open),
                    highs: data.candles.map(c => c.high),
                    lows: data.candles.map(c => c.low),
                    closes: data.candles.map(c => c.close),
                    volumes: data.candles.map(c => c.volume || 0),
                };

                const weights = {
                    trend: pluginSettings.weight_trend,
                    momentum: pluginSettings.weight_momentum,
                    volatility: pluginSettings.weight_volatility,
                    volume: pluginSettings.weight_volume,
                    support_resistance: pluginSettings.weight_support_resistance,
                };

                const prediction = predictCandles(ohlcv, { weights });
                if (prediction.prediction) {
                    const lastCandle = data.candles[data.candles.length - 1];
                    const dir = prediction.prediction.direction;
                    if (dir !== 'NEUTRAL') {
                        chartConfig.annotations.push({
                            type: 'arrow',
                            time: lastCandle.time,
                            price: lastCandle.close,
                            direction: dir === 'LONG' ? 'up' : 'down',
                            color: dir === 'LONG' ? '#22c55e' : '#ef4444',
                            label: `${dir} ${prediction.prediction.intensity} (${Math.round(prediction.prediction.confidence * 100)}%)`,
                        });
                    }

                    // Add SL/TP lines
                    chartConfig.annotations.push({
                        type: 'hline',
                        price: prediction.prediction.stop_loss,
                        color: '#ef4444',
                        style: 'dashed',
                        label: `SL: ${prediction.prediction.stop_loss}`,
                    });
                    chartConfig.annotations.push({
                        type: 'hline',
                        price: prediction.prediction.take_profit,
                        color: '#22c55e',
                        style: 'dashed',
                        label: `TP: ${prediction.prediction.take_profit}`,
                    });
                }
            }

            // Add open position markers
            const positions = instance.riskManager.getOpenPositions()
                .filter(p => p.symbol === symbol.toUpperCase());
            for (const pos of positions) {
                chartConfig.annotations.push({
                    type: 'hline',
                    price: pos.entryPrice,
                    color: '#3b82f6',
                    style: 'solid',
                    label: `Entry: ${pos.entryPrice} (${pos.direction})`,
                });
            }

            return { __directMarkdown: `\`\`\`tradingchart\n${JSON.stringify(chartConfig)}\n\`\`\`` };
        },
    });

    // ── Tool 14: trading_trained_predictor ─────────────────────────────────

    api.tools.register({
        useOriginalName: true,
        name: 'trading_trained_predictor',
        description:
            'A trainable neural network candle predictor. Supports three actions:\n' +
            '- "train": Train a model on stored candle data for a symbol/timeframe. Returns training metrics (loss, accuracy, epochs).\n' +
            '- "predict": Generate next-candle predictions using a trained model. Returns direction, confidence, predicted prices.\n' +
            '- "list": List all trained models with their error metrics and training dates.\n' +
            'Models are trained per symbol+timeframe pair and persist in memory for the session.',
        parameters: {
            type: 'object',
            properties: {
                action: {
                    type: 'string',
                    enum: ['train', 'predict', 'list'],
                    description: 'Action to perform: train a new model, predict with existing model, or list all models.',
                },
                symbol: {
                    type: 'string',
                    description: 'Trading pair symbol (required for train and predict).',
                },
                timeframe: {
                    type: 'string',
                    enum: ['1m', '5m', '15m', '30m', '1h', '4h', '1d'],
                    description: 'Candle timeframe. Default: from settings.',
                },
                epochs: {
                    type: 'number',
                    description: 'Training epochs (for train action). Default: 50.',
                },
                horizon: {
                    type: 'number',
                    description: 'Predict next N candles (1 or 2). Default: 2.',
                },
                hidden_size_1: {
                    type: 'number',
                    description: 'First hidden layer neurons. Default: 32.',
                },
                hidden_size_2: {
                    type: 'number',
                    description: 'Second hidden layer neurons. Default: 16.',
                },
                learning_rate: {
                    type: 'number',
                    description: 'Adam learning rate. Default: 0.001.',
                },
            },
            required: ['action'],
        },
        handler: async ({
            action,
            symbol,
            timeframe,
            epochs = 50,
            horizon = 2,
            hidden_size_1 = 32,
            hidden_size_2 = 16,
            learning_rate = 0.001,
        }) => {
            const tf = timeframe || pluginSettings.default_timeframe;

            // ── LIST ──
            if (action === 'list') {
                const models = instance.predictorStore.list();
                if (models.length === 0) {
                    return JSON.stringify({
                        models: [],
                        message: 'No trained models. Use action "train" with a symbol that has candle data loaded.',
                    });
                }
                return JSON.stringify({ models, count: models.length }, null, 2);
            }

            // ── TRAIN ──
            if (action === 'train') {
                if (!symbol) {
                    return 'Error: symbol is required for training.';
                }

                const data = instance.candleStore.get(symbol, tf);
                if (!data || data.candles.length < 60) {
                    return `Error: Need at least 60 candles for ${symbol} (${tf}) to train. Have ${data?.candles.length || 0}. Use trading_get_candles first.`;
                }

                const ohlcv = {
                    opens: data.candles.map(c => c.open),
                    highs: data.candles.map(c => c.high),
                    lows: data.candles.map(c => c.low),
                    closes: data.candles.map(c => c.close),
                    volumes: data.candles.map(c => c.volume || 0),
                };

                const predictor = new TrainablePredictor({
                    hiddenSize1: hidden_size_1,
                    hiddenSize2: hidden_size_2,
                    learningRate: learning_rate,
                    horizon: Math.max(1, Math.min(2, horizon)),
                });

                try {
                    const metrics = predictor.train(ohlcv, {
                        epochs,
                        validationSplit: 0.2,
                        earlyStopPatience: Math.max(5, Math.floor(epochs / 5)),
                    });

                    instance.predictorStore.set(symbol, tf, predictor, data.candles.length);

                    return JSON.stringify({
                        success: true,
                        symbol: symbol.toUpperCase(),
                        timeframe: tf,
                        candles_used: data.candles.length,
                        config: {
                            hidden_layers: [hidden_size_1, hidden_size_2],
                            learning_rate,
                            horizon: predictor.config.horizon,
                        },
                        metrics: {
                            epochs_trained: metrics.epochs,
                            train_loss: metrics.trainLoss,
                            val_loss: metrics.valLoss,
                            train_mae: metrics.trainMAE,
                            val_mae: metrics.valMAE,
                            direction_accuracy_pct: metrics.directionAccuracy,
                            samples_used: metrics.samplesUsed,
                            training_time_ms: metrics.trainingTimeMs,
                        },
                        message: `Model trained for ${symbol.toUpperCase()} (${tf}). Direction accuracy: ${metrics.directionAccuracy}%, Val loss: ${metrics.valLoss}`,
                    }, null, 2);
                } catch (e) {
                    return `Error training model: ${e.message}`;
                }
            }

            // ── PREDICT ──
            if (action === 'predict') {
                if (!symbol) {
                    return 'Error: symbol is required for prediction.';
                }

                const entry = instance.predictorStore.get(symbol, tf);
                if (!entry) {
                    return `Error: No trained model for ${symbol.toUpperCase()} (${tf}). Train one first with action "train".`;
                }

                const data = instance.candleStore.get(symbol, tf);
                if (!data || data.candles.length < 55) {
                    return `Error: Need at least 55 candles for prediction. Have ${data?.candles.length || 0}.`;
                }

                const ohlcv = {
                    opens: data.candles.map(c => c.open),
                    highs: data.candles.map(c => c.high),
                    lows: data.candles.map(c => c.low),
                    closes: data.candles.map(c => c.close),
                    volumes: data.candles.map(c => c.volume || 0),
                };

                try {
                    const result = entry.predictor.predict(ohlcv);
                    const modelMetrics = entry.predictor.getMetrics();

                    return JSON.stringify({
                        symbol: symbol.toUpperCase(),
                        timeframe: tf,
                        timestamp: new Date().toISOString(),
                        current_price: ohlcv.closes[ohlcv.closes.length - 1],
                        predictions: result.candles,
                        model_info: {
                            trained_at: entry.trainedAt,
                            candles_trained_on: entry.candleCount,
                            direction_accuracy: modelMetrics?.directionAccuracy,
                            val_loss: modelMetrics?.valLoss,
                        },
                        raw_output: result.raw_output,
                    }, null, 2);
                } catch (e) {
                    return `Error generating prediction: ${e.message}`;
                }
            }

            return `Error: Unknown action "${action}". Use "train", "predict", or "list".`;
        },
    });
}

export async function deactivate(api) {
    const inst = api.getInstance();
    if (inst) {
        if (inst.botTimer) {
            clearInterval(inst.botTimer);
        }
        inst.candleStore?.clear();
        inst.predictorStore?.clear();
    }
    api.setInstance(null);
}
