import { consoleStyler } from '../../ui/console-styler.mjs';

export class SkillHandlers {
    constructor(skillsManager, aiAssistantClass) {
        this.skillsManager = skillsManager;
        this.aiAssistantClass = aiAssistantClass;
    }

    async listSkills() {
        await this.skillsManager.ensureInitialized();
        const skills = this.skillsManager.listSkills();
        
        if (skills.length === 0) {
            return "No skills found in global (skills) or workspace (.skills) directories.";
        }

        return `Available Skills:\n${skills.map(s => `- ${s.name} [${s.source}]: ${s.description}`).join('\n')}`;
    }

    async readSkill(args) {
        await this.skillsManager.ensureInitialized();
        const { skill_name } = args;
        const skill = this.skillsManager.getSkill(skill_name);

        if (!skill) {
            return `[error] read_skill: skill '${skill_name}' not found. Use: list_skills to see available skills.`;
        }

        return `SKILL: ${skill.name}\n\n${skill.content}`;
    }

    async useSkill(args) {
        await this.skillsManager.ensureInitialized();
        const { skill_name, task } = args;
        const skill = this.skillsManager.getSkill(skill_name);

        if (!skill) {
            return `[error] use_skill: skill '${skill_name}' not found. Use: list_skills to see available skills.`;
        }

        if (!this.aiAssistantClass) {
            return "[error] use_skill: AI Assistant class not available for skill execution.";
        }

        consoleStyler.log('ai', `🧠 Executing Skill: ${skill_name} -> ${task}`);

        try {
            // Create a sub-agent for this skill
            // We use the same working directory
            const subAgent = new this.aiAssistantClass(this.skillsManager.workspaceRoot);
            
            // Initialize tools (this loads custom tools + system prompt)
            await subAgent.initializeCustomTools();
            
            const prompt = `Execute task using the '${skill.name}' skill.

SKILL DOCS:
${skill.content}

TASK: ${task}

STEPS:
1. Follow skill documentation to perform the task.
2. Use tools (shell, file) to execute required commands.
3. Report final outcome.`;

            const result = await subAgent.run(prompt);
            return `Skill Execution Result (${skill_name}):\n${result}`;

        } catch (error) {
            consoleStyler.log('error', `Skill execution failed: ${error.message}`);
            return `[error] use_skill: execution of '${skill_name}' failed: ${error.message}`;
        }
    }

    async addNpmSkill(args) {
        await this.skillsManager.ensureInitialized();
        const { packages } = args;
        
        try {
            consoleStyler.log('system', `Adding NPM skills: ${packages.join(', ')}`);
            const result = await this.skillsManager.addNpmSkills(packages);
            return result;
        } catch (error) {
            consoleStyler.log('error', `Failed to add NPM skills: ${error.message}`);
            return `[error] add_npm_skill: ${error.message}`;
        }
    }

    async createSkill(args) {
        const { name, content, scope } = args;
        if (!name || !content) {
            return "[error] create_skill: both 'name' and 'content' are required. Usage: create_skill({ name, content, scope })";
        }

        try {
            consoleStyler.log('system', `Creating skill '${name}' (scope: ${scope || 'workspace'})…`);
            const result = await this.skillsManager.createSkill(name, content, scope || 'workspace');
            return result;
        } catch (error) {
            consoleStyler.log('error', `Failed to create skill: ${error.message}`);
            return `[error] create_skill: ${error.message}`;
        }
    }

    async editSkill(args) {
        const { name, content } = args;
        if (!name || !content) {
            return "[error] edit_skill: both 'name' and 'content' are required. Usage: edit_skill({ name, content })";
        }

        try {
            consoleStyler.log('system', `Editing skill '${name}'…`);
            const result = await this.skillsManager.editSkill(name, content);
            return result;
        } catch (error) {
            consoleStyler.log('error', `Failed to edit skill: ${error.message}`);
            return `[error] edit_skill: ${error.message}. Use: list_skills to verify skill exists.`;
        }
    }

    async deleteSkill(args) {
        const { name } = args;
        if (!name) {
            return "[error] delete_skill: 'name' is required. Usage: delete_skill({ name })";
        }

        try {
            consoleStyler.log('system', `Deleting skill '${name}'…`);
            const result = await this.skillsManager.deleteSkill(name);
            return result;
        } catch (error) {
            consoleStyler.log('error', `Failed to delete skill: ${error.message}`);
            return `[error] delete_skill: ${error.message}. Use: list_skills to verify skill exists.`;
        }
    }

    async promoteSkill(args) {
        const { name } = args;
        if (!name) {
            return "[error] promote_skill: 'name' is required. Usage: promote_skill({ name })";
        }

        try {
            consoleStyler.log('system', `Promoting skill '${name}' to global scope…`);
            const result = await this.skillsManager.promoteSkill(name);
            return result;
        } catch (error) {
            consoleStyler.log('error', `Failed to promote skill: ${error.message}`);
            return `[error] promote_skill: ${error.message}. Use: list_skills to verify skill exists and is workspace-scoped.`;
        }
    }
}
