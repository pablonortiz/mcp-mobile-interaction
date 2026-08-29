import type { Platform, UiElement } from "../types.js";
import { getDriver } from "../platforms/driver.js";
import { compressScreenshot } from "./image.js";
import { filterUiElements } from "./ui-filter.js";
import type { ObservationResult } from "./format-response.js";

export type ObserveMode =
  | "none"
  | "ui_tree"
  | "screenshot"
  | "both"
  | "on_change";

export interface ObserveOptions {
  mode: ObserveMode;
  platform: Platform;
  deviceId?: string;
  delayMs?: number;
  stabilize?: boolean;
  stabilizeTimeoutMs?: number;
  stabilizePollMs?: number;
  filterUi?: boolean;
  previousTree?: UiElement[];
}

/**
 * After an action, optionally wait then capture UI tree and/or screenshot.
 */
export async function performObservation(
  options: ObserveOptions,
): Promise<ObservationResult | undefined> {
  if (options.mode === "none") return undefined;

  // Catch the first screen that differs, instead of guessing a delay long
  // enough to see the change but short enough to beat a toast disappearing.
  if (options.mode === "on_change") {
    const tree = await waitForChangedUiTree(
      options.platform,
      options.deviceId,
      options.previousTree ?? [],
      options.stabilizePollMs ?? 150,
      options.stabilizeTimeoutMs ?? 5_000,
    );
    return { uiTree: filterUiElements(tree, !(options.filterUi ?? true)) };
  }

  // Wait for UI to settle
  if (options.stabilize) {
    await waitForStableUiTree(
      options.platform,
      options.deviceId,
      options.stabilizePollMs ?? 500,
      options.stabilizeTimeoutMs ?? 10_000,
    );
  } else if (options.delayMs && options.delayMs > 0) {
    await delay(options.delayMs);
  }

  const result: ObservationResult = {};
  const driver = getDriver(options.platform);

  const wantTree = options.mode === "ui_tree" || options.mode === "both";
  const wantScreenshot =
    options.mode === "screenshot" || options.mode === "both";

  // Capture in parallel when both are needed
  const [tree, screenshot] = await Promise.all([
    wantTree ? driver.getUiTree(options.deviceId) : undefined,
    wantScreenshot ? getScreenshot(options.platform, options.deviceId) : undefined,
  ]);

  if (tree) {
    result.uiTree = filterUiElements(tree, !(options.filterUi ?? true));
  }
  if (screenshot) {
    result.screenshot = screenshot;
  }

  return result;
}

/**
 * Polls UI tree until two consecutive snapshots match (screen stopped changing).
 * Comparison ignores volatile elements like system clock by hashing
 * element text + bounds of non-system elements.
 */
export async function waitForStableUiTree(
  platform: Platform,
  deviceId?: string,
  pollIntervalMs = 500,
  timeoutMs = 10_000,
): Promise<UiElement[]> {
  const driver = getDriver(platform);
  const start = Date.now();
  let previousHash = "";
  let previousTree: UiElement[] = [];

  while (Date.now() - start < timeoutMs) {
    const tree = await driver.getUiTree(deviceId);
    const hash = hashUiTree(tree);

    if (hash === previousHash && previousHash !== "") {
      return tree;
    }

    previousHash = hash;
    previousTree = tree;
    await delay(pollIntervalMs);
  }

  // Timeout reached — return the last captured tree
  return previousTree;
}

/**
 * Polls until the tree differs from `previous`, returning the first changed
 * snapshot. Falls back to the last reading if nothing changes in time.
 */
export async function waitForChangedUiTree(
  platform: Platform,
  deviceId: string | undefined,
  previous: UiElement[],
  pollIntervalMs: number,
  timeoutMs: number,
): Promise<UiElement[]> {
  const driver = getDriver(platform);
  const baseline = hashUiTree(previous);
  const start = Date.now();
  let latest = previous;

  while (Date.now() - start < timeoutMs) {
    latest = await driver.getUiTree(deviceId);
    if (hashUiTree(latest) !== baseline) return latest;
    await delay(pollIntervalMs);
  }
  return latest;
}

/**
 * Hash a UI tree for comparison. Includes text + bounds of elements
 * but ignores common volatile elements (status bar clock, battery, etc).
 */
function hashUiTree(elements: UiElement[]): string {
  const stable = elements.filter((el) => {
    // Ignore elements near the very top of screen (status bar area)
    if (el.bounds.y < 60 && el.bounds.height < 60) return false;
    return true;
  });

  return stable
    .map(
      (el) =>
        `${el.type}|${el.text}|${el.bounds.x},${el.bounds.y},${el.bounds.width},${el.bounds.height}|${el.clickable}`,
    )
    .join("\n");
}

async function getScreenshot(
  platform: Platform,
  deviceId?: string,
): Promise<{
  base64: string;
  width: number;
  height: number;
  nativeWidth: number;
  nativeHeight: number;
  scale: number;
}> {
  const buffer = await getDriver(platform).screenshot(deviceId);
  return compressScreenshot(buffer, { quality: 50, scale: 0.5 });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
