import { executeStep, evaluateCondition } from "./execute-step.js";
import type { FlowContext, FlowRunResult, FlowStep, StepResult } from "./types.js";

/**
 * Runs a parsed flow sequentially, stopping at the first non-optional
 * failure. Structural steps (runFlow groups, repeat) recurse.
 */
export async function executeFlow(steps: FlowStep[], ctx: FlowContext): Promise<FlowRunResult> {
  const results: StepResult[] = [];
  const failed = await runSteps(steps, ctx, results, "");
  return { results, failed };
}

/** Returns true if execution stopped on a failure. */
async function runSteps(
  steps: FlowStep[],
  ctx: FlowContext,
  results: StepResult[],
  prefix: string,
): Promise<boolean> {
  for (const step of steps) {
    if (step.kind === "group") {
      if (await runGroup(step, ctx, results, prefix)) return true;
    } else if (step.kind === "repeat") {
      if (await runRepeat(step, ctx, results, prefix)) return true;
    } else if (step.kind === "retry") {
      if (await runRetry(step, ctx, results, prefix)) return true;
    } else if (await runSingle(step, ctx, results, prefix)) {
      return true;
    }
  }
  return false;
}

const DEFAULT_WHILE_MAX = 10;

async function runRepeat(
  step: Extract<FlowStep, { kind: "repeat" }>,
  ctx: FlowContext,
  results: StepResult[],
  prefix: string,
): Promise<boolean> {
  const max = step.times ?? DEFAULT_WHILE_MAX;
  let iterations = 0;

  for (let i = 0; i < max; i++) {
    if (step.while) {
      const started = Date.now();
      const applies = await evaluateCondition(step.while, ctx);
      if (!applies) {
        if (iterations === 0) {
          results.push({
            label: `${prefix}${step.label}`,
            status: "skipped",
            durationMs: Date.now() - started,
            detail: "while condition not met",
          });
        }
        return false;
      }
    }
    iterations++;
    const iterationPrefix = step.while
      ? `${prefix}${step.label} #${iterations} · `
      : `${prefix}${step.label} ${iterations}/${max} · `;
    if (await runSteps(step.steps, ctx, results, iterationPrefix)) return true;
  }
  return false;
}

/**
 * Runs a block again when it fails, up to maxRetries extra attempts. Failed
 * attempts stay in the report under their own prefix: a flow that only passed
 * on the third try should not read as a clean run.
 */
async function runRetry(
  step: Extract<FlowStep, { kind: "retry" }>,
  ctx: FlowContext,
  results: StepResult[],
  prefix: string,
): Promise<boolean> {
  const attempts = step.maxRetries + 1;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const attemptResults: StepResult[] = [];
    const attemptPrefix =
      attempts === 1
        ? `${prefix}${step.label} · `
        : `${prefix}${step.label} #${attempt} · `;

    const failed = await runSteps(step.steps, ctx, attemptResults, attemptPrefix);
    results.push(...attemptResults);
    if (!failed) return false;

    if (attempt < attempts) {
      results.push({
        label: `${prefix}${step.label} #${attempt}`,
        status: "skipped",
        durationMs: 0,
        detail: `attempt ${attempt} failed — retrying`,
      });
    }
  }
  return true;
}

async function runGroup(
  step: Extract<FlowStep, { kind: "group" }>,
  ctx: FlowContext,
  results: StepResult[],
  prefix: string,
): Promise<boolean> {
  if (step.when) {
    const started = Date.now();
    const applies = await evaluateCondition(step.when, ctx);
    if (!applies) {
      results.push({
        label: `${prefix}${step.label}`,
        status: "skipped",
        durationMs: Date.now() - started,
        detail: "condition not met",
      });
      return false;
    }
  }
  return runSteps(step.steps, ctx, results, `${prefix}${step.label} · `);
}

async function runSingle(
  step: FlowStep,
  ctx: FlowContext,
  results: StepResult[],
  prefix: string,
): Promise<boolean> {
  const started = Date.now();
  let outcome;
  try {
    outcome = await executeStep(step, ctx);
  } catch (error) {
    outcome = {
      status: "failed" as const,
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  results.push({
    label: `${prefix}${step.label}`,
    status: outcome.status,
    durationMs: Date.now() - started,
    detail: outcome.detail,
  });
  return outcome.status === "failed";
}
