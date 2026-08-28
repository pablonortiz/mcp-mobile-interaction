import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  resolvePlatform,
  PLATFORM_DESCRIPTION,
} from "../utils/resolve-platform.js";
import { getDriver } from "../platforms/driver.js";
import {
  pollIntervalMs,
  defaultScrollLimit,
} from "../utils/poll-interval.js";
import { uiTreeSafe } from "../utils/ui-tree-fallback.js";
import type { Platform, UiElement } from "../types.js";
import { performObservation } from "../utils/observe.js";
import { buildResponseContent } from "../utils/format-response.js";
import { matchElement, describeCriteria, type MatchCriteria } from "../utils/element-matcher.js";
import { describeNearMisses } from "../utils/similar-elements.js";
import { describeForegroundContext } from "../utils/foreground-context.js";
import { findFreePoint } from "../utils/free-point.js";
import { scrollOnce } from "../utils/scroll.js";
import { ACTION } from "../utils/annotations.js";

/**
 * Picks the target among matches. Without an explicit index, clickable matches
 * win: headers/labels often match the same text first in the tree and produce
 * silent no-op taps.
 */
function pickTarget(
  matches: UiElement[],
  explicitIndex: number | undefined,
): UiElement | undefined {
  if (explicitIndex !== undefined) {
    return matches.length > explicitIndex ? matches[explicitIndex] : undefined;
  }
  return matches.find((el) => el.clickable) ?? matches[0];
}

/** Something identifiable for an overlay that often has neither text nor id. */
function describeOverlay(overlay: UiElement): string {
  const name = overlay.text || overlay.resource_id;
  if (name) return `"${name}"`;
  const { x, y, width, height } = overlay.bounds;
  return `a ${overlay.type} at [${x},${y}][${x + width},${y + height}]`;
}

/** Names the app actually on screen when a lookup fails, if it is not ours. */
async function foregroundNote(
  platform: Platform,
  deviceId: string | undefined,
  tree: UiElement[],
): Promise<string> {
  const driver = getDriver(platform);
  const foreground = await driver
    .getForegroundApp(deviceId ?? (await driver.getFirstDeviceId()))
    .catch(() => undefined);
  return describeForegroundContext(foreground?.package, undefined, tree).note;
}

function contains(outer: UiElement, x: number, y: number): boolean {
  return (
    x >= outer.bounds.x &&
    x <= outer.bounds.x + outer.bounds.width &&
    y >= outer.bounds.y &&
    y <= outer.bounds.y + outer.bounds.height
  );
}

/**
 * True when `inner` sits entirely within `outer`. Checked in one direction
 * only: a candidate contained in the target is one of its own children, while
 * one that encloses the target and is drawn later is a scrim over it — the
 * target's ancestors appear before it in the dump, never after.
 */
function isContainedIn(inner: UiElement, outer: UiElement): boolean {
  return (
    inner.bounds.x >= outer.bounds.x &&
    inner.bounds.y >= outer.bounds.y &&
    inner.bounds.x + inner.bounds.width <= outer.bounds.x + outer.bounds.width &&
    inner.bounds.y + inner.bounds.height <= outer.bounds.y + outer.bounds.height
  );
}

/**
 * Finds what would actually receive the tap. Beyond full-screen scrims, any
 * clickable element drawn after the target and overlapping the tap point wins
 * it — React Native's LogBox banner is the everyday case: a thin strip over
 * the bottom of every debug build, which silently eats taps.
 */
function findCoveringOverlay(
  tree: UiElement[],
  target: UiElement,
): UiElement | undefined {
  const targetIndex = tree.indexOf(target);

  return tree.find((el, index) => {
    if (el === target) return false;
    if (!contains(el, target.center_x, target.center_y)) return false;
    if (el.is_overlay) return true;
    // Later in the dump means drawn on top; nested elements are the target's
    // own parents and children, not something covering it.
    return el.clickable && index > targetIndex && !isContainedIn(el, target);
  });
}

export function registerTapElementTool(server: McpServer) {
  server.tool(
    "tap_element",
    "Find a UI element by text, resource_id, or type and tap its center. Combines get_ui_tree + tap in one call. Optionally waits for the element, or scrolls to find it.",
    {
      platform: z.enum(["android", "ios"]).optional().describe(PLATFORM_DESCRIPTION),
      device_id: z
        .string()
        .optional()
        .describe("Device ID. Omit for the connected device."),
      text_contains: z
        .string()
        .optional()
        .describe("Tap element whose text contains this substring (case-insensitive)"),
      text_exact: z
        .string()
        .optional()
        .describe("Tap element whose text matches exactly"),
      resource_id: z
        .string()
        .optional()
        .describe("Tap element whose resource_id contains this substring (case-insensitive). Useful for icon buttons without visible text."),
      index: z
        .number()
        .int()
        .optional()
        .describe("If multiple matches, tap the Nth one (0-based). Default: 0"),
      wait_for: z
        .boolean()
        .optional()
        .describe("If true, poll until the element appears before tapping. Default: false"),
      scroll_to_find: z
        .boolean()
        .optional()
        .describe("If true, scroll iteratively to find the element before tapping. Default: false"),
      scroll_direction: z
        .enum(["down", "up"])
        .optional()
        .describe("Direction to scroll the content when scroll_to_find is true. Default: down"),
      max_scrolls: z
        .number()
        .int()
        .optional()
        .describe("Maximum number of scrolls when scroll_to_find is true. Default: 5"),
      timeout_ms: z
        .number()
        .int()
        .optional()
        .describe("Max wait time when wait_for is true. Default: 10000"),
      observe: z
        .enum(["none", "ui_tree", "screenshot", "both", "on_change"])
        .optional()
        .describe("Capture screen state after tapping. Default: none"),
      observe_delay_ms: z
        .number()
        .int()
        .optional()
        .describe("Ms to wait before observing. Default: 500"),
      observe_stabilize: z
        .boolean()
        .optional()
        .describe("If true, wait for UI to stabilize after tap. Default: false"),
    },
    ACTION,
    uiTreeSafe("tap the element", async ({
      platform: platformArg,
      device_id,
      text_contains,
      text_exact,
      resource_id,
      index: matchIndex,
      wait_for,
      scroll_to_find,
      scroll_direction,
      max_scrolls,
      timeout_ms,
      observe,
      observe_delay_ms,
      observe_stabilize,
    }) => {
      const platform = await resolvePlatform(platformArg);
      const criteria: MatchCriteria = { text_exact, text_contains, resource_id };

      if (!text_contains && !text_exact && !resource_id) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Error: Provide at least one of text_contains, text_exact, or resource_id to identify the element.",
            },
          ],
          isError: true,
        };
      }

      const driver = getDriver(platform);
      const targetIndex = matchIndex ?? 0;
      const timeout = timeout_ms ?? 10_000;

      let target: UiElement | undefined;
      let lastTree: UiElement[] = [];

      if (scroll_to_find) {
        const scrollLimit = max_scrolls ?? defaultScrollLimit();
        for (let i = 0; i <= scrollLimit; i++) {
          lastTree = await driver.getUiTree(device_id);
          const matches = lastTree.filter((el) => matchElement(el, criteria));
          target = pickTarget(matches, matchIndex);
          if (target) break;
          if (i < scrollLimit) {
            await scrollOnce(platform, scroll_direction ?? "down", device_id, lastTree);
            await new Promise((resolve) => setTimeout(resolve, pollIntervalMs()));
          }
        }

        if (!target) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Element not found after ${scrollLimit} scrolls (${describeCriteria(criteria)}).${describeNearMisses(lastTree, criteria)}`,
              },
            ],
            isError: true,
          };
        }
      } else if (wait_for) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
          lastTree = await driver.getUiTree(device_id);
          const matches = lastTree.filter((el) => matchElement(el, criteria));
          target = pickTarget(matches, matchIndex);
          if (target) break;
          await new Promise((resolve) => setTimeout(resolve, pollIntervalMs()));
        }

        if (!target) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Timeout after ${timeout}ms: element not found (${describeCriteria(criteria)})`,
              },
            ],
            isError: true,
          };
        }
      } else {
        lastTree = await driver.getUiTree(device_id);
        const matches = lastTree.filter((el) => matchElement(el, criteria));
        if (matches.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Element not found (${describeCriteria(criteria)}). ${lastTree.length} elements on screen.${await foregroundNote(platform, device_id, lastTree)}${describeNearMisses(lastTree, criteria)}`,
              },
            ],
            isError: true,
          };
        }
        if (matchIndex !== undefined && matches.length <= targetIndex) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Only ${matches.length} match(es) found but index ${targetIndex} requested.`,
              },
            ],
            isError: true,
          };
        }
        target = pickTarget(matches, matchIndex);
        if (!target) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Element not found (${describeCriteria(criteria)}).${describeNearMisses(lastTree, criteria)}`,
              },
            ],
            isError: true,
          };
        }
      }

      const warnings: string[] = [];
      if (!target.clickable) {
        warnings.push(
          "Warning: the matched element is not clickable — the tap may have no effect. If a different element was intended, refine the selector or pass index.",
        );
      }
      if (target.enabled === false) {
        warnings.push(
          "Warning: the element is disabled (enabled=false) — the tap may have no effect.",
        );
      }
      // Aim away from whatever covers the element rather than reporting the
      // problem and tapping into it anyway.
      let tapX = target.center_x;
      let tapY = target.center_y;
      const overlay = findCoveringOverlay(lastTree, target);
      if (overlay && !target.is_overlay) {
        const label = describeOverlay(overlay);
        const free = findFreePoint(target, overlay);
        if (free) {
          tapX = free.x;
          tapY = free.y;
          warnings.push(
            `Note: ${label} covers the element's centre, so the tap was aimed at (${tapX}, ${tapY}) instead — still inside the element, clear of the cover.`,
          );
        } else {
          warnings.push(
            `Warning: ${label} covers this element entirely and will receive the tap. Dismiss it first (dismiss_dev_overlays handles React Native's LogBox).`,
          );
        }
      }

      await driver.tap(tapX, tapY, device_id);

      const observation = await performObservation({
        mode: observe ?? "none",
        platform,
        deviceId: device_id,
        delayMs: observe_delay_ms ?? 500,
        stabilize: observe_stabilize,
        previousTree: lastTree,
      });

      const label = target.text || target.resource_id || target.type;
      const confirmation = [
        `Tapped element "${label}" (${target.type}) at (${tapX}, ${tapY}) on ${platform} device`,
        ...warnings,
      ].join("\n");

      return {
        content: buildResponseContent(confirmation, observation),
      };
    }),
  );
}
