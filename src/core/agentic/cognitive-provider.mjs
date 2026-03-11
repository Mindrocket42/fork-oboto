/**
 * CognitiveProvider — alternate agentic provider that uses the tinyaleph
 * cognitive agent loop with prime-resonant cognitive middleware.
 *
 * Implements the 11-step cognitive loop:
 *  PERCEIVE → ENCODE → ORIENT → ATTEND → GUARD → RECALL →
 *  THINK → EXECUTE → VALIDATE → REMEMBER → EVOLVE
 *
 * Uses ai-man's AI provider for LLM calls and ToolExecutor for tools,
 * so it benefits from all configured backends (Gemini, OpenAI, LMStudio, etc.)
 * and the full ai-man tool ecosystem.
 *
 * When lmscript is available, creates a full LScriptRuntime with:
 *  - AiManLLMProvider (bridges ai-man's callProvider to lmscript's LLMProvider)
 *  - ToolBridge (converts ToolExecutor tools to lmscript ToolDefinition format)
 *  - CognitiveMiddleware (bridges CognitiveCore into lmscript middleware hooks)
 *  - EventBusTransport (bridges lmscript Logger to ai-man eventBus)
 *
 * @module src/core/agentic/cognitive-provider
 */

import { AgenticProvider } from './base-provider.mjs';
import { CognitiveAgent } from './cognitive/agent.mjs';
import { consoleStyler } from '../../ui/console-styler.mjs';
import { emitStatus } from '../status-reporter.mjs';
import { classifyInput, generatePlan, executePlan, synthesizeResponse } from './cognitive/task-planner.mjs';
import { wsSend, wsSendUpdate } from '../../lib/ws-utils.mjs';

// lmscript runtime components are loaded dynamically in initialize()
// to avoid crashing the process if @sschepis/lmscript is not installed.

export class CognitiveProvider extends AgenticProvider {
    get id() { return 'cognitive'; }
    get name() { return 'Cognitive Agent (TinyAleph)'; }
    get description() {
        return '11-step cognitive loop with prime-resonant middleware, holographic memory, semantic field tracking, and objectivity gating.';
    }

    async initialize(deps) {
        await super.initialize(deps);

        // Create the cognitive agent with ai-man's dependencies
        this._agent = new CognitiveAgent(
            {
                aiProvider: deps.aiProvider,
                toolExecutor: deps.toolExecutor,
                historyManager: deps.historyManager,
                workingDir: deps.workingDir
            },
            // Pass any cognitive-specific config overrides
            deps.cognitiveConfig || {}
        );

        // Initialize the cognitive state with a few physics ticks
        const initTicks = deps.cognitiveConfig?.initTicks ?? 10;
        for (let i = 0; i < initTicks; i++) {
            this._agent.cognitive.tick();
        }

        consoleStyler.log('agentic', `Initialized cognitive provider — coherence=${this._agent.cognitive.coherence.toFixed(3)}, entropy=${this._agent.cognitive.entropy.toFixed(3)}`);

        // --- lmscript runtime setup (dynamic import to avoid crash if package missing) ---
        try {
            const { LScriptRuntime, MiddlewareManager, Logger } = await import('@sschepis/lmscript');
            const { AiManLLMProvider } = await import('./cognitive/lmscript-provider.mjs');
            const { ToolBridge } = await import('./cognitive/tool-bridge.mjs');
            const { createCognitiveMiddleware } = await import('./cognitive/cognitive-middleware.mjs');
            const { createEventBusTransport } = await import('./cognitive/eventbus-transport.mjs');

            const lmConfig = this._agent.config.lmscript || {};

            // 1. Create LLM provider adapter
            const llmProvider = new AiManLLMProvider({
                model: this._agent.config.agent?.model,
                providerSettings: deps.providerSettings || {},
                circuitBreakerConfig: lmConfig.circuitBreaker
            });

            // 2. Create tool bridge
            const toolBridge = new ToolBridge(deps.toolExecutor, {
                workingDir: deps.workingDir,
                ws: deps.ws,
                facade: deps.facade
            });

            // 3. Create cognitive middleware (wraps tinyaleph CognitiveCore)
            // Disable guard/recall/memory/evolution features by default because
            // CognitiveAgent.turn() already handles these phases directly.
            // Enabling them here would cause double-processing of the cognitive
            // state (processInput, checkSafety, recall, remember, tick).
            const cognitiveMiddleware = createCognitiveMiddleware(
                this._agent.cognitive,  // CognitiveCore instance
                {
                    enableGuard: false,
                    enableRecall: false,
                    enableMemory: false,
                    enableEvolution: false,
                    ...(lmConfig.middleware || {})
                }
            );

            // 4. Create event bus transport
            const eventBusTransport = createEventBusTransport(
                deps.eventBus,
                lmConfig.logger || {}
            );

            // 5. Build MiddlewareManager and register cognitive hooks
            const middlewareManager = new MiddlewareManager();
            middlewareManager.use(cognitiveMiddleware.toHooks());

            // 6. Build Logger with event bus transport
            const logger = new Logger({
                transports: [eventBusTransport]
            });

            // 7. Create LScriptRuntime with full feature stack
            const runtime = new LScriptRuntime({
                provider: llmProvider,
                middleware: middlewareManager,
                logger
            });

            // 8. Wire into agent
            this._agent.initRuntime({
                runtime,
                toolBridge,
                cognitiveMiddleware,
                eventBusTransport
            });

            // Store references for dispose/diagnostics
            this._runtime = runtime;
            this._llmProvider = llmProvider;

            consoleStyler.log('agentic', 'lmscript runtime initialized successfully');
        } catch (err) {
            console.warn('[CognitiveProvider] lmscript runtime init failed, using legacy mode:', err.message);
            // Agent will fall back to _turnLegacy() automatically
        }
    }

    /**
     * Process input through the cognitive agent loop.
     *
     * @param {string} input
     * @param {Object} options
     * @returns {Promise<string>}
     */
    async run(input, options = {}) {
        if (!this._agent) {
            throw new Error('CognitiveProvider not initialized. Call initialize() first.');
        }

        const { aiProvider } = this._deps;
        const originalModel = aiProvider.model;
        if (options.model) {
            aiProvider.model = options.model;
        }

        emitStatus('Starting cognitive processing');

        // Use the facade's CURRENT historyManager (not the stale captured reference)
        // because loadConversation() replaces facade.historyManager after provider init.
        const facade = this._deps.facade;
        const getHistoryManager = () => facade ? facade.historyManager : this._deps.historyManager;

        try {
            // 1. Save user message to history IMMEDIATELY before processing
            const hm = getHistoryManager();
            if (hm) {
                hm.addMessage('user', input);
            }

            // ── 2. Task Decomposition: classify input and possibly plan ─────
            const plannerConfig = this._agent.config.planner || {};
            const ws = options?.ws || this._deps.ws;
            let responseText;
            let streamed = false;

            const useTaskPlanner = plannerConfig.enabled !== false
                && classifyInput(input, plannerConfig) === 'complex';

            if (useTaskPlanner) {
                consoleStyler.log('agentic', 'Task classified as complex — generating plan');
                responseText = await this._runWithPlan(input, options, ws, plannerConfig);
            } else {
                // Simple / planner-disabled path — direct turn
                const result = await this._agent.turn(input, { signal: options.signal });
                responseText = result.response;
                // Capture token usage from cognitive agent for the response message
                if (result.tokenUsage) {
                    this._lastTokenUsage = result.tokenUsage;
                }

                if (this._deps.eventBus) {
                    this._deps.eventBus.emitTyped('agentic:cognitive-metadata', result.diagnostics);
                }
            }

            // If streaming was requested, emit the full response as a single chunk
            if (options.stream && typeof options.onChunk === 'function') {
                options.onChunk(responseText);
                streamed = true;
            }

            // 3. Save assistant response to history IMMEDIATELY after receiving it
            emitStatus('Saving conversation history');
            const hmAfter = getHistoryManager();
            if (hmAfter) {
                hmAfter.addMessage('assistant', responseText);
            }

            return { response: responseText, streamed, tokenUsage: this._lastTokenUsage || null };
        } finally {
            // Ensure the tracker is stopped even if an error occurs
            if (this._agent?.stopTracking) {
                this._agent.stopTracking();
            }
            aiProvider.model = originalModel;
        }
    }

    /**
     * Execute a complex request via the task planner.
     *
     * 1. Generate a plan via LLM call
     * 2. Stream the plan to the UI
     * 3. Execute each step via agent.turn()
     * 4. Update the UI after each step
     * 5. Synthesize a final response
     *
     * Falls back to a direct turn() if plan generation fails.
     *
     * @param {string} input - Original user input
     * @param {Object} options - Turn options (signal, model, etc.)
     * @param {import('ws').WebSocket} ws - WebSocket for UI updates
     * @param {Object} plannerConfig - Planner configuration
     * @returns {Promise<string>} Final response text
     * @private
     */
    async _runWithPlan(input, options, ws, plannerConfig) {
        // Generate plan via a lightweight LLM call
        const callLLM = async (messages, tools, opts) => {
            return this._agent.callLLM(messages, tools, { ...options, ...opts });
        };

        const plan = await generatePlan(input, callLLM, {
            maxSteps: plannerConfig.maxSteps || 10,
            signal: options.signal,
        });

        // If plan generation failed, fall back to direct turn
        if (!plan) {
            consoleStyler.log('agentic', 'Plan generation failed — falling back to direct turn');
            const result = await this._agent.turn(input, { signal: options.signal });
            if (this._deps.eventBus) {
                this._deps.eventBus.emitTyped('agentic:cognitive-metadata', result.diagnostics);
            }
            return result.response;
        }

        // Send initial plan to UI as a task-plan message
        const planMessageId = plan.id;
        if (ws) {
            wsSend(ws, 'message', {
                id: planMessageId,
                role: 'ai',
                type: 'task-plan',
                title: plan.title,
                steps: plan.toUISteps(),
                planStatus: plan.status,
                timestamp: new Date().toLocaleString(),
                _pending: true,
            });
        }

        // Execute plan steps
        const { stepResults } = await executePlan(plan, {
            executeTurn: async (instruction, opts) => {
                return this._agent.turn(instruction, { ...options, ...opts });
            },
            onUpdate: (updatedPlan) => {
                // Stream step updates to the UI
                if (ws) {
                    wsSendUpdate(ws, planMessageId, {
                        steps: updatedPlan.toUISteps(),
                        planStatus: updatedPlan.status,
                    });
                }
            },
            signal: options.signal,
            skipDependentOnFailure: plannerConfig.skipDependentOnFailure !== false, // default true per config
        });

        // Synthesize final response
        const finalResponse = await synthesizeResponse(plan, stepResults, callLLM, {
            signal: options.signal,
        });

        // Finalize the plan message (remove _pending flag)
        if (ws) {
            wsSendUpdate(ws, planMessageId, {
                steps: plan.toUISteps(),
                planStatus: plan.status,
                _pending: false,
            });
        }

        return finalResponse;
    }

    /**
     * Get the underlying CognitiveAgent for diagnostics.
     * @returns {CognitiveAgent|null}
     */
    getAgent() {
        return this._agent || null;
    }

    /**
     * Get cognitive and runtime diagnostics.
     * @returns {Object}
     */
    getDiagnostics() {
        return {
            hasRuntime: !!this._runtime,
            circuitState: this._llmProvider?.getCircuitState?.() || 'unknown',
            agentStats: this._agent?.getStats?.() || {},
            cognitiveState: this._agent?.cognitive?.getDiagnostics?.() || {}
        };
    }

    async dispose() {
        if (this._agent) {
            this._agent.reset();
            this._agent = null;
        }
        this._runtime = null;
        this._llmProvider = null;
        await super.dispose();
    }
}
