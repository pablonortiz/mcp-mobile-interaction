import { matchElement } from "../utils/element-matcher.js";
import { scrollOnce } from "../utils/scroll.js";
import { waitForStableUiTree } from "../utils/observe.js";
import { describeSelector } from "./selector.js";
import { describeNearMisses } from "../utils/similar-elements.js";
import { readTree, invalidateTree } from "./tree-cache.js";
import { verifyTypedText } from "../utils/verify-input.js";
import type { UiElement } from "../types.js";
import type { FlowCondition, FlowContext, FlowSelector, FlowStep } from "./types.js";

export interface StepOutcome {
  status: "ok" | "skipped" | "failed";
  detail?: string;
}

const POLL_MS = 400;
const SCROLL_TIMEOUT_MS = 20_000;

/** Steps that only read the screen — their cached tree stays valid afterwards. */
const READ_ONLY_STEPS = new Set([
  "assertVisible",
  "assertNotVisible",
  "waitUntil",
  "waitForAnimationToEnd",
]);

/** Executes a single non-structural step (group/repeat are handled by the runner). */
export async function executeStep(step: FlowStep, ctx: FlowContext): Promise<StepOutcome> {
  const outcome = await runStep(step, ctx);
  if (!READ_ONLY_STEPS.has(step.kind)) invalidateTree(ctx);
  return outcome;
}

async function runStep(step: FlowStep, ctx: FlowContext): Promise<StepOutcome> {
  switch (step.kind) {
    case "launchApp":
      return launchApp(step, ctx);
    case "tap":
      return tap(step, ctx);
    case "inputText":
      return inputText(step, ctx);
    case "eraseText":
      await ctx.driver.clearTextField(ctx.deviceId, step.maxChars);
      return ok();
    case "assertVisible":
      return assertVisible(step, ctx);
    case "assertNotVisible":
      return assertNotVisible(step.selector, step.timeoutMs ?? ctx.defaultTimeoutMs, ctx);
    case "waitUntil":
      return step.condition === "visible"
        ? assertVisibleStrict(step.selector, step.timeoutMs ?? ctx.defaultTimeoutMs, ctx)
        : assertNotVisible(step.selector, step.timeoutMs ?? ctx.defaultTimeoutMs, ctx);
    case "scrollUntilVisible":
      return scrollUntilVisible(step, ctx);
    case "swipe":
      return swipe(step, ctx);
    case "pressKey":
      await ctx.driver.pressKey(step.key, ctx.deviceId);
      return ok();
    case "waitForAnimationToEnd":
      await waitForStableUiTree(ctx.platform, ctx.deviceId, 500, step.timeoutMs ?? 10_000);
      return ok();
    case "stopApp":
      await ctx.driver.killApp(ctx.deviceId, requireAppId(step.appId, ctx));
      return ok();
    case "clearState":
      await ctx.driver.clearAppData(ctx.deviceId, requireAppId(step.appId, ctx));
      return ok();
    case "openLink":
      await ctx.driver.openUrl(step.url, ctx.deviceId);
      return ok();
    case "hideKeyboard":
      await ctx.driver.pressKey("escape", ctx.deviceId);
      return ok();
    default:
      return { status: "failed", detail: `unsupported step kind: ${step.kind}` };
  }
}

/** Evaluates a runFlow `when` condition against the current screen. AND logic. */
export async function evaluateCondition(when: FlowCondition, ctx: FlowContext): Promise<boolean> {
  if (when.platform !== undefined && when.platform !== ctx.platform) return false;

  if (when.visible || when.notVisible) {
    const tree = await readTree(ctx);
    if (when.visible && findMatch(tree, when.visible) === undefined) return false;
    if (when.notVisible && findMatch(tree, when.notVisible) !== undefined) return false;
  }
  return true;
}

async function launchApp(
  step: Extract<FlowStep, { kind: "launchApp" }>,
  ctx: FlowContext,
): Promise<StepOutcome> {
  const appId = requireAppId(step.appId, ctx);

  if (step.ifNotRunning) {
    const foreground = await ctx.driver.getForegroundApp(ctx.deviceId).catch(() => undefined);
    if (foreground?.package === appId) {
      return ok("already in foreground — launch skipped, runtime preserved");
    }
  }

  if (step.clearState) await ctx.driver.clearAppData(ctx.deviceId, appId);
  else if (step.stopApp) await ctx.driver.killApp(ctx.deviceId, appId);
  await ctx.driver.launchApp(appId, ctx.deviceId);
  return ok();
}

/**
 * Types and confirms the text landed. A flow that types into a field which has
 * not taken focus yet fails several steps later, on whatever the missing input
 * was supposed to enable — reporting it here names the real step.
 */
async function inputText(
  step: Extract<FlowStep, { kind: "inputText" }>,
  ctx: FlowContext,
): Promise<StepOutcome> {
  await ctx.driver.typeText(step.text, ctx.deviceId);
  invalidateTree(ctx);

  const verification = await verifyTypedText(
    () => ctx.driver.getUiTree(ctx.deviceId),
    step.text,
  );
  if (verification.ok) return ok();

  return {
    status: "failed",
    detail: `the text did not land — ${verification.note}`,
  };
}

async function tap(
  step: Extract<FlowStep, { kind: "tap" }>,
  ctx: FlowContext,
): Promise<StepOutcome> {
  if (step.point) {
    const target = await resolvePoint(step.point, ctx);
    await performTap(step.mode, target.x, target.y, ctx);
    return ok(`(${target.x}, ${target.y})`);
  }

  const timeoutMs = step.timeoutMs ?? ctx.defaultTimeoutMs;
  const element = await waitForMatch(step.selector!, timeoutMs, ctx, true);

  if (!element) {
    const detail = `not found within ${timeoutMs}ms`;
    if (step.optional) {
      return { status: "skipped", detail: `optional, ${detail}` };
    }
    // A near-miss is the usual cause of a flow dying mid-way: the copy moved,
    // or the text sits on a parent that is not the tappable node.
    return {
      status: "failed",
      detail: `${detail}.${await nearMisses(step.selector!, ctx)}`,
    };
  }

  await performTap(step.mode, element.center_x, element.center_y, ctx);

  const warnings: string[] = [];
  if (!element.clickable) warnings.push("⚠ matched element is not clickable — the tap may have no effect");
  if (element.enabled === false) warnings.push("⚠ matched element is disabled");
  return ok([`(${element.center_x}, ${element.center_y})`, ...warnings].join(" "));
}

async function performTap(
  mode: "single" | "double" | "long",
  x: number,
  y: number,
  ctx: FlowContext,
): Promise<void> {
  if (mode === "double") await ctx.driver.doubleTap(x, y, ctx.deviceId);
  else if (mode === "long") await ctx.driver.longPress(x, y, undefined, ctx.deviceId);
  else await ctx.driver.tap(x, y, ctx.deviceId);
}

async function assertVisible(
  step: Extract<FlowStep, { kind: "assertVisible" }>,
  ctx: FlowContext,
): Promise<StepOutcome> {
  const timeoutMs = step.timeoutMs ?? ctx.defaultTimeoutMs;
  const match = await waitForMatch(step.selector, timeoutMs, ctx);
  if (match) return ok();
  const detail = `not visible within ${timeoutMs}ms`;
  if (step.optional) return { status: "skipped", detail: `optional, ${detail}` };
  return { status: "failed", detail: `${detail}.${await nearMisses(step.selector, ctx)}` };
}

/** Closest labels on the current screen, for a step that could not match. */
async function nearMisses(
  selector: FlowSelector,
  ctx: FlowContext,
): Promise<string> {
  const tree = await readTree(ctx).catch(() => []);
  return describeNearMisses(tree, selector.criteria);
}

async function assertVisibleStrict(
  selector: FlowSelector,
  timeoutMs: number,
  ctx: FlowContext,
): Promise<StepOutcome> {
  const match = await waitForMatch(selector, timeoutMs, ctx);
  if (match) return ok();
  return {
    status: "failed",
    detail: `not visible within ${timeoutMs}ms.${await nearMisses(selector, ctx)}`,
  };
}

async function assertNotVisible(
  selector: FlowSelector,
  timeoutMs: number,
  ctx: FlowContext,
): Promise<StepOutcome> {
  const deadline = Date.now() + timeoutMs;
  do {
    const tree = await readTree(ctx);
    if (findMatch(tree, selector) === undefined) return ok();
    // Still there: only a fresh read can show it gone.
    invalidateTree(ctx);
    await delay(POLL_MS);
  } while (Date.now() < deadline);
  return { status: "failed", detail: `still visible after ${timeoutMs}ms (${describeSelector(selector)})` };
}

async function scrollUntilVisible(
  step: Extract<FlowStep, { kind: "scrollUntilVisible" }>,
  ctx: FlowContext,
): Promise<StepOutcome> {
  const timeoutMs = step.timeoutMs ?? SCROLL_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  let scrolls = 0;

  do {
    const tree = await readTree(ctx);
    if (findMatch(tree, step.selector) !== undefined) {
      return ok(scrolls > 0 ? `after ${scrolls} scroll(s)` : undefined);
    }
    await scrollOnce(ctx.platform, step.direction, ctx.deviceId, tree);
    invalidateTree(ctx);
    scrolls++;
    await delay(500);
  } while (Date.now() < deadline);

  return {
    status: "failed",
    detail: `not found after ${scrolls} scroll(s) in ${timeoutMs}ms.${await nearMisses(step.selector, ctx)}`,
  };
}

async function swipe(
  step: Extract<FlowStep, { kind: "swipe" }>,
  ctx: FlowContext,
): Promise<StepOutcome> {
  const info = await ctx.driver.getScreenInfo(ctx.deviceId);
  const cx = Math.round(info.width / 2);
  const cy = Math.round(info.height / 2);
  const dy = Math.round(info.height * 0.2);
  const dx = Math.round(info.width * 0.3);

  const gestures = {
    up: [cx, cy + dy, cx, cy - dy],
    down: [cx, cy - dy, cx, cy + dy],
    left: [cx + dx, cy, cx - dx, cy],
    right: [cx - dx, cy, cx + dx, cy],
  } as const;

  const [x1, y1, x2, y2] = gestures[step.direction];
  await ctx.driver.swipe(x1, y1, x2, y2, step.durationMs ?? 300, ctx.deviceId);
  return ok();
}

async function waitForMatch(
  selector: FlowSelector,
  timeoutMs: number,
  ctx: FlowContext,
  preferClickable = false,
): Promise<UiElement | undefined> {
  const deadline = Date.now() + timeoutMs;
  do {
    const tree = await readTree(ctx);
    const match = findMatch(tree, selector, preferClickable);
    if (match) return match;
    // A miss means the screen has to change for this to succeed — never poll
    // the same cached tree twice.
    invalidateTree(ctx);
    await delay(POLL_MS);
  } while (Date.now() < deadline);
  return undefined;
}

/**
 * For tap steps, clickable matches are preferred (ordered first): tapping wants
 * something tappable, and headers/labels often match the same text earlier in
 * the tree — the source of silent no-op taps.
 */
function findMatch(
  tree: UiElement[],
  selector: FlowSelector,
  preferClickable = false,
): UiElement | undefined {
  let matches = tree.filter((el) => matchElement(el, selector.criteria));
  if (preferClickable) {
    matches = [...matches.filter((el) => el.clickable), ...matches.filter((el) => !el.clickable)];
  }
  return matches.length > selector.index ? matches[selector.index] : undefined;
}

async function resolvePoint(
  point: string,
  ctx: FlowContext,
): Promise<{ x: number; y: number }> {
  const [rawX, rawY] = point.split(",");
  if (!point.includes("%")) return { x: Number(rawX), y: Number(rawY) };

  const info = await ctx.driver.getScreenInfo(ctx.deviceId);
  const toPixels = (raw: string, size: number) =>
    raw.endsWith("%") ? Math.round((Number(raw.slice(0, -1)) / 100) * size) : Number(raw);
  return { x: toPixels(rawX, info.width), y: toPixels(rawY, info.height) };
}

function requireAppId(stepAppId: string | undefined, ctx: FlowContext): string {
  const appId = stepAppId ?? ctx.appId;
  if (!appId) {
    throw new Error("no appId: set it on the step, in the flow header, or via the app_id parameter");
  }
  return appId;
}

function ok(detail?: string): StepOutcome {
  return { status: "ok", detail };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
