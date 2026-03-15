/**
 * TradingChartEngine — Canvas-based rendering engine for TradingView-style charts.
 *
 * Handles:
 * - Candlestick rendering with wicks
 * - Volume bars (bottom sub-chart)
 * - Indicator overlay lines (SMA, EMA, Bollinger)
 * - Annotations (hlines, labels, regions, trendlines, arrows)
 * - Grid and price/time axes
 * - Mouse crosshair with tooltip
 * - Animation (candle-by-candle reveal with replay)
 */

import type {
  TradingChartConfig,
  Candle,
  ThemeColors,
  IndicatorLine,
} from './types';
import { computeIndicators } from './indicators';

// ── Theme colors ─────────────────────────────────────────────────────────

const DARK_THEME: ThemeColors = {
  background: '#0a0a14',
  gridLine: 'rgba(255,255,255,0.04)',
  axisText: '#6b7280',
  candleUp: '#22c55e',
  candleDown: '#ef4444',
  wickUp: '#22c55e',
  wickDown: '#ef4444',
  volumeUp: 'rgba(34,197,94,0.25)',
  volumeDown: 'rgba(239,68,68,0.25)',
  crosshair: 'rgba(255,255,255,0.3)',
  tooltipBg: 'rgba(17,17,27,0.95)',
  tooltipText: '#e5e7eb',
  tooltipBorder: 'rgba(255,255,255,0.1)',
};

const LIGHT_THEME: ThemeColors = {
  background: '#fafafa',
  gridLine: 'rgba(0,0,0,0.06)',
  axisText: '#6b7280',
  candleUp: '#16a34a',
  candleDown: '#dc2626',
  wickUp: '#16a34a',
  wickDown: '#dc2626',
  volumeUp: 'rgba(22,163,74,0.2)',
  volumeDown: 'rgba(220,38,38,0.2)',
  crosshair: 'rgba(0,0,0,0.2)',
  tooltipBg: 'rgba(255,255,255,0.95)',
  tooltipText: '#1f2937',
  tooltipBorder: 'rgba(0,0,0,0.1)',
};

// ── Layout constants ─────────────────────────────────────────────────────

const PADDING = { top: 20, right: 70, bottom: 30, left: 10 };
const VOLUME_HEIGHT_RATIO = 0.18; // fraction of chart area reserved for volume
const CANDLE_GAP_RATIO = 0.3; // gap between candles as fraction of slot width

// ── Engine ───────────────────────────────────────────────────────────────

export class TradingChartEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private config: TradingChartConfig;
  private colors: ThemeColors;
  private indicators: IndicatorLine[];
  private dpr: number;

  // Layout metrics (computed on resize / data change)
  private chartLeft = 0;
  private chartRight = 0;
  private chartTop = 0;
  private chartBottom = 0;
  private volumeTop = 0;
  private candleSlotWidth = 0;
  private candleBodyWidth = 0;

  /** Logical width (before DPR scaling) */
  private logicalWidth: number;
  /** Logical height (before DPR scaling) */
  private logicalHeight: number;

  // Price scale
  private priceMin = 0;
  private priceMax = 0;
  private volumeMax = 0;

  // Animation state
  private _visibleCount = 0;
  private _animationTimer: ReturnType<typeof setInterval> | null = null;
  private _playing = false;
  private _speed = 100; // ms per candle
  private _onUpdate: (() => void) | null = null;

  // Crosshair
  private _mouseX = -1;
  private _mouseY = -1;
  private _hoveredIndex = -1;
  private _mouseMoveHandler: ((e: MouseEvent) => void) | null = null;
  private _mouseLeaveHandler: (() => void) | null = null;
  private _rafId: number | null = null;
  private _crosshairDirty = false;

  // Cached data
  private _cachedVisibleCandles: Candle[] = [];
  private _timeIndexMap: Map<string, number>;

  constructor(canvas: HTMLCanvasElement, config: TradingChartConfig) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('TradingChartEngine: Failed to get 2D canvas context');
    }
    this.ctx = ctx;
    this.config = config;
    this.colors = config.theme === 'light' ? LIGHT_THEME : DARK_THEME;
    this.indicators = computeIndicators(
      config.candles,
      config.indicators ?? []
    );

    // Build time → index lookup map for O(1) annotation resolution
    this._timeIndexMap = new Map(
      config.candles.map((c, i) => [c.time, i])
    );

    // HiDPI / Retina scaling
    this.dpr = window.devicePixelRatio || 1;
    this.logicalWidth = canvas.width;
    this.logicalHeight = canvas.height;
    canvas.width = this.logicalWidth * this.dpr;
    canvas.height = this.logicalHeight * this.dpr;
    ctx.scale(this.dpr, this.dpr);

    // Initial visible count
    const anim = config.animation;
    if (anim?.enabled) {
      this._visibleCount = Math.max(1, anim.initialCandles ?? 5);
      this._speed = anim.speed ?? 100;
    } else {
      this._visibleCount = config.candles.length;
    }

    this.computeLayout();

    // Mouse events for crosshair — RAF-throttled to avoid redundant redraws
    if (config.showCrosshair !== false) {
      this._mouseMoveHandler = (e: MouseEvent) => {
        const rect = canvas.getBoundingClientRect();
        const scaleX = this.logicalWidth / rect.width;
        const scaleY = this.logicalHeight / rect.height;
        this._mouseX = (e.clientX - rect.left) * scaleX;
        this._mouseY = (e.clientY - rect.top) * scaleY;
        this._hoveredIndex = this.xToIndex(this._mouseX);
        this.scheduleRender();
      };
      this._mouseLeaveHandler = () => {
        this._mouseX = -1;
        this._mouseY = -1;
        this._hoveredIndex = -1;
        this.scheduleRender();
      };
      canvas.addEventListener('mousemove', this._mouseMoveHandler);
      canvas.addEventListener('mouseleave', this._mouseLeaveHandler);
    }
  }

  // ── Public API ───────────────────────────────────────────────────────

  get visibleCount(): number {
    return this._visibleCount;
  }

  get totalCandles(): number {
    return this.config.candles.length;
  }

  get playing(): boolean {
    return this._playing;
  }

  get hasAnimation(): boolean {
    return this.config.animation?.enabled === true;
  }

  get animationProgress(): number {
    if (!this.hasAnimation) return 1;
    const total = this.totalCandles;
    const initial = this.config.animation!.initialCandles ?? 5;
    const animated = total - initial;
    if (animated <= 0) return 1;
    return Math.min(1, (this._visibleCount - initial) / animated);
  }

  setOnUpdate(cb: () => void): void {
    this._onUpdate = cb;
  }

  setVisibleCount(count: number): void {
    this._visibleCount = Math.max(1, Math.min(this.totalCandles, count));
    this.computeLayout();
    this.renderFrame();
    this._onUpdate?.();
  }

  play(): void {
    if (this._playing) return;
    if (this._visibleCount >= this.totalCandles) {
      // Restart from initial
      this._visibleCount = Math.max(
        1,
        this.config.animation?.initialCandles ?? 5
      );
    }
    this._playing = true;
    this._animationTimer = setInterval(() => {
      if (this._visibleCount >= this.totalCandles) {
        this.pause();
        return;
      }
      this._visibleCount++;
      this.computeLayout();
      this.renderFrame();
      this._onUpdate?.();
    }, this._speed);
  }

  pause(): void {
    this._playing = false;
    if (this._animationTimer) {
      clearInterval(this._animationTimer);
      this._animationTimer = null;
    }
    this._onUpdate?.();
  }

  restart(): void {
    this.pause();
    const anim = this.config.animation;
    this._visibleCount = anim?.enabled
      ? Math.max(1, anim.initialCandles ?? 5)
      : this.totalCandles;
    this.computeLayout();
    this.renderFrame();
    this._onUpdate?.();
  }

  setSpeed(ms: number): void {
    this._speed = ms;
    if (this._playing) {
      this.pause();
      this.play();
    }
  }

  /** Coalesce multiple render requests (e.g. rapid mousemoves) into a single frame. */
  private scheduleRender(): void {
    if (this._crosshairDirty) return;
    this._crosshairDirty = true;
    this._rafId = requestAnimationFrame(() => {
      this._crosshairDirty = false;
      this._rafId = null;
      this.renderFrame();
    });
  }

  renderFrame(): void {
    const { ctx } = this;
    const w = this.logicalWidth;
    const h = this.logicalHeight;

    // Clear (use logical dimensions — ctx is already scaled by DPR)
    ctx.fillStyle = this.colors.background;
    ctx.fillRect(0, 0, w, h);

    this.drawGrid();
    this.drawAnnotationRegions();
    this.drawVolumeBars();
    this.drawCandles();
    this.drawIndicators();
    this.drawAnnotationOverlays();
    this.drawAxes();
    this.drawCrosshair();
  }

  destroy(): void {
    this.pause();
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    if (this._mouseMoveHandler) {
      this.canvas.removeEventListener('mousemove', this._mouseMoveHandler);
    }
    if (this._mouseLeaveHandler) {
      this.canvas.removeEventListener('mouseleave', this._mouseLeaveHandler);
    }
  }

  // ── Layout computation ─────────────────────────────────────────────

  private computeLayout(): void {
    const w = this.logicalWidth;
    const h = this.logicalHeight;

    // Cache visible candles slice
    this._cachedVisibleCandles = this.config.candles.slice(0, this._visibleCount);

    this.chartLeft = PADDING.left;
    this.chartRight = w - PADDING.right;
    this.chartTop = PADDING.top;

    const chartAreaHeight = h - PADDING.top - PADDING.bottom;
    const showVolume =
      this.config.showVolume !== false &&
      this._cachedVisibleCandles.some((c) => c.volume != null);

    if (showVolume) {
      this.volumeTop = h - PADDING.bottom - chartAreaHeight * VOLUME_HEIGHT_RATIO;
      this.chartBottom = this.volumeTop - 8; // small gap
    } else {
      this.volumeTop = h - PADDING.bottom;
      this.chartBottom = h - PADDING.bottom;
    }

    // Candle sizing
    const availableWidth = this.chartRight - this.chartLeft;
    const count = this._visibleCount;
    this.candleSlotWidth = availableWidth / Math.max(count, 1);
    this.candleBodyWidth = this.candleSlotWidth * (1 - CANDLE_GAP_RATIO);

    // Price range (with 5% padding)
    const candles = this._cachedVisibleCandles;
    if (candles.length === 0) return;

    let minP = Infinity;
    let maxP = -Infinity;
    for (const c of candles) {
      if (c.low < minP) minP = c.low;
      if (c.high > maxP) maxP = c.high;
    }

    // Include indicator values in range
    for (const ind of this.indicators) {
      for (let i = 0; i < this._visibleCount; i++) {
        const v = ind.values[i];
        if (v !== null) {
          if (v < minP) minP = v;
          if (v > maxP) maxP = v;
        }
        if (ind.upper) {
          const u = ind.upper[i];
          if (u !== null && u > maxP) maxP = u;
        }
        if (ind.lower) {
          const l = ind.lower[i];
          if (l !== null && l < minP) minP = l;
        }
      }
    }

    // Include annotation hlines
    for (const ann of this.config.annotations ?? []) {
      if (ann.type === 'hline') {
        if (ann.price < minP) minP = ann.price;
        if (ann.price > maxP) maxP = ann.price;
      }
    }

    const padding = (maxP - minP) * 0.05 || 1;
    this.priceMin = minP - padding;
    this.priceMax = maxP + padding;

    // Volume max
    this.volumeMax = 0;
    for (const c of candles) {
      if (c.volume != null && c.volume > this.volumeMax) {
        this.volumeMax = c.volume;
      }
    }
  }

  private get visibleCandles(): Candle[] {
    return this._cachedVisibleCandles;
  }

  // ── Coordinate conversions ─────────────────────────────────────────

  private priceToY(price: number): number {
    const range = this.priceMax - this.priceMin;
    if (range === 0) return this.chartTop;
    return (
      this.chartTop +
      (1 - (price - this.priceMin) / range) *
        (this.chartBottom - this.chartTop)
    );
  }

  private indexToX(index: number): number {
    return this.chartLeft + index * this.candleSlotWidth + this.candleSlotWidth / 2;
  }

  private xToIndex(x: number): number {
    const raw = (x - this.chartLeft) / this.candleSlotWidth;
    const idx = Math.floor(raw);
    return idx >= 0 && idx < this._visibleCount ? idx : -1;
  }

  /** Resolve annotation time reference (string or number index) to candle index */
  private resolveTimeIndex(ref: string | number): number {
    if (typeof ref === 'number') return Math.max(0, Math.min(ref, this._visibleCount - 1));
    const idx = this._timeIndexMap.get(ref);
    if (idx === undefined) return -1;
    return Math.min(idx, this._visibleCount - 1);
  }

  // ── Drawing primitives ─────────────────────────────────────────────

  private drawGrid(): void {
    if (this.config.showGrid === false) return;
    const { ctx } = this;
    const candles = this.visibleCandles;
    if (candles.length === 0) return;

    ctx.strokeStyle = this.colors.gridLine;
    ctx.lineWidth = 1;

    // Horizontal grid lines (price)
    const priceRange = this.priceMax - this.priceMin;
    const niceStep = this.niceStep(priceRange, 6);
    const startPrice = Math.ceil(this.priceMin / niceStep) * niceStep;

    for (let p = startPrice; p <= this.priceMax; p += niceStep) {
      const y = Math.round(this.priceToY(p)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(this.chartLeft, y);
      ctx.lineTo(this.chartRight, y);
      ctx.stroke();
    }

    // Vertical grid lines (time) — every N candles
    const timeStep = Math.max(1, Math.floor(candles.length / 8));
    for (let i = 0; i < candles.length; i += timeStep) {
      const x = Math.round(this.indexToX(i)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, this.chartTop);
      ctx.lineTo(x, this.chartBottom);
      ctx.stroke();
    }
  }

  private drawCandles(): void {
    const { ctx } = this;
    const candles = this.visibleCandles;

    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      const isUp = c.close >= c.open;
      const x = this.indexToX(i);
      const halfBody = this.candleBodyWidth / 2;

      // Wick
      ctx.strokeStyle = isUp ? this.colors.wickUp : this.colors.wickDown;
      ctx.lineWidth = Math.max(1, this.candleBodyWidth * 0.12);
      ctx.beginPath();
      ctx.moveTo(x, this.priceToY(c.high));
      ctx.lineTo(x, this.priceToY(c.low));
      ctx.stroke();

      // Body
      const bodyTop = this.priceToY(Math.max(c.open, c.close));
      const bodyBottom = this.priceToY(Math.min(c.open, c.close));
      const bodyHeight = Math.max(1, bodyBottom - bodyTop);

      ctx.fillStyle = isUp ? this.colors.candleUp : this.colors.candleDown;
      ctx.fillRect(x - halfBody, bodyTop, this.candleBodyWidth, bodyHeight);
    }
  }

  private drawVolumeBars(): void {
    if (this.config.showVolume === false) return;
    const { ctx } = this;
    const candles = this.visibleCandles;
    if (this.volumeMax === 0) return;

    const volHeight = this.logicalHeight - PADDING.bottom - this.volumeTop;
    const halfBody = this.candleBodyWidth / 2;

    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      if (c.volume == null) continue;
      const isUp = c.close >= c.open;
      const x = this.indexToX(i);
      const barH = (c.volume / this.volumeMax) * volHeight;
      const barY = this.logicalHeight - PADDING.bottom - barH;

      ctx.fillStyle = isUp ? this.colors.volumeUp : this.colors.volumeDown;
      ctx.fillRect(x - halfBody, barY, this.candleBodyWidth, barH);
    }
  }

  private drawIndicators(): void {
    const { ctx } = this;

    for (const ind of this.indicators) {
      // Main line
      this.drawIndicatorLine(ind.values, ind.config.color, ind.config.lineWidth ?? 1.5);

      // Bollinger bands
      if (ind.upper) {
        this.drawIndicatorLine(ind.upper, ind.config.color, 1, [4, 4]);
      }
      if (ind.lower) {
        this.drawIndicatorLine(ind.lower, ind.config.color, 1, [4, 4]);
      }

      // Fill between bollinger bands
      if (ind.upper && ind.lower) {
        ctx.save();
        ctx.globalAlpha = 0.05;
        ctx.fillStyle = ind.config.color;
        ctx.beginPath();

        let started = false;
        for (let i = 0; i < this._visibleCount; i++) {
          const u = ind.upper[i];
          if (u === null) continue;
          const x = this.indexToX(i);
          if (!started) {
            ctx.moveTo(x, this.priceToY(u));
            started = true;
          } else {
            ctx.lineTo(x, this.priceToY(u));
          }
        }
        // Back along lower
        for (let i = this._visibleCount - 1; i >= 0; i--) {
          const l = ind.lower[i];
          if (l === null) continue;
          ctx.lineTo(this.indexToX(i), this.priceToY(l));
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }
  }

  private drawIndicatorLine(
    values: (number | null)[],
    color: string,
    lineWidth: number,
    dash?: number[]
  ): void {
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    if (dash) ctx.setLineDash(dash);
    ctx.beginPath();

    let started = false;
    for (let i = 0; i < this._visibleCount; i++) {
      const v = values[i];
      if (v === null) {
        started = false;
        continue;
      }
      const x = this.indexToX(i);
      const y = this.priceToY(v);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  private drawAnnotationRegions(): void {
    const { ctx } = this;
    const annotations = this.config.annotations ?? [];

    for (const ann of annotations) {
      if (ann.type !== 'region') continue;
      const fromIdx = this.resolveTimeIndex(ann.from);
      const toIdx = this.resolveTimeIndex(ann.to);
      if (fromIdx < 0 || toIdx < 0) continue;

      const x1 = this.indexToX(fromIdx) - this.candleSlotWidth / 2;
      const x2 = this.indexToX(toIdx) + this.candleSlotWidth / 2;

      ctx.fillStyle = ann.color || 'rgba(100,100,255,0.08)';
      ctx.fillRect(x1, this.chartTop, x2 - x1, this.chartBottom - this.chartTop);

      if (ann.label) {
        ctx.save();
        ctx.font = '10px system-ui, sans-serif';
        ctx.fillStyle = ann.color || 'rgba(100,100,255,0.5)';
        ctx.globalAlpha = 0.7;
        ctx.textAlign = 'center';
        ctx.fillText(ann.label, (x1 + x2) / 2, this.chartTop + 14);
        ctx.restore();
      }
    }
  }

  private drawAnnotationOverlays(): void {
    const { ctx } = this;
    const annotations = this.config.annotations ?? [];

    for (const ann of annotations) {
      switch (ann.type) {
        case 'hline': {
          const y = this.priceToY(ann.price);
          ctx.save();
          ctx.strokeStyle = ann.color || '#888';
          ctx.lineWidth = 1;
          if (ann.style === 'dashed') ctx.setLineDash([6, 4]);
          else if (ann.style === 'dotted') ctx.setLineDash([2, 3]);
          ctx.beginPath();
          ctx.moveTo(this.chartLeft, y);
          ctx.lineTo(this.chartRight, y);
          ctx.stroke();

          if (ann.label) {
            ctx.font = '10px system-ui, sans-serif';
            ctx.fillStyle = ann.color || '#888';
            ctx.textAlign = 'right';
            ctx.fillText(ann.label, this.chartRight - 4, y - 4);
          }
          ctx.restore();
          break;
        }

        case 'label': {
          const idx = this.resolveTimeIndex(ann.time);
          if (idx < 0) break;
          const x = this.indexToX(idx);
          const y = this.priceToY(ann.price);
          const offset = ann.position === 'below' ? 14 : -8;

          ctx.save();
          ctx.font = '10px system-ui, sans-serif';
          ctx.fillStyle = ann.color || '#e5e7eb';
          ctx.textAlign = 'center';
          ctx.fillText(ann.text, x, y + offset);
          ctx.restore();
          break;
        }

        case 'trendline': {
          const fromIdx = this.resolveTimeIndex(ann.from.time);
          const toIdx = this.resolveTimeIndex(ann.to.time);
          if (fromIdx < 0 || toIdx < 0) break;

          ctx.save();
          ctx.strokeStyle = ann.color || '#fbbf24';
          ctx.lineWidth = 1.5;
          if (ann.style === 'dashed') ctx.setLineDash([6, 4]);
          ctx.beginPath();
          ctx.moveTo(this.indexToX(fromIdx), this.priceToY(ann.from.price));
          ctx.lineTo(this.indexToX(toIdx), this.priceToY(ann.to.price));
          ctx.stroke();
          ctx.restore();
          break;
        }

        case 'arrow': {
          const idx = this.resolveTimeIndex(ann.time);
          if (idx < 0) break;
          const x = this.indexToX(idx);
          const y = this.priceToY(ann.price);
          const isUp = ann.direction === 'up';

          ctx.save();
          ctx.fillStyle = ann.color || (isUp ? '#22c55e' : '#ef4444');

          // Arrow triangle
          const size = 8;
          ctx.beginPath();
          if (isUp) {
            ctx.moveTo(x, y - size);
            ctx.lineTo(x - size * 0.6, y + size * 0.4);
            ctx.lineTo(x + size * 0.6, y + size * 0.4);
          } else {
            ctx.moveTo(x, y + size);
            ctx.lineTo(x - size * 0.6, y - size * 0.4);
            ctx.lineTo(x + size * 0.6, y - size * 0.4);
          }
          ctx.closePath();
          ctx.fill();

          if (ann.label) {
            ctx.font = '10px system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(ann.label, x, y + (isUp ? -size - 4 : size + 12));
          }
          ctx.restore();
          break;
        }
      }
    }
  }

  private drawAxes(): void {
    const { ctx } = this;
    const candles = this.visibleCandles;
    if (candles.length === 0) return;

    ctx.font = '10px system-ui, sans-serif';
    ctx.fillStyle = this.colors.axisText;

    // Price axis (right)
    const priceRange = this.priceMax - this.priceMin;
    const niceStep = this.niceStep(priceRange, 6);
    const startPrice = Math.ceil(this.priceMin / niceStep) * niceStep;

    ctx.textAlign = 'left';
    for (let p = startPrice; p <= this.priceMax; p += niceStep) {
      const y = this.priceToY(p);
      ctx.fillText(this.formatPrice(p), this.chartRight + 6, y + 3);
    }

    // Time axis (bottom)
    const timeStep = Math.max(1, Math.floor(candles.length / 8));
    ctx.textAlign = 'center';
    for (let i = 0; i < candles.length; i += timeStep) {
      const x = this.indexToX(i);
      const label = candles[i].time;
      // Truncate long labels
      const shortLabel = label.length > 8 ? label.slice(-8) : label;
      ctx.fillText(shortLabel, x, this.logicalHeight - PADDING.bottom + 16);
    }
  }

  private drawCrosshair(): void {
    if (this._mouseX < 0 || this._hoveredIndex < 0) return;
    const { ctx } = this;
    const candles = this.visibleCandles;
    if (this._hoveredIndex >= candles.length) return;

    const candle = candles[this._hoveredIndex];
    const x = this.indexToX(this._hoveredIndex);

    // Vertical line
    ctx.save();
    ctx.strokeStyle = this.colors.crosshair;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(x, this.chartTop);
    ctx.lineTo(x, this.chartBottom);
    ctx.stroke();

    // Horizontal line
    ctx.beginPath();
    ctx.moveTo(this.chartLeft, this._mouseY);
    ctx.lineTo(this.chartRight, this._mouseY);
    ctx.stroke();
    ctx.restore();

    // Tooltip
    const isUp = candle.close >= candle.open;
    const lines = [
      candle.time,
      `O: ${this.formatPrice(candle.open)}`,
      `H: ${this.formatPrice(candle.high)}`,
      `L: ${this.formatPrice(candle.low)}`,
      `C: ${this.formatPrice(candle.close)}`,
    ];
    if (candle.volume != null) {
      lines.push(`V: ${this.formatVolume(candle.volume)}`);
    }

    const lineHeight = 15;
    const tooltipW = 110;
    const tooltipH = lines.length * lineHeight + 12;
    let tooltipX = x + 14;
    let tooltipY = this._mouseY - tooltipH / 2;

    // Keep tooltip in bounds
    if (tooltipX + tooltipW > this.chartRight) tooltipX = x - tooltipW - 14;
    if (tooltipY < this.chartTop) tooltipY = this.chartTop;
    if (tooltipY + tooltipH > this.chartBottom) tooltipY = this.chartBottom - tooltipH;

    ctx.save();
    ctx.fillStyle = this.colors.tooltipBg;
    ctx.strokeStyle = this.colors.tooltipBorder;
    ctx.lineWidth = 1;
    this.roundRect(tooltipX, tooltipY, tooltipW, tooltipH, 6);
    ctx.fill();
    ctx.stroke();

    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'left';
    for (let i = 0; i < lines.length; i++) {
      ctx.fillStyle = i === 0
        ? this.colors.axisText
        : isUp
          ? this.colors.candleUp
          : this.colors.candleDown;
      ctx.fillText(lines[i], tooltipX + 8, tooltipY + 14 + i * lineHeight);
    }
    ctx.restore();
  }

  // ── Helpers ────────────────────────────────────────────────────────

  private roundRect(
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
  ): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  private niceStep(range: number, targetLines: number): number {
    if (range <= 0) return 1;
    const rough = range / targetLines;
    const pow = Math.pow(10, Math.floor(Math.log10(rough)));
    const frac = rough / pow;
    let nice: number;
    if (frac <= 1.5) nice = 1;
    else if (frac <= 3) nice = 2;
    else if (frac <= 7) nice = 5;
    else nice = 10;
    return nice * pow;
  }

  private formatPrice(price: number): string {
    if (price >= 10000) return price.toFixed(0);
    if (price >= 100) return price.toFixed(1);
    if (price >= 1) return price.toFixed(2);
    return price.toFixed(4);
  }

  private formatVolume(vol: number): string {
    if (vol >= 1e9) return (vol / 1e9).toFixed(1) + 'B';
    if (vol >= 1e6) return (vol / 1e6).toFixed(1) + 'M';
    if (vol >= 1e3) return (vol / 1e3).toFixed(1) + 'K';
    return vol.toFixed(0);
  }
}
