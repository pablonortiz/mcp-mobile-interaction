import { readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { parseFlowYaml, substituteEnv, normalizeSteps } from "./parse.js";
import type { FlowStep, ParsedFlow } from "./types.js";

const MAX_DEPTH = 5;

export interface LoadFlowInput {
  yamlText?: string;
  filePath?: string;
  steps?: unknown[];
  env?: Record<string, string>;
}

/**
 * Loads a flow from any of the three input forms and resolves every
 * `runFlow: file:` reference recursively (relative to the referencing flow's
 * directory), applying env substitution per file.
 */
export async function loadFlow(input: LoadFlowInput): Promise<ParsedFlow> {
  const env = input.env ?? {};

  if (input.filePath !== undefined) {
    const target = resolve(input.filePath);
    const parsed = parseFlowYaml(await readFile(target, "utf8"), env);
    parsed.steps = await resolveFileRefs(parsed.steps, dirname(target), parsed.env ?? env, [target]);
    return parsed;
  }

  const parsed =
    input.yamlText !== undefined
      ? parseFlowYaml(input.yamlText, env)
      : { env, steps: normalizeSteps(substituteEnv(input.steps, env, "steps"), "steps") };

  parsed.steps = await resolveFileRefs(parsed.steps, undefined, parsed.env ?? env, []);
  return parsed;
}

async function resolveFileRefs(
  steps: FlowStep[],
  baseDir: string | undefined,
  env: Record<string, string>,
  chain: string[],
): Promise<FlowStep[]> {
  return Promise.all(
    steps.map(async (step) => {
      if (step.kind === "flowRef") return resolveRef(step, baseDir, env, chain);
      if (step.kind === "group" || step.kind === "repeat") {
        return { ...step, steps: await resolveFileRefs(step.steps, baseDir, env, chain) };
      }
      return step;
    }),
  );
}

async function resolveRef(
  ref: Extract<FlowStep, { kind: "flowRef" }>,
  baseDir: string | undefined,
  env: Record<string, string>,
  chain: string[],
): Promise<FlowStep> {
  if (!isAbsolute(ref.path) && baseDir === undefined) {
    throw new Error(
      `runFlow ${ref.path}: relative file references need a flow_file as entry point (or use an absolute path)`,
    );
  }
  const target = isAbsolute(ref.path) ? ref.path : resolve(baseDir!, ref.path);

  if (chain.includes(target)) {
    throw new Error(`runFlow ${ref.path}: circular reference (${[...chain, target].map((p) => basename(p)).join(" → ")})`);
  }
  if (chain.length >= MAX_DEPTH) {
    throw new Error(`runFlow ${ref.path}: max nesting depth (${MAX_DEPTH}) exceeded`);
  }

  const childEnv = { ...env, ...ref.env };
  const child = parseFlowYaml(await readFile(target, "utf8"), childEnv);
  const steps = await resolveFileRefs(child.steps, dirname(target), child.env ?? childEnv, [...chain, target]);

  return {
    kind: "group",
    when: ref.when,
    steps,
    label: ref.label !== `runFlow ${ref.path}` ? ref.label : basename(target, ".yaml"),
  };
}
