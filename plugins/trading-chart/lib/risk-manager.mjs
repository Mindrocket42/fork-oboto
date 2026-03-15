/**
 * Risk Manager — Position sizing, SL/TP, and safety limits.
 *
 * Enforces hard limits on position size, leverage, concurrent positions,
 * and daily loss regardless of what the LLM requests. These are safety
 * rails that cannot be overridden by the AI.
 *
 * @module @oboto/plugin-trading-chart/lib/risk-manager
 */

/**
 * @typedef {Object} RiskSettings
 * @property {number} maxPositionSizeUsdt - Maximum position size per trade
 * @property {number} maxLeverage - Maximum leverage multiplier
 * @property {number} maxConcurrentPositions - Max open positions simultaneously
 * @property {number} defaultStopLossPct - Default stop-loss % from entry
 * @property {number} defaultTakeProfitPct - Default take-profit % from entry
 * @property {number} maxDailyLossUsdt - Maximum daily loss before halting
 * @property {number} minConfidenceThreshold - Min prediction confidence to trade
 * @property {string} minSignalIntensity - Min signal intensity: WEAK|MODERATE|STRONG
 */

/**
 * @typedef {Object} Position
 * @property {string} symbol
 * @property {string} direction - LONG | SHORT
 * @property {number} entryPrice
 * @property {number} sizeUsdt
 * @property {number} leverage
 * @property {number} stopLoss
 * @property {number} takeProfit
 * @property {string} openedAt - ISO timestamp
 * @property {string} [closedAt]
 * @property {number} [closePrice]
 * @property {number} [pnlUsdt]
 */

export class RiskManager {
    /**
     * @param {RiskSettings} settings
     */
    constructor(settings) {
        this.settings = { ...settings };
        /** @type {Position[]} */
        this.openPositions = [];
        /** @type {{ pnl: number, timestamp: string }[]} */
        this.dailyTrades = [];
        this._dailyPnl = 0;
        this._lastResetDate = this._todayString();
    }

    /**
     * Update settings (called when plugin settings change).
     * @param {RiskSettings} newSettings
     */
    updateSettings(newSettings) {
        this.settings = { ...this.settings, ...newSettings };
    }

    // ── Validation ───────────────────────────────────────────────────────

    /**
     * Validate a proposed trade against all risk rules.
     * Returns { allowed, reason } — if not allowed, reason explains why.
     *
     * @param {Object} trade
     * @param {string} trade.symbol
     * @param {string} trade.direction - LONG | SHORT
     * @param {number} trade.sizeUsdt
     * @param {number} trade.leverage
     * @param {number} [trade.confidence] - Prediction confidence 0-1
     * @param {string} [trade.intensity] - Signal intensity
     * @returns {{ allowed: boolean, reason: string, adjustedSize?: number, adjustedLeverage?: number }}
     */
    validateTrade(trade) {
        this._checkDailyReset();

        const reasons = [];

        // 1. Check daily loss limit
        if (this._dailyPnl <= -this.settings.maxDailyLossUsdt) {
            return {
                allowed: false,
                reason: `Daily loss limit reached: $${Math.abs(this._dailyPnl).toFixed(2)} lost (max: $${this.settings.maxDailyLossUsdt})`,
            };
        }

        // 2. Check concurrent positions
        if (this.openPositions.length >= this.settings.maxConcurrentPositions) {
            return {
                allowed: false,
                reason: `Max concurrent positions reached: ${this.openPositions.length}/${this.settings.maxConcurrentPositions}`,
            };
        }

        // 3. Check if already in a position for this symbol
        const existingPos = this.openPositions.find(p => p.symbol === trade.symbol);
        if (existingPos) {
            return {
                allowed: false,
                reason: `Already have an open ${existingPos.direction} position on ${trade.symbol}`,
            };
        }

        // 4. Check confidence threshold
        if (trade.confidence !== undefined && trade.confidence < this.settings.minConfidenceThreshold) {
            return {
                allowed: false,
                reason: `Signal confidence ${trade.confidence.toFixed(3)} below threshold ${this.settings.minConfidenceThreshold}`,
            };
        }

        // 5. Check intensity threshold
        if (trade.intensity) {
            const intensityRank = { WEAK: 0, MODERATE: 1, STRONG: 2 };
            const minRank = intensityRank[this.settings.minSignalIntensity] ?? 1;
            const tradeRank = intensityRank[trade.intensity] ?? 0;
            if (tradeRank < minRank) {
                return {
                    allowed: false,
                    reason: `Signal intensity ${trade.intensity} below minimum ${this.settings.minSignalIntensity}`,
                };
            }
        }

        // 6. Clamp position size and leverage
        const adjustedSize = Math.min(trade.sizeUsdt, this.settings.maxPositionSizeUsdt);
        const adjustedLeverage = Math.min(trade.leverage, this.settings.maxLeverage);

        if (adjustedSize !== trade.sizeUsdt) {
            reasons.push(`Size clamped: $${trade.sizeUsdt} → $${adjustedSize}`);
        }
        if (adjustedLeverage !== trade.leverage) {
            reasons.push(`Leverage clamped: ${trade.leverage}x → ${adjustedLeverage}x`);
        }

        // 7. Check if remaining daily budget allows this trade
        const remainingBudget = this.settings.maxDailyLossUsdt + this._dailyPnl;
        if (adjustedSize > remainingBudget * 2) {
            // Position size is more than 2x remaining daily budget — too risky
            return {
                allowed: false,
                reason: `Position size $${adjustedSize} too large for remaining daily budget $${remainingBudget.toFixed(2)}`,
            };
        }

        return {
            allowed: true,
            reason: reasons.length > 0 ? reasons.join('; ') : 'Trade approved',
            adjustedSize,
            adjustedLeverage,
        };
    }

    // ── SL/TP Calculation ────────────────────────────────────────────────

    /**
     * Calculate stop-loss price.
     * @param {number} entryPrice
     * @param {string} direction - LONG | SHORT
     * @param {number} [slPct] - Override default SL percentage
     * @returns {number}
     */
    calculateStopLoss(entryPrice, direction, slPct) {
        const pct = (slPct || this.settings.defaultStopLossPct) / 100;
        return direction === 'LONG'
            ? entryPrice * (1 - pct)
            : entryPrice * (1 + pct);
    }

    /**
     * Calculate take-profit price.
     * @param {number} entryPrice
     * @param {string} direction - LONG | SHORT
     * @param {number} [tpPct] - Override default TP percentage
     * @returns {number}
     */
    calculateTakeProfit(entryPrice, direction, tpPct) {
        const pct = (tpPct || this.settings.defaultTakeProfitPct) / 100;
        return direction === 'LONG'
            ? entryPrice * (1 + pct)
            : entryPrice * (1 - pct);
    }

    /**
     * Calculate position's PnL.
     * @param {Position} position
     * @param {number} currentPrice
     * @returns {{ pnlUsdt: number, pnlPct: number }}
     */
    calculatePnL(position, currentPrice) {
        const direction = position.direction === 'LONG' ? 1 : -1;
        const priceDelta = (currentPrice - position.entryPrice) * direction;
        const pnlPct = (priceDelta / position.entryPrice) * 100 * position.leverage;
        const pnlUsdt = (pnlPct / 100) * position.sizeUsdt;
        return {
            pnlUsdt: Math.round(pnlUsdt * 100) / 100,
            pnlPct: Math.round(pnlPct * 100) / 100,
        };
    }

    /**
     * Check if a position should be closed (hit SL or TP).
     * @param {Position} position
     * @param {number} currentPrice
     * @returns {{ shouldClose: boolean, reason: string }}
     */
    checkStopConditions(position, currentPrice) {
        if (position.direction === 'LONG') {
            if (currentPrice <= position.stopLoss) {
                return { shouldClose: true, reason: 'Stop-loss hit' };
            }
            if (currentPrice >= position.takeProfit) {
                return { shouldClose: true, reason: 'Take-profit hit' };
            }
        } else {
            if (currentPrice >= position.stopLoss) {
                return { shouldClose: true, reason: 'Stop-loss hit' };
            }
            if (currentPrice <= position.takeProfit) {
                return { shouldClose: true, reason: 'Take-profit hit' };
            }
        }
        return { shouldClose: false, reason: '' };
    }

    // ── Position tracking ────────────────────────────────────────────────

    /**
     * Record a new open position.
     * @param {Position} position
     */
    addPosition(position) {
        this.openPositions.push(position);
    }

    /**
     * Close a position and record PnL.
     * @param {string} symbol
     * @param {number} closePrice
     * @returns {Position | null} The closed position, or null if not found
     */
    closePosition(symbol, closePrice) {
        const idx = this.openPositions.findIndex(p => p.symbol === symbol);
        if (idx === -1) return null;

        const position = this.openPositions.splice(idx, 1)[0];
        const { pnlUsdt, pnlPct } = this.calculatePnL(position, closePrice);

        position.closedAt = new Date().toISOString();
        position.closePrice = closePrice;
        position.pnlUsdt = pnlUsdt;
        position.pnlPct = pnlPct;

        // Update daily PnL
        this._dailyPnl += pnlUsdt;
        this.dailyTrades.push({
            pnl: pnlUsdt,
            timestamp: position.closedAt,
        });

        return position;
    }

    /**
     * Get current open positions.
     * @returns {Position[]}
     */
    getOpenPositions() {
        return [...this.openPositions];
    }

    /**
     * Get number of available position slots.
     * @returns {number}
     */
    availableSlots() {
        return Math.max(0, this.settings.maxConcurrentPositions - this.openPositions.length);
    }

    // ── Performance metrics ──────────────────────────────────────────────

    /**
     * Get daily trading summary.
     * @returns {Object}
     */
    getDailySummary() {
        this._checkDailyReset();
        const trades = this.dailyTrades;
        const wins = trades.filter(t => t.pnl > 0);
        const losses = trades.filter(t => t.pnl <= 0);

        return {
            date: this._todayString(),
            total_trades: trades.length,
            wins: wins.length,
            losses: losses.length,
            win_rate: trades.length > 0 ? (wins.length / trades.length) * 100 : 0,
            total_pnl: Math.round(this._dailyPnl * 100) / 100,
            best_trade: trades.length > 0 ? Math.max(...trades.map(t => t.pnl)) : 0,
            worst_trade: trades.length > 0 ? Math.min(...trades.map(t => t.pnl)) : 0,
            remaining_budget: Math.round((this.settings.maxDailyLossUsdt + this._dailyPnl) * 100) / 100,
            open_positions: this.openPositions.length,
            available_slots: this.availableSlots(),
        };
    }

    /**
     * Check if trading should be halted.
     * @returns {{ halted: boolean, reason: string }}
     */
    checkHaltConditions() {
        this._checkDailyReset();

        if (this._dailyPnl <= -this.settings.maxDailyLossUsdt) {
            return {
                halted: true,
                reason: `Daily loss limit of $${this.settings.maxDailyLossUsdt} reached. Total PnL today: $${this._dailyPnl.toFixed(2)}`,
            };
        }

        return { halted: false, reason: '' };
    }

    // ── Internal helpers ─────────────────────────────────────────────────

    /**
     * Reset daily tracking if the date has changed.
     */
    _checkDailyReset() {
        const today = this._todayString();
        if (today !== this._lastResetDate) {
            this.dailyTrades = [];
            this._dailyPnl = 0;
            this._lastResetDate = today;
        }
    }

    /**
     * Get today's date as YYYY-MM-DD string.
     * @returns {string}
     */
    _todayString() {
        return new Date().toISOString().split('T')[0];
    }
}
