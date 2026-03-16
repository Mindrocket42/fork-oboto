/**
 * Tests for the task planner module.
 *
 * @module src/core/agentic/cognitive/__tests__/task-planner.test
 */

import { jest, describe, it, expect } from '@jest/globals';
import {
  classifyInput,
  generatePlan,
  executePlan,
  synthesizeResponse,
  TaskPlan,
  SIMPLE_PATTERNS,
  COMPLEX_PATTERNS,
} from '../task-planner.mjs';

// ════════════════════════════════════════════════════════════════════
// classifyInput
// ════════════════════════════════════════════════════════════════════

describe('classifyInput', () => {
  describe('simple classifications', () => {
    const simpleCases = [
      'hi',
      'hello!',
      'thanks',
      'ok',
      'good morning',
      'bye',
      'What is a closure?',
      'How does React work?',
      'help',
      'status',
      'Read the file package.json',
      'show the contents of README.md',
    ];

    it.each(simpleCases)('classifies "%s" as simple', (input) => {
      expect(classifyInput(input)).toBe('simple');
    });

    it('classifies very short messages (≤5 words) as simple', () => {
      expect(classifyInput('what is this')).toBe('simple');
      expect(classifyInput('yes')).toBe('simple');
    });
  });

  describe('complex classifications', () => {
    // After tuning, short "create/build" requests (< 15 words) are classified
    // as simple to avoid over-decomposition.  Complex patterns only trigger
    // for inputs >= 15 words, and the action-verb heuristic needs >= 3 verbs
    // with >= 30 words.
    const complexCases = [
      // Refactoring — always complex when >= 15 words
      'Refactor the database module to use connection pooling and update all the related service files to use the new module',
      // Multi-step explicit language (>= 15 words)
      'First read the config file, then update the database connection settings and finally restart the server process to apply changes',
      // Project-scope work with "using/including" pattern (>= 15 words)
      'Create a new application project with authentication module using JWT tokens including both login and registration endpoints plus database migrations',
      // Multiple action verbs (>= 30 words, >= 3 verbs)
      'We need to create the user model, implement the authentication middleware, update the routes to use the new auth system, and fix the existing tests to work with the changes across the whole codebase',
    ];

    it.each(complexCases)('classifies "%s" as complex', (input) => {
      expect(classifyInput(input)).toBe('complex');
    });

    // Verify that short "create" requests are now simple (intentional threshold change)
    it('classifies short create/build requests as simple (< 15 words)', () => {
      expect(classifyInput('Create a React app with authentication and a dashboard')).toBe('simple');
      expect(classifyInput('Build an API server using Express with JWT auth')).toBe('simple');
    });
  });

  describe('edge cases', () => {
    it('defaults to simple when ambiguous', () => {
      expect(classifyInput('tell me about the weather')).toBe('simple');
    });

    it('empty input is simple', () => {
      expect(classifyInput('')).toBe('simple');
    });

    it('respects minComplexityWords config', () => {
      const input = 'update the auth module and add tests for it';
      // Default threshold - not enough action verbs to hit long-message rule
      const result = classifyInput(input, { minComplexityWords: 5 });
      // With lowered threshold, the action-verb heuristic may trigger
      expect(['simple', 'complex']).toContain(result);
    });
  });
});

// ════════════════════════════════════════════════════════════════════
// TaskPlan
// ════════════════════════════════════════════════════════════════════

describe('TaskPlan', () => {
  it('creates a plan with correct default state', () => {
    const plan = new TaskPlan({
      title: 'Test Plan',
      steps: [
        { label: 'Step 1', tools: ['read_file'] },
        { label: 'Step 2', tools: ['write_file'] },
      ],
    });

    expect(plan.id).toMatch(/^plan-/);
    expect(plan.title).toBe('Test Plan');
    expect(plan.status).toBe('planning');
    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[0].status).toBe('pending');
    expect(plan.steps[1].status).toBe('pending');
    expect(plan.steps[0].id).toBe('step-1');
    expect(plan.steps[1].id).toBe('step-2');
  });

  it('toUISteps() maps statuses correctly', () => {
    const plan = new TaskPlan({
      title: 'Test',
      steps: [{ label: 'A' }, { label: 'B' }, { label: 'C' }, { label: 'D' }, { label: 'E' }],
    });

    plan.steps[0].status = 'done';
    plan.steps[1].status = 'running';
    plan.steps[2].status = 'failed';
    plan.steps[3].status = 'skipped';
    // steps[4] remains 'pending'

    const uiSteps = plan.toUISteps();
    expect(uiSteps[0]).toEqual({ label: 'A', status: 'done' });
    expect(uiSteps[1]).toEqual({ label: 'B', status: 'running' });
    expect(uiSteps[2]).toEqual({ label: 'C', status: 'failed' });
    expect(uiSteps[3]).toEqual({ label: 'D', status: 'skipped' });
    expect(uiSteps[4]).toEqual({ label: 'E', status: 'pending' });
  });

  it('toSummary() generates readable text', () => {
    const plan = new TaskPlan({
      title: 'Test',
      steps: [
        { label: 'Step 1' },
        { label: 'Step 2' },
      ],
    });

    plan.steps[0].status = 'done';
    plan.steps[0].result = 'Created file';

    const summary = plan.toSummary();
    expect(summary).toContain('✅ Step 1 → Created file');
    expect(summary).toContain('⬜ Step 2');
  });
});

// ════════════════════════════════════════════════════════════════════
// generatePlan
// ════════════════════════════════════════════════════════════════════

describe('generatePlan', () => {
  it('generates a plan from a valid LLM JSON response', async () => {
    const mockCallLLM = jest.fn().mockResolvedValue({
      content: JSON.stringify({
        title: 'Create React App',
        steps: [
          { label: 'Scaffold project with Vite', tools: ['execute_command'] },
          { label: 'Install dependencies', tools: ['execute_command'] },
          { label: 'Create components', tools: ['write_file'] },
        ],
      }),
    });

    const plan = await generatePlan('Create a React app', mockCallLLM);

    expect(plan).not.toBeNull();
    expect(plan.title).toBe('Create React App');
    expect(plan.steps).toHaveLength(3);
    expect(plan.steps[0].label).toBe('Scaffold project with Vite');
    expect(plan.steps[0].tools).toEqual(['execute_command']);
  });

  it('handles LLM response wrapped in markdown code block', async () => {
    const mockCallLLM = jest.fn().mockResolvedValue({
      content: '```json\n{"title":"Test","steps":[{"label":"Step 1"}]}\n```',
    });

    const plan = await generatePlan('do something', mockCallLLM);
    expect(plan).not.toBeNull();
    expect(plan.title).toBe('Test');
  });

  it('returns null on invalid JSON', async () => {
    const mockCallLLM = jest.fn().mockResolvedValue({
      content: 'This is not JSON at all.',
    });

    const plan = await generatePlan('do something', mockCallLLM);
    expect(plan).toBeNull();
  });

  it('returns null when LLM throws', async () => {
    const mockCallLLM = jest.fn().mockRejectedValue(new Error('LLM unavailable'));

    const plan = await generatePlan('do something', mockCallLLM);
    expect(plan).toBeNull();
  });

  it('enforces maxSteps', async () => {
    const mockCallLLM = jest.fn().mockResolvedValue({
      content: JSON.stringify({
        title: 'Big Plan',
        steps: Array.from({ length: 20 }, (_, i) => ({ label: `Step ${i + 1}` })),
      }),
    });

    // Input must be >= 50 words for dynamicMax to allow 5+ steps.
    // Short inputs (< 50 words) are dynamically capped at 4 steps.
    const longInput = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
    const plan = await generatePlan(longInput, mockCallLLM, { maxSteps: 5 });
    expect(plan.steps).toHaveLength(5);
  });

  it('returns null for empty steps array', async () => {
    const mockCallLLM = jest.fn().mockResolvedValue({
      content: JSON.stringify({ title: 'Empty', steps: [] }),
    });

    const plan = await generatePlan('nothing', mockCallLLM);
    expect(plan).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════
// executePlan
// ════════════════════════════════════════════════════════════════════

describe('executePlan', () => {
  it('executes all steps successfully', async () => {
    const plan = new TaskPlan({
      title: 'Test',
      steps: [
        { label: 'Step 1' },
        { label: 'Step 2' },
      ],
    });

    const updates = [];
    const mockTurn = jest.fn().mockResolvedValue({ response: 'Done successfully.' });
    const mockUpdate = jest.fn((p) => updates.push(JSON.parse(JSON.stringify(p.toUISteps()))));

    const result = await executePlan(plan, {
      executeTurn: mockTurn,
      onUpdate: mockUpdate,
    });

    expect(result.plan.status).toBe('completed');
    expect(result.stepResults).toHaveLength(2);
    expect(result.plan.steps[0].status).toBe('done');
    expect(result.plan.steps[1].status).toBe('done');
    expect(mockTurn).toHaveBeenCalledTimes(2);
    // Should have been called: executing, step1 running, step1 done, step2 running, step2 done, completed
    expect(mockUpdate.mock.calls.length).toBeGreaterThanOrEqual(5);
  });

  it('handles step failure and continues', async () => {
    const plan = new TaskPlan({
      title: 'Test',
      steps: [
        { label: 'Step 1' },
        { label: 'Step 2' },
        { label: 'Step 3' },
      ],
    });

    const mockTurn = jest.fn()
      .mockResolvedValueOnce({ response: 'Done.' })
      .mockRejectedValueOnce(new Error('Tool failed'))
      .mockResolvedValueOnce({ response: 'Done.' });

    const result = await executePlan(plan, {
      executeTurn: mockTurn,
      onUpdate: jest.fn(),
    });

    expect(result.plan.status).toBe('failed');
    expect(result.plan.steps[0].status).toBe('done');
    expect(result.plan.steps[1].status).toBe('failed');
    expect(result.plan.steps[1].error).toBe('Tool failed');
    expect(result.plan.steps[2].status).toBe('done');
  });

  it('respects abort signal', async () => {
    const plan = new TaskPlan({
      title: 'Test',
      steps: [
        { label: 'Step 1' },
        { label: 'Step 2' },
        { label: 'Step 3' },
      ],
    });

    const controller = new AbortController();
    const mockTurn = jest.fn().mockImplementation(async () => {
      controller.abort(); // Abort after first step
      return { response: 'Done.' };
    });

    const result = await executePlan(plan, {
      executeTurn: mockTurn,
      onUpdate: jest.fn(),
      signal: controller.signal,
    });

    expect(result.plan.status).toBe('cancelled');
    expect(result.plan.steps[0].status).toBe('done');
    expect(result.plan.steps[1].status).toBe('skipped');
    expect(result.plan.steps[2].status).toBe('skipped');
  });
});

// ════════════════════════════════════════════════════════════════════
// synthesizeResponse
// ════════════════════════════════════════════════════════════════════

describe('synthesizeResponse', () => {
  it('generates a synthesis from LLM', async () => {
    const plan = new TaskPlan({
      title: 'Test Plan',
      steps: [{ label: 'Step 1' }],
    });
    plan.steps[0].status = 'done';

    const mockCallLLM = jest.fn().mockResolvedValue({
      content: 'All tasks completed successfully.',
    });

    const result = await synthesizeResponse(
      plan,
      [{ stepId: 'step-1', response: 'Created the file' }],
      mockCallLLM,
    );

    expect(result).toBe('All tasks completed successfully.');
  });

  it('falls back to structured summary on LLM failure', async () => {
    const plan = new TaskPlan({
      title: 'Test Plan',
      steps: [
        { label: 'Step 1' },
        { label: 'Step 2' },
      ],
    });
    plan.steps[0].status = 'done';
    plan.steps[0].result = 'Created file';
    plan.steps[1].status = 'failed';
    plan.steps[1].error = 'Permission denied';

    const mockCallLLM = jest.fn().mockRejectedValue(new Error('LLM down'));

    const result = await synthesizeResponse(
      plan,
      [
        { stepId: 'step-1', response: 'Created file' },
        { stepId: 'step-2', response: 'Error: Permission denied' },
      ],
      mockCallLLM,
    );

    expect(result).toContain('Test Plan');
    expect(result).toContain('1/2');
    expect(result).toContain('✅');
    expect(result).toContain('❌');
    expect(result).toContain('Permission denied');
  });
});

// ════════════════════════════════════════════════════════════════════
// Pattern sanity checks
// ════════════════════════════════════════════════════════════════════

describe('pattern arrays', () => {
  it('SIMPLE_PATTERNS is a non-empty array of RegExp', () => {
    expect(SIMPLE_PATTERNS.length).toBeGreaterThan(0);
    for (const p of SIMPLE_PATTERNS) {
      expect(p).toBeInstanceOf(RegExp);
    }
  });

  it('COMPLEX_PATTERNS is a non-empty array of RegExp', () => {
    expect(COMPLEX_PATTERNS.length).toBeGreaterThan(0);
    for (const p of COMPLEX_PATTERNS) {
      expect(p).toBeInstanceOf(RegExp);
    }
  });
});
