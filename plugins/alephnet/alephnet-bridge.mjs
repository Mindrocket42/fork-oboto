/**
 * AlephNet Bridge — CJS/ESM interop layer for the alephnet-node skill.
 *
 * The skill is a CommonJS module (`require`-based).  Plugins are ESM.
 * This bridge uses `createRequire()` to load the skill and exposes an
 * async action-dispatch interface that the plugin can call directly.
 *
 * All state (skill module, connection status) is encapsulated here so
 * the plugin index can remain a thin orchestrator.
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let _skill = null;
let _connected = false;

/**
 * Lazily load the CJS skill module.
 * @returns {object} The alephnet-node skill export
 */
export function getSkill() {
    if (_skill) return _skill;

    const require = createRequire(import.meta.url);
    const skillPath = path.resolve(__dirname, '../../skills/alephnet-node/index.js');

    try {
        _skill = require(skillPath);
    } catch (err) {
        throw new Error(`Failed to load alephnet-node skill: ${err.message}`);
    }

    return _skill;
}

/**
 * Call an AlephNet action by name.
 *
 * Action names support dot-notation (e.g. "friends.list", "chat.rooms.create").
 * The bridge resolves the action from the skill's merged `actions` map.
 *
 * @param {string} actionName — dot-notation action name
 * @param {object} args — arguments to pass to the action
 * @returns {Promise<any>} — action result
 */
export async function callAction(actionName, args = {}) {
    const skill = getSkill();
    const action = skill.actions[actionName];

    if (typeof action !== 'function') {
        throw new Error(
            `Unknown AlephNet action: "${actionName}". ` +
            `Available: ${Object.keys(skill.actions).join(', ')}`
        );
    }

    return await action(args);
}

/**
 * Check if the skill module loaded successfully.
 * @returns {boolean}
 */
export function isAvailable() {
    try {
        getSkill();
        return true;
    } catch {
        return false;
    }
}

/**
 * Get/set the connection status.
 */
export function isConnected() {
    return _connected;
}

export function setConnected(status) {
    _connected = !!status;
}

/**
 * Get the list of all available action names.
 * @returns {string[]}
 */
export function listActions() {
    try {
        const skill = getSkill();
        return Object.keys(skill.actions);
    } catch {
        return [];
    }
}
