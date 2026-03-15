/**
 * TradingChartBlock — React component that renders a ```tradingchart code fence
 * as an interactive TradingView-style candlestick chart with animation & replay.
 *
 * Features:
 * - Candlestick rendering with wicks
 * - Volume bars
 * - Technical indicators (SMA, EMA, Bollinger Bands)
 * - Annotations (hlines, labels, regions, trendlines, arrows)
 * - Crosshair tooltip on hover
 * - Optional candle-by-candle animation with play/pause/restart/speed controls
 */

import { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import { TradingChartEngine } from './tradingchart/TradingChartEngine';
import type { TradingChartConfig } from './tradingchart/types';
import { Play, Pause, RotateCcw, CandlestickChart } from 'lucide-react';

interface TradingChartBlockProps {
  code: string;
}

function formatProgress(current: number, total: number): string {
  return `${current} / ${total}`;
}

export const TradingChartBlock: React.FC<TradingChartBlockProps> = ({ code }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<TradingChartEngine | null>(null);
  const [playing, setPlaying] = useState(false);
  const [visibleCount, setVisibleCount] = useState(0);
  const [speed, setSpeed] = useState(100);

  // Parse config
  const config: TradingChartConfig | null = useMemo(() => {
    try {
      return JSON.parse(code);
    } catch (e) {
      console.error('Failed to parse tradingchart config:', e);
      return null;
    }
  }, [code]);

  const width = config?.width ?? 800;
  const height = config?.height ?? 450;
  const totalCandles = config?.candles?.length ?? 0;
  const hasAnimation = config?.animation?.enabled === true;

  // Initialize engine
  useEffect(() => {
    if (!canvasRef.current || !config) return;

    const canvas = canvasRef.current;
    canvas.width = width;
    canvas.height = height;

    const engine = new TradingChartEngine(canvas, config);
    engine.setOnUpdate(() => {
      setVisibleCount(engine.visibleCount);
      if (!engine.playing) {
        setPlaying(false);
      }
    });
    engineRef.current = engine;

    // Set initial state
    setVisibleCount(engine.visibleCount);
    setSpeed(config.animation?.speed ?? 100);

    // Render first frame
    engine.renderFrame();

    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, [config, width, height]);

  // Sync playing state
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;

    if (playing) {
      engine.play();
    } else {
      engine.pause();
    }
  }, [playing]);

  // Handlers
  const handlePlayPause = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;

    // If at the end, restart first
    if (!playing && engine.visibleCount >= engine.totalCandles) {
      engine.restart();
      setVisibleCount(engine.visibleCount);
    }

    setPlaying((prev) => !prev);
  }, [playing]);

  const handleRestart = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.restart();
    setVisibleCount(engine.visibleCount);
    setPlaying(false);
  }, []);

  const handleSeek = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const count = parseInt(e.target.value, 10);
      engineRef.current?.setVisibleCount(count);
      setVisibleCount(count);
    },
    []
  );

  const cycleSpeed = useCallback(() => {
    setSpeed((prev) => {
      const speeds = [200, 100, 50, 25];
      const idx = speeds.indexOf(prev);
      const next = speeds[(idx + 1) % speeds.length];
      engineRef.current?.setSpeed(next);
      return next;
    });
  }, []);

  const speedLabel = useMemo(() => {
    const labels: Record<number, string> = { 200: '0.5x', 100: '1x', 50: '2x', 25: '4x' };
    return labels[speed] ?? '1x';
  }, [speed]);

  // Error state
  if (!config) {
    return (
      <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-mono my-4">
        Invalid trading chart configuration — could not parse JSON
      </div>
    );
  }

  if (!config.candles || config.candles.length === 0) {
    return (
      <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-mono my-4">
        Trading chart has no candle data
      </div>
    );
  }

  return (
    <div className="my-6 rounded-xl bg-[#0a0a0a] border border-zinc-800/50 overflow-hidden shadow-lg transition-all duration-300 hover:border-zinc-700/40">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-zinc-900/30 border-b border-zinc-800/20">
        <div className="flex items-center gap-2">
          <CandlestickChart size={12} className="text-emerald-400" />
          <span className="text-[9px] uppercase text-zinc-500 font-bold tracking-[0.15em]">
            Trading Chart
          </span>
          {config.symbol && (
            <span className="text-xs font-bold text-zinc-200 ml-1">{config.symbol}</span>
          )}
          {config.timeframe && (
            <span className="text-[10px] text-zinc-500 ml-1">{config.timeframe}</span>
          )}
          {config.title && (
            <span className="text-xs text-zinc-400 ml-2">— {config.title}</span>
          )}
        </div>

        {/* Indicator legend */}
        {config.indicators && config.indicators.length > 0 && (
          <div className="flex items-center gap-3">
            {config.indicators.map((ind, i) => (
              <span key={i} className="flex items-center gap-1 text-[10px]">
                <span
                  className="inline-block w-3 h-0.5 rounded"
                  style={{ backgroundColor: ind.color }}
                />
                <span className="text-zinc-500">
                  {ind.type.toUpperCase()}({ind.period})
                </span>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Chart canvas */}
      {/* Chart canvas — logical dimensions set in useEffect; DPR scaling handled by engine */}
      <div className="relative" style={{ width: '100%', maxWidth: width }}>
        <canvas
          ref={canvasRef}
          className="block w-full"
          style={{ aspectRatio: `${width} / ${height}`, cursor: 'crosshair' }}
        />
      </div>

      {/* Animation controls — only shown when animation is configured */}
      {hasAnimation && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-zinc-900/20 border-t border-zinc-800/20">
          {/* Play/Pause */}
          <button
            onClick={handlePlayPause}
            className="p-1 rounded-md hover:bg-zinc-700/40 transition-colors"
            title={playing ? 'Pause' : 'Play'}
          >
            {playing ? (
              <Pause size={14} className="text-zinc-300" />
            ) : (
              <Play size={14} className="text-zinc-300" />
            )}
          </button>

          {/* Restart */}
          <button
            onClick={handleRestart}
            className="p-1 rounded-md hover:bg-zinc-700/40 transition-colors"
            title="Restart"
          >
            <RotateCcw size={12} className="text-zinc-500" />
          </button>

          {/* Timeline scrubber */}
          <input
            type="range"
            min={1}
            max={totalCandles}
            step={1}
            value={visibleCount}
            onChange={handleSeek}
            className="flex-1 h-1 bg-zinc-700 rounded-full appearance-none cursor-pointer
              [&::-webkit-slider-thumb]:appearance-none
              [&::-webkit-slider-thumb]:w-3
              [&::-webkit-slider-thumb]:h-3
              [&::-webkit-slider-thumb]:bg-emerald-400
              [&::-webkit-slider-thumb]:rounded-full
              [&::-webkit-slider-thumb]:cursor-pointer
            "
          />

          {/* Candle count display */}
          <span className="text-[10px] text-zinc-500 font-mono tabular-nums min-w-[60px] text-right">
            {formatProgress(visibleCount, totalCandles)}
          </span>

          {/* Speed toggle */}
          <button
            onClick={cycleSpeed}
            className="px-1.5 py-0.5 rounded text-[10px] font-mono text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700/40 transition-colors min-w-[32px]"
            title="Animation speed"
          >
            {speedLabel}
          </button>
        </div>
      )}
    </div>
  );
};
