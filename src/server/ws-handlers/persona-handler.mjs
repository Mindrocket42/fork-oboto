import { consoleStyler } from '../../ui/console-styler.mjs';
import { wsSend, wsSendError } from '../../lib/ws-utils.mjs';
import { randomUUID } from 'node:crypto';

/**
 * Handles: list-personas, switch-persona, create-persona
 *
 * The persona manager lives on ctx.assistant.personaManager.
 * After switching a persona, we also refresh the system prompt so the
 * AI immediately adopts the new persona.
 */

async function handleListPersonas(data, ctx) {
    const { ws, assistant } = ctx;
    try {
        const pm = assistant.personaManager;
        if (!pm) {
            wsSend(ws, 'persona-list', { personas: [], activePersonaId: null });
            return;
        }
        await pm.initialize();
        const personas = pm.listPersonas();
        wsSend(ws, 'persona-list', { personas, activePersonaId: pm.activePersonaId });
    } catch (err) {
        consoleStyler.log('error', `Failed to list personas: ${err.message}`);
        wsSendError(ws, `Failed to list personas: ${err.message}`);
    }
}

async function handleSwitchPersona(data, ctx) {
    const { ws, assistant, broadcast } = ctx;
    try {
        const pm = assistant.personaManager;
        if (!pm) {
            wsSendError(ws, 'Persona manager not available');
            return;
        }
        const payload = data.payload || {};
        const { personaId } = payload;
        if (!personaId) {
            wsSendError(ws, 'personaId is required');
            return;
        }
        const result = pm.switchPersona(personaId);
        if (result.success) {
            // Refresh system prompt so AI picks up the new persona immediately
            if (typeof assistant.updateSystemPrompt === 'function') {
                await assistant.updateSystemPrompt();
            }
            const personas = pm.listPersonas();
            broadcast('persona-list', { personas, activePersonaId: pm.activePersonaId });
            wsSend(ws, 'persona-switched', { personaId, name: result.persona?.name });
        } else {
            wsSendError(ws, result.error || `Failed to switch persona`);
        }
    } catch (err) {
        consoleStyler.log('error', `Failed to switch persona: ${err.message}`);
        wsSendError(ws, `Failed to switch persona: ${err.message}`);
    }
}

async function handleCreatePersona(data, ctx) {
    const { ws, assistant, broadcast } = ctx;
    try {
        const pm = assistant.personaManager;
        if (!pm) {
            wsSendError(ws, 'Persona manager not available');
            return;
        }
        const payload = data.payload || {};
        const { name, prompt } = payload;
        if (!name || typeof name !== 'string') {
            wsSendError(ws, 'Persona name is required');
            return;
        }
        // Generate a slug from the name for readability, with a UUID suffix for uniqueness
        const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        if (!slug) {
            wsSendError(ws, 'Invalid persona name');
            return;
        }
        const id = `${slug}-${randomUUID().slice(0, 8)}`;

        const personaConfig = {
            id,
            name: name.trim(),
            description: prompt ? prompt.substring(0, 120) : '',
            identity: {
                coreDirective: prompt || '',
            },
        };

        const result = await pm.createPersona(personaConfig);
        if (result.success) {
            // Auto-switch to the new persona
            pm.switchPersona(id);
            if (typeof assistant.updateSystemPrompt === 'function') {
                await assistant.updateSystemPrompt();
            }
            const personas = pm.listPersonas();
            broadcast('persona-list', { personas, activePersonaId: pm.activePersonaId });
            wsSend(ws, 'persona-created', { persona: result.persona });
        } else {
            wsSendError(ws, result.error || 'Failed to create persona');
        }
    } catch (err) {
        consoleStyler.log('error', `Failed to create persona: ${err.message}`);
        wsSendError(ws, `Failed to create persona: ${err.message}`);
    }
}

export const handlers = {
    'list-personas': handleListPersonas,
    'switch-persona': handleSwitchPersona,
    'create-persona': handleCreatePersona,
};
