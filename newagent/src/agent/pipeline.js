// ==========================================
// ADVANCED PIPELINE ENGINE (True AST Integration)
// ==========================================

import { getAstModules } from './loader.js';

export class PipelineExecutionError extends Error {
  constructor(report) {
    super(report.message);
    this.report = report;
  }
}

export class ASTManager {
    parse(content) {
        const { acorn, isAstLoaded } = getAstModules();
        if (!isAstLoaded) return { isMock: true, content };
        return acorn.parse(content, { ecmaVersion: 'latest', sourceType: 'module' });
    }
    
    renameSymbol(tree, config, sourceCode) {
        const { walk, astring } = getAstModules();

        if (tree.isMock) {
            // Fallback Regex
            const regex = new RegExp(`(function\\s+)${config.locator.name}(\\s*\\()`, 'g');
            if (!regex.test(sourceCode)) throw new Error(`Could not find function '${config.locator.name}'`);
            let updated = sourceCode.replace(regex, `$1${config.new_name}$2`);
            if (config.update_references) updated = updated.replace(new RegExp(`\\b${config.locator.name}\\b`, 'g'), config.new_name);
            return updated;
        }

        // True AST Traversal
        let found = false;
        walk.simple(tree, {
            Identifier(node) {
                if (node.name === config.locator.name) {
                    node.name = config.new_name;
                    found = true;
                }
            }
        });
        
        if (!found) throw new Error(`Could not find symbol '${config.locator.name}' in AST.`);
        return astring.generate(tree);
    }
}

export class UtilityAdapter {
    generateHash(content) {
        let hash = 0;
        for (let i = 0; i < content.length; i++) hash = ((hash << 5) - hash) + content.charCodeAt(i) & hash;
        return Math.abs(hash).toString(16) || "empty";
    }

    generateUnifiedDiff(orig, mod, file) {
        return orig === mod ? "No changes." : `--- a${file}\n+++ b${file}\n[Changes Applied - Length ${orig.length} -> ${mod.length}]`;
    }

    guessLanguage() { return "javascript"; }
}

export class PipelineEngine {
  constructor(vfsSyncAdapter) {
    this.fs = vfsSyncAdapter;
    this.astManager = new ASTManager();
    this.utils = new UtilityAdapter();
  }

  async execute(request) {
    const startTime = Date.now();
    let originalContent = await this.fs.readFile(request.target_file);
    const originalHash = this.utils.generateHash(originalContent);
    let currentContent = originalContent;
    const stepResults = [];

    for (let i = 0; i < request.pipeline.length; i++) {
      const step = request.pipeline[i];
      if (step.step === "ast_rename_symbol") {
          const tree = this.astManager.parse(currentContent);
          currentContent = this.astManager.renameSymbol(tree, step.config, currentContent);
          stepResults.push({ step_index: i, status: "success", message: `Renamed ${step.config.locator.name} to ${step.config.new_name}` });
      }
    }

    const finalHash = this.utils.generateHash(currentContent);
    let diff = request.execution_mode === "dry_run" || currentContent !== originalContent ? this.utils.generateUnifiedDiff(originalContent, currentContent, request.target_file) : undefined;
    if (request.execution_mode === "apply" && currentContent !== originalContent) await this.fs.writeFile(request.target_file, currentContent);

    return {
      status: "success",
      pipeline_state: request.execution_mode === "apply" ? "applied" : "dry_run_completed",
      execution_time_ms: Date.now() - startTime,
      original_state_hash: originalHash,
      final_state_hash: finalHash,
      unified_diff: diff,
      step_results: stepResults
    };
  }
}
