import { parseAllDocuments } from "yaml";
import { parseSelector, describeSelector } from "./selector.js";
import type { FlowCondition, FlowStep, ParsedFlow } from "./types.js";

/**
 * Parses a flow written in the Maestro YAML subset. Supports the optional
 * Maestro header document (`appId: ... env: ... --- ...`). `env` values
 * substitute `${VAR}` placeholders; the invocation env overrides header defaults.
 */
export function parseFlowYaml(yamlText: string, env: Record<string, string> = {}): ParsedFlow {
  const docs = parseAllDocuments(yamlText)
    .map((doc) => doc.toJS() as unknown)
    .filter((doc) => doc !== null && doc !== undefined);

  if (docs.length === 0) throw new Error("Flow YAML is empty");

  const header = docs.length > 1 ? asMap(docs[0], "header") : {};
  const rawSteps = docs.length > 1 ? docs[1] : docs[0];
  const headerEnv = header.env !== undefined ? parseEnvMap(header.env, "header.env") : {};
  const effectiveEnv = { ...headerEnv, ...env };

  return {
    appId: header.appId !== undefined ? String(header.appId) : undefined,
    env: effectiveEnv,
    steps: normalizeSteps(substituteEnv(rawSteps, effectiveEnv, "steps"), "steps"),
  };
}

/** Deep-replaces ${VAR} in every string of a raw step structure. */
export function substituteEnv(raw: unknown, env: Record<string, string>, where: string): unknown {
  if (typeof raw === "string") {
    return raw.replace(/\$\{(\w+)\}/g, (_, name: string) => {
      if (env[name] === undefined) {
        const available = Object.keys(env).join(", ") || "none";
        throw new Error(`${where}: undefined variable \${${name}} (available: ${available})`);
      }
      return env[name];
    });
  }
  if (Array.isArray(raw)) return raw.map((item) => substituteEnv(item, env, where));
  if (typeof raw === "object" && raw !== null) {
    return Object.fromEntries(
      Object.entries(raw).map(([key, value]) => [key, substituteEnv(value, env, where)]),
    );
  }
  return raw;
}

/**
 * Normalizes a raw list of steps (from YAML or from the tool's JSON `steps`
 * input) into typed FlowSteps, failing with the exact step path on error.
 */
export function normalizeSteps(raw: unknown, where: string): FlowStep[] {
  if (!Array.isArray(raw)) throw new Error(`${where}: expected a list of steps`);
  return raw.map((step, i) => normalizeStep(step, `${where}[${i}]`));
}

function normalizeStep(raw: unknown, where: string): FlowStep {
  if (typeof raw === "string") return bareStep(raw, where);

  const map = asMap(raw, where);
  const keys = Object.keys(map);
  if (keys.length !== 1) {
    throw new Error(
      `${where}: each step must have exactly one command key (got: ${keys.join(", ") || "none"})`,
    );
  }

  const command = keys[0];
  const normalize = NORMALIZERS[command];
  if (!normalize) {
    throw new Error(`${where}: unknown command "${command}". Supported: ${SUPPORTED}`);
  }
  return normalize(map[command], `${where}.${command}`);
}

function bareStep(command: string, where: string): FlowStep {
  const normalize = NORMALIZERS[command];
  if (!normalize || !BARE_COMMANDS.has(command)) {
    throw new Error(`${where}: unknown bare command "${command}". Supported: ${SUPPORTED}`);
  }
  return normalize(null, `${where}.${command}`);
}

const BARE_COMMANDS = new Set([
  "back",
  "eraseText",
  "waitForAnimationToEnd",
  "stopApp",
  "clearState",
  "launchApp",
  "hideKeyboard",
]);

type Normalizer = (args: unknown, where: string) => FlowStep;

const NORMALIZERS: Record<string, Normalizer> = {
  launchApp: normalizeLaunchApp,
  tapOn: tapNormalizer("single", "tapOn"),
  doubleTapOn: tapNormalizer("double", "doubleTapOn"),
  longPressOn: tapNormalizer("long", "longPressOn"),
  inputText: (args, where) => ({
    kind: "inputText",
    text: requireString(args, where),
    label: `inputText "${requireString(args, where)}"`,
  }),
  eraseText: (args, where) => ({
    kind: "eraseText",
    maxChars: args === null || args === undefined ? undefined : requireNumber(args, where),
    label: "eraseText",
  }),
  assertVisible: normalizeAssertVisible,
  assertNotVisible: normalizeAssertNotVisible,
  extendedWaitUntil: normalizeExtendedWaitUntil,
  scrollUntilVisible: normalizeScrollUntilVisible,
  swipe: normalizeSwipe,
  back: () => ({ kind: "pressKey", key: "back", label: "back" }),
  pressKey: (args, where) => {
    const key = requireString(args, where).toLowerCase().replace(/\s+/g, "_");
    return { kind: "pressKey", key, label: `pressKey ${key}` };
  },
  waitForAnimationToEnd: (args, where) => ({
    kind: "waitForAnimationToEnd",
    timeoutMs: optionalNumber(asOptionalMap(args, where).timeout, `${where}.timeout`),
    label: "waitForAnimationToEnd",
  }),
  stopApp: (args, where) => appStep("stopApp", args, where),
  clearState: (args, where) => appStep("clearState", args, where),
  openLink: (args, where) => ({
    kind: "openLink",
    url: requireString(args, where),
    label: `openLink ${requireString(args, where)}`,
  }),
  hideKeyboard: () => ({ kind: "hideKeyboard", label: "hideKeyboard" }),
  runFlow: normalizeRunFlow,
  repeat: normalizeRepeat,
};

const SUPPORTED = Object.keys(NORMALIZERS).join(", ");

function normalizeLaunchApp(args: unknown, where: string): FlowStep {
  if (args === null || args === undefined) {
    return { kind: "launchApp", clearState: false, stopApp: true, ifNotRunning: false, label: "launchApp" };
  }
  if (typeof args === "string") {
    return {
      kind: "launchApp",
      appId: args,
      clearState: false,
      stopApp: true,
      ifNotRunning: false,
      label: `launchApp ${args}`,
    };
  }
  const map = asMap(args, where);
  const appId = map.appId !== undefined ? String(map.appId) : undefined;
  const ifNotRunning = map.ifNotRunning === true;
  if (ifNotRunning && map.clearState === true) {
    throw new Error(`${where}: ifNotRunning and clearState are contradictory`);
  }
  return {
    kind: "launchApp",
    appId,
    clearState: map.clearState === true,
    stopApp: map.stopApp !== false,
    ifNotRunning,
    label: `launchApp${appId ? ` ${appId}` : ""}${ifNotRunning ? " (if not running)" : ""}`,
  };
}

function tapNormalizer(mode: "single" | "double" | "long", name: string): Normalizer {
  return (args, where) => {
    if (typeof args === "string") {
      const selector = parseSelector(args, where);
      return { kind: "tap", mode, selector, optional: false, label: `${name} ${describeSelector(selector)}` };
    }

    const map = asMap(args, where);
    const point = map.point !== undefined ? parsePoint(map.point, `${where}.point`) : undefined;
    const hasSelectorKeys = ["text", "id", "type", "clickable", "index"].some((k) => map[k] !== undefined);

    if (point && hasSelectorKeys) {
      throw new Error(`${where}: point and element selectors cannot be combined (v1 supports screen-level point only)`);
    }
    if (!point && !hasSelectorKeys) {
      throw new Error(`${where}: provide a selector (text/id/...) or a point`);
    }

    const selector = hasSelectorKeys ? parseSelector(map, where) : undefined;
    return {
      kind: "tap",
      mode,
      selector,
      point,
      optional: map.optional === true,
      timeoutMs: optionalNumber(map.timeout, `${where}.timeout`),
      label: `${name} ${selector ? describeSelector(selector) : `point ${point}`}`,
    };
  };
}

function normalizeAssertVisible(args: unknown, where: string): FlowStep {
  const selector = parseSelector(args, where);
  const map = typeof args === "object" && args !== null ? (args as Record<string, unknown>) : {};
  return {
    kind: "assertVisible",
    selector,
    optional: map.optional === true,
    timeoutMs: optionalNumber(map.timeout, `${where}.timeout`),
    label: `assertVisible ${describeSelector(selector)}`,
  };
}

function normalizeAssertNotVisible(args: unknown, where: string): FlowStep {
  const selector = parseSelector(args, where);
  const map = typeof args === "object" && args !== null ? (args as Record<string, unknown>) : {};
  return {
    kind: "assertNotVisible",
    selector,
    timeoutMs: optionalNumber(map.timeout, `${where}.timeout`),
    label: `assertNotVisible ${describeSelector(selector)}`,
  };
}

function normalizeExtendedWaitUntil(args: unknown, where: string): FlowStep {
  const map = asMap(args, where);
  const condition = map.visible !== undefined ? "visible" : map.notVisible !== undefined ? "notVisible" : undefined;
  if (!condition) throw new Error(`${where}: requires visible or notVisible`);
  const selector = parseSelector(map[condition], `${where}.${condition}`);
  return {
    kind: "waitUntil",
    condition,
    selector,
    timeoutMs: optionalNumber(map.timeout, `${where}.timeout`),
    label: `extendedWaitUntil ${condition} ${describeSelector(selector)}`,
  };
}

function normalizeScrollUntilVisible(args: unknown, where: string): FlowStep {
  const map = asMap(args, where);
  if (map.element === undefined) throw new Error(`${where}: requires element`);
  const selector = parseSelector(map.element, `${where}.element`);

  const direction = String(map.direction ?? "DOWN").toLowerCase();
  if (direction !== "down" && direction !== "up") {
    throw new Error(`${where}.direction: only DOWN and UP are supported (v1)`);
  }

  return {
    kind: "scrollUntilVisible",
    selector,
    direction,
    timeoutMs: optionalNumber(map.timeout, `${where}.timeout`),
    label: `scrollUntilVisible ${describeSelector(selector)}`,
  };
}

function normalizeSwipe(args: unknown, where: string): FlowStep {
  const map = asMap(args, where);
  const direction = String(map.direction ?? "").toLowerCase();
  if (!["up", "down", "left", "right"].includes(direction)) {
    throw new Error(`${where}.direction: must be UP, DOWN, LEFT or RIGHT`);
  }
  return {
    kind: "swipe",
    direction: direction as "up" | "down" | "left" | "right",
    durationMs: optionalNumber(map.duration, `${where}.duration`),
    label: `swipe ${direction}`,
  };
}

function normalizeRunFlow(args: unknown, where: string): FlowStep {
  if (typeof args === "string") {
    return { kind: "flowRef", path: args, label: `runFlow ${args}` };
  }
  const map = asMap(args, where);
  const when = map.when !== undefined ? parseCondition(map.when, `${where}.when`) : undefined;

  if (map.file !== undefined) {
    if (map.commands !== undefined) {
      throw new Error(`${where}: file and commands are mutually exclusive`);
    }
    const path = String(map.file);
    return {
      kind: "flowRef",
      path,
      when,
      env: map.env !== undefined ? parseEnvMap(map.env, `${where}.env`) : undefined,
      label: typeof map.label === "string" ? map.label : `runFlow ${path}`,
    };
  }

  if (map.env !== undefined) throw new Error(`${where}: env is only supported with file:`);
  if (map.commands === undefined) throw new Error(`${where}: requires commands or file`);

  const steps = normalizeSteps(map.commands, `${where}.commands`);
  const label = typeof map.label === "string" ? map.label : `runFlow (${steps.length} steps)`;
  return { kind: "group", when, steps, label };
}

function normalizeRepeat(args: unknown, where: string): FlowStep {
  const map = asMap(args, where);
  const times = map.times !== undefined ? requireNumber(map.times, `${where}.times`) : undefined;
  const whileCond = map.while !== undefined ? parseCondition(map.while, `${where}.while`) : undefined;
  if (times === undefined && whileCond === undefined) {
    throw new Error(`${where}: requires times or while`);
  }
  if (map.commands === undefined) throw new Error(`${where}: requires commands`);
  return {
    kind: "repeat",
    times,
    while: whileCond,
    steps: normalizeSteps(map.commands, `${where}.commands`),
    label: whileCond ? `repeat while${times !== undefined ? ` (max ${times})` : ""}` : `repeat x${times}`,
  };
}

function parseEnvMap(raw: unknown, where: string): Record<string, string> {
  const map = asMap(raw, where);
  return Object.fromEntries(Object.entries(map).map(([key, value]) => [key, String(value)]));
}

function appStep(kind: "stopApp" | "clearState", args: unknown, where: string): FlowStep {
  if (args === null || args === undefined) return { kind, label: kind };
  if (typeof args === "string") return { kind, appId: args, label: `${kind} ${args}` };

  const map = asMap(args, where);
  const appId = map.appId !== undefined ? String(map.appId) : undefined;
  return { kind, appId, label: `${kind}${appId ? ` ${appId}` : ""}` };
}

function parseCondition(raw: unknown, where: string): FlowCondition {
  const map = asMap(raw, where);
  const condition: FlowCondition = {};

  if (map.visible !== undefined) condition.visible = parseSelector(map.visible, `${where}.visible`);
  if (map.notVisible !== undefined) condition.notVisible = parseSelector(map.notVisible, `${where}.notVisible`);
  if (map.platform !== undefined) {
    const platform = String(map.platform).toLowerCase();
    if (platform !== "android" && platform !== "ios") {
      throw new Error(`${where}.platform: must be Android or iOS`);
    }
    condition.platform = platform;
  }
  if (map.true !== undefined) {
    throw new Error(`${where}: JavaScript conditions (true:) are not supported`);
  }
  if (Object.keys(condition).length === 0) {
    throw new Error(`${where}: requires visible, notVisible, or platform`);
  }
  return condition;
}

function parsePoint(raw: unknown, where: string): string {
  const point = String(raw).replace(/\s/g, "");
  if (!/^\d+%?,\d+%?$/.test(point)) {
    throw new Error(`${where}: expected "x,y" in pixels or "x%,y%" (e.g. "50%,50%")`);
  }
  return point;
}

function asMap(raw: unknown, where: string): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`${where}: expected a map`);
  }
  return raw as Record<string, unknown>;
}

function asOptionalMap(raw: unknown, where: string): Record<string, unknown> {
  if (raw === null || raw === undefined) return {};
  return asMap(raw, where);
}

function requireString(raw: unknown, where: string): string {
  if (typeof raw !== "string" || raw.length === 0) throw new Error(`${where}: expected a string`);
  return raw;
}

function requireNumber(raw: unknown, where: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${where}: expected a non-negative integer`);
  return value;
}

function optionalNumber(raw: unknown, where: string): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  return requireNumber(raw, where);
}

const APP_ID_STEPS = new Set(["launchApp", "stopApp", "clearState"]);

/**
 * Labels of steps that need an appId and carry none. Checked before execution
 * so a flow that cannot run fails at parse time instead of mid-way.
 */
export function stepsMissingAppId(steps: FlowStep[]): string[] {
  return steps.flatMap((step) => {
    if (step.kind === "group" || step.kind === "repeat") {
      return stepsMissingAppId(step.steps);
    }
    const needsAppId = APP_ID_STEPS.has(step.kind);
    const hasOwnAppId = "appId" in step && Boolean(step.appId);
    return needsAppId && !hasOwnAppId ? [step.label] : [];
  });
}
