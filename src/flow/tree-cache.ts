import type { UiElement } from "../types.js";
import type { FlowContext } from "./types.js";

const MAX_AGE_MS = 1_500;

interface CachedTree {
  tree: UiElement[];
  capturedAt: number;
}

const caches = new WeakMap<FlowContext, CachedTree>();

/**
 * Reads the UI tree, reusing the last one when nothing has acted on the device
 * since. A dump costs ~2s of a flow's wall clock, and the common
 * `assertVisible: X` → `tapOn: X` pair used to pay for it twice over the same
 * unchanged screen.
 */
export async function readTree(ctx: FlowContext): Promise<UiElement[]> {
  const cached = caches.get(ctx);
  if (cached && Date.now() - cached.capturedAt < MAX_AGE_MS) {
    return cached.tree;
  }

  const tree = await ctx.driver.getUiTree(ctx.deviceId);
  caches.set(ctx, { tree, capturedAt: Date.now() });
  return tree;
}

/** Called by every step that touches the device — the screen may have moved. */
export function invalidateTree(ctx: FlowContext): void {
  caches.delete(ctx);
}
