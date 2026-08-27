import type { FlowRunResult, FlowStep } from "./types.js";

const ICONS = { ok: "✓", skipped: "–", failed: "✗" } as const;

/**
 * Compact, token-efficient run report: one line per executed step,
 * headline first so the outcome is readable at a glance.
 */
export function formatFlowReport(run: FlowRunResult, totalMs: number): string {
  const seconds = (totalMs / 1000).toFixed(1);
  const executed = run.results.length;

  const headline = run.failed
    ? `Flow FAILED at step ${executed} (${seconds}s)`
    : `Flow completed: ${executed} step(s) in ${seconds}s`;

  const lines = run.results.map((r, i) => {
    const timing = r.status === "skipped" ? "" : ` (${r.durationMs}ms)`;
    const detail = r.detail ? ` — ${r.detail}` : "";
    return `${ICONS[r.status]} ${i + 1}. ${r.label}${timing}${detail}`;
  });

  return [headline, ...lines].join("\n");
}

/** Indented listing of the parsed steps — used by dry_run to validate a flow. */
export function formatFlowPlan(steps: FlowStep[], indent = ""): string[] {
  return steps.flatMap((step) => {
    const line = `${indent}${step.label}`;
    if (step.kind === "group" || step.kind === "repeat") {
      return [line, ...formatFlowPlan(step.steps, `${indent}  `)];
    }
    return [line];
  });
}
