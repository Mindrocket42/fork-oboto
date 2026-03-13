#!/usr/bin/env node
/**
 * Install npm dependencies for skills that have a package.json.
 * Skips skills that already have a node_modules directory.
 *
 * Usage: node scripts/install-skills.mjs [--force]
 */

import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';

const SKILLS_DIR = './skills';
const force = process.argv.includes('--force');

try {
    const entries = await fs.readdir(SKILLS_DIR, { withFileTypes: true });

    for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const skillDir = path.join(SKILLS_DIR, entry.name);

        // Check if this skill has a package.json
        try {
            await fs.access(path.join(skillDir, 'package.json'));
        } catch {
            continue; // No package.json, nothing to install
        }

        // Skip if node_modules already exists (unless --force)
        if (!force) {
            try {
                await fs.access(path.join(skillDir, 'node_modules'));
                console.log('  skip (has node_modules):', entry.name);
                continue;
            } catch {
                // node_modules doesn't exist, proceed with install
            }
        }

        console.log('  installing:', entry.name);
        execSync('pnpm install --prod', { cwd: skillDir, stdio: 'inherit' });
    }
} catch (err) {
    console.error('install:skills error:', err.message);
}
