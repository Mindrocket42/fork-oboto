/**
 * EventBusTransport — bridges lmscript Logger to ai-man eventBus.
 *
 * Implements the lmscript LogTransport interface ({ write(entry) })
 * and forwards structured log entries to the ai-man eventBus so the
 * UI receives real-time telemetry.
 */

const LOG_LEVELS = /** @type {const} */ (['debug', 'info', 'warn', 'error']);
const LEVEL_INDEX = /** @type {Record<string, number>} */ (
  Object.fromEntries(LOG_LEVELS.map((l, i) => [l, i]))
);

/**
 * Map a log level string to the status event `type` expected by the UI.
 * @param {'debug'|'info'|'warn'|'error'} level
 * @returns {'debug'|'info'|'warning'|'error'}
 */
function mapLevelToStatusType(level) {
  if (level === 'warn') return 'warning';
  return level; // debug, info, error map 1-to-1
}

export class EventBusTransport {
  /**
   * @param {import('events').EventEmitter} eventBus  ai-man eventBus instance
   * @param {object}  [options]
   * @param {string}  [options.prefix='lmscript']   event-name prefix
   * @param {'debug'|'info'|'warn'|'error'} [options.minLevel='info'] minimum level to forward
   * @param {boolean} [options.emitStatus=true]      also emit as 'status' events
   */
  constructor(eventBus, options = {}) {
    this._eventBus = eventBus;
    this._prefix = options.prefix ?? 'lmscript';
    this._minLevel = options.minLevel ?? 'info';
    this._emitStatus = options.emitStatus ?? true;
    this._minLevelIndex = LEVEL_INDEX[this._minLevel] ?? LEVEL_INDEX.info;
  }

  /**
   * Called by lmscript's Logger for every log entry.
   * @param {{ level: string, message: string, timestamp: Date, context?: Record<string,any>, spanId?: string, parentSpanId?: string }} entry
   */
  write(entry) {
    const entryLevelIndex = LEVEL_INDEX[entry.level] ?? -1;
    if (entryLevelIndex < this._minLevelIndex) return;

    // 1. Namespaced level event
    this._eventBus.emit(`${this._prefix}:${entry.level}`, entry);

    // 2. Span event (when tracing context is present)
    if (entry.spanId) {
      this._eventBus.emit(`${this._prefix}:span`, {
        spanId: entry.spanId,
        parentSpanId: entry.parentSpanId,
        level: entry.level,
        message: entry.message,
      });
    }

    // 3. UI-visible status event
    if (this._emitStatus) {
      this._eventBus.emit('status', {
        type: mapLevelToStatusType(entry.level),
        message: entry.message,
        data: {
          source: 'lmscript',
          spanId: entry.spanId,
          ...entry.context,
        },
      });
    }
  }
}

/**
 * Factory helper — creates an EventBusTransport instance.
 * @param {import('events').EventEmitter} eventBus
 * @param {object} [options]
 * @returns {EventBusTransport}
 */
export function createEventBusTransport(eventBus, options = {}) {
  return new EventBusTransport(eventBus, options);
}
