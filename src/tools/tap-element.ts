import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDriver } from "../platforms/driver.js";
import type { UiElement } from "../types.js";
import { performObservation } from "../utils/observe.js";
import { buildResponseContent } from "../utils/format-response.js";
import { matchElement, describeCriteria, type MatchCriteria } from "../utils/element-matcher.js";
import { scrollOnce } from "../utils/scroll.js";
import { ACTION } from "../utils/annotations.js";

function findCoveringOverlay(
  tree: UiElement[],
  target: UiElement,
): UiElement | undefined {
  return tree.find(
    (el) =>
      el !== target &&
      el.is_overlay &&
      target.center_x >= el.bounds.x &&
      target.center_x <= el.bounds.x + el.bounds.width &&
      target.center_y >= el.bounds.y &&
      target.center_y <= el.bounds.y + el.bounds.height,
  );
}

export function registerTapElementTool(server: McpServer) {
  server.tool(
    "tap_element",
    "Find a UI element by text, resource_id, or type and tap its center. Combines get_ui_tree + tap in one call. Optionally waits for the element, or scrolls to find it.",
    {
      platform: z.enum(["android", "ios"]).describe("Target platform"),
      device_id: z
        .string()
        .optional()
        .describe("Device ID. Omit to use the first connected device."),
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
        .enum(["none", "ui_tree", "screenshot", "both"])
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
    async ({
      platform,
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
        const scrollLimit = max_scrolls ?? 5;
        for (let i = 0; i <= scrollLimit; i++) {
          lastTree = await driver.getUiTree(device_id);
          const matches = lastTree.filter((el) => matchElement(el, criteria));
          if (matches.length > targetIndex) {
            target = matches[targetIndex];
            break;
          }
          if (i < scrollLimit) {
            await scrollOnce(platform, scroll_direction ?? "down", device_id);
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
        }

        if (!target) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Element not found after ${scrollLimit} scrolls (${describeCriteria(criteria)}).`,
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
          if (matches.length > targetIndex) {
            target = matches[targetIndex];
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 500));
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
                text: `Element not found (${describeCriteria(criteria)}). ${lastTree.length} elements on screen.`,
              },
            ],
            isError: true,
          };
        }
        if (matches.length <= targetIndex) {
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
        target = matches[targetIndex];
      }

      const warnings: string[] = [];
      if (target.enabled === false) {
        warnings.push(
          "Warning: the element is disabled (enabled=false) — the tap may have no effect.",
        );
      }
      const overlay = findCoveringOverlay(lastTree, target);
      if (overlay && !target.is_overlay) {
        warnings.push(
          `Warning: an overlay/scrim (${overlay.resource_id ?? "unnamed"}) covers this element — the tap may hit the overlay instead. Dismiss it first if the tap has no effect.`,
        );
      }

      // Tap the element's center
      await driver.tap(target.center_x, target.center_y, device_id);

      const observation = await performObservation({
        mode: observe ?? "none",
        platform,
        deviceId: device_id,
        delayMs: observe_delay_ms ?? 500,
        stabilize: observe_stabilize,
      });

      const label = target.text || target.resource_id || target.type;
      const confirmation = [
        `Tapped element "${label}" (${target.type}) at (${target.center_x}, ${target.center_y}) on ${platform} device`,
        ...warnings,
      ].join("\n");

      return {
        content: buildResponseContent(confirmation, observation),
      };
    },
  );
}
