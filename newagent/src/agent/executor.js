// ==========================================
// CLI EXECUTOR
// ==========================================

import { PipelineEngine } from './pipeline.js';
import { VFSSyncAdapter } from './vfs.js';
import { selfList, selfRead, selfWrite, selfRestart } from './self-awareness.js';

export const executeCommand = async (commandStr, vfs, voluntaryMem, involMem) => {
    if (!commandStr || typeof commandStr !== 'string') return { error: "Invalid command format" };

    const args = commandStr.trim().split(/\s+/);
    const cmd = args[0];
    let arg1 = args[1], arg2 = commandStr.substring(cmd.length + 1 + (arg1 ? arg1.length : 0)).trim();
    
    if (['eval', 'finish', 'mem_store', 'mem_search', 'mutate', 'spawn', 'wait', 'self_restart'].includes(cmd)) {
        arg1 = commandStr.substring(cmd.length).trim();
    } else if (cmd === 'self_write') {
        // self_write <path> <content> — arg1 is path, arg2 is content (rest of string)
        if (arg1) arg1 = arg1.replace(/^["']|["']$/g, '');
    } else {
        if (arg1) arg1 = arg1.replace(/^["']|["']$/g, '');
        if (arg2 && cmd === 'write' && arg2.startsWith('"') && arg2.endsWith('"')) arg2 = arg2.slice(1, -1);
    }

    try {
        switch (cmd) {
            case 'ls': return vfs.ls(arg1);
            case 'read': return arg1 ? vfs.read(arg1) : { error: "Missing file path" };
            case 'write': return (arg1 && arg2) ? vfs.write(arg1, arg2) : { error: "Missing arguments" };
            case 'mkdir': return arg1 ? vfs.mkdir(arg1) : { error: "Missing directory path" };
            case 'eval':
                const res = (0, eval)(arg1); 
                return { result: typeof res === 'object' ? JSON.stringify(res) : String(res) };
            case 'spawn':
                // Background Process Implementation
                const spawnArgs = arg1.split(/\s+/);
                const jobId = spawnArgs[0];
                const code = arg1.substring(jobId.length).trim();
                
                setTimeout(() => {
                    try {
                        const out = (0, eval)(code);
                        vfs.write(`/home/user/jobs/${jobId}.out`, String(out));
                        involMem.add(`Background Job '${jobId}' completed successfully.`);
                    } catch(e) {
                        vfs.write(`/home/user/jobs/${jobId}.err`, e.message);
                        involMem.add(`Background Job '${jobId}' failed: ${e.message}`);
                    }
                }, 100);
                return { result: `Job '${jobId}' spawned in background.` };
            case 'wait':
                if (!arg1) return { error: "Missing file path" };
                const waitPath = vfs.resolvePath(arg1);
                let waited = 0;
                while (!vfs.fs[waitPath] && waited < 5000) {
                    await new Promise(r => setTimeout(r, 100));
                    waited += 100;
                }
                if (vfs.fs[waitPath]) return { result: `File '${arg1}' is now available.` };
                return { error: `Timeout: File '${arg1}' did not appear after 5 seconds.` };
            case 'mem_store':
                const id = await voluntaryMem.add(arg1);
                return { result: `Memory stored (ID: ${id}).` };
            case 'mem_search':
                const results = await voluntaryMem.associate(arg1, 5);
                return results.length === 0 ? { result: "No relevant memories found." } : { result: results.map(r => `[Score: ${r.score.toFixed(2)}] ${r.text}`).join('\n') };
            case 'mutate':
                const payload = JSON.parse(arg1);
                const engine = new PipelineEngine(new VFSSyncAdapter(vfs));
                const mutRes = await engine.execute(payload);
                return { result: JSON.stringify(mutRes, null, 2) };
            case 'self_list':
                return selfList();
            case 'self_read':
                return arg1 ? selfRead(arg1) : { error: "Missing file path. Usage: self_read <relative_path>" };
            case 'self_write':
                return (arg1 && arg2) ? selfWrite(arg1, arg2) : { error: "Missing arguments. Usage: self_write <relative_path> <content>" };
            case 'self_restart':
                return selfRestart(arg1 || 'Self-modification applied');
            case 'finish': return { result: arg1 || "Task completed.", isFinished: true };
            default: return { error: `Unknown command: ${cmd}` };
        }
    } catch (err) {
        return { error: `System exception: ${err.message}` };
    }
};
