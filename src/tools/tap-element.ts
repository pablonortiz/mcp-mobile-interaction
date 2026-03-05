import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as android from "../platforms/android.js";
import * as ios from "../platforms/ios.js";
import type { UiElement } from "../types.js";
import { performObservation } from "../utils/observe.js";
import { buildResponseContent } from "../utils/format-response.js";
import { matchElement, describeCriteria, type MatchCriteria } from "../utils/element-matcher.js";

function getUiTree(platform: string, deviceId?: string) {
  return platform === "android"
    ? android.getUiTree(deviceId)
    : ios.getUiTree(deviceId);
}

function tap(platform: string, x: number, y: number, deviceId?: string) {
  return platform === "android"
    ? android.tap(x, y, deviceId)
    : ios.tap(x, y, deviceId);
}

async function swipeDown(platform: string, deviceId?: string) {
  const screenInfo =
    platform === "android"
      ? await android.getScreenInfo(deviceId)
      : await ios.getScreenInfo(deviceId);

  const cx = Math.round(screenInfo.width / 2);
  const cy = Math.round(screenInfo.height / 2);
  const dist = Math.round(screenInfo.height * 0.3);

  if (platform === "android") {
    await android.swipe(cx, cy + dist, cx, cy - dist, 300, deviceId);
  } else {
    await ios.swipe(cx, cy + dist, cx, cy - dist, 300, deviceId);
  }
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
        .describe("If true, scroll down iteratively to find the element before tapping. Default: false"),
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
    async ({
      platform,
      device_id,
      text_contains,
      text_exact,
      resource_id,
      index: matchIndex,
      wait_for,
      scroll_to_find,
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

      const targetIndex = matchIndex ?? 0;
      const timeout = timeout_ms ?? 10_000;

      let target: UiElement | undefined;

      if (scroll_to_find) {
        // Scroll down iteratively to find element
        const scrollLimit = max_scrolls ?? 5;
        for (let i = 0; i <= scrollLimit; i++) {
          const tree = await getUiTree(platform, device_id);
          const matches = tree.filter((el) => matchElement(el, criteria));
          if (matches.length > targetIndex) {
            target = matches[targetIndex];
            break;
          }
          if (i < scrollLimit) {
            await swipeDown(platform, device_id);
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
        // Poll until element appears
        const start = Date.now();
        while (Date.now() - start < timeout) {
          const tree = await getUiTree(platform, device_id);
          const matches = tree.filter((el) => matchElement(el, criteria));
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
        // Single attempt
        const tree = await getUiTree(platform, device_id);
        const matches = tree.filter((el) => matchElement(el, criteria));
        if (matches.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Element not found (${describeCriteria(criteria)}). ${tree.length} elements on screen.`,
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

      // Tap the element's center
      await tap(platform, target.center_x, target.center_y, device_id);

      const observation = await performObservation({
        mode: observe ?? "none",
        platform,
        deviceId: device_id,
        delayMs: observe_delay_ms ?? 500,
        stabilize: observe_stabilize,
      });

      const label = target.text || target.resource_id || target.type;
      return {
        content: buildResponseContent(
          `Tapped element "${label}" (${target.type}) at (${target.center_x}, ${target.center_y}) on ${platform} device`,
          observation,
        ),
      };
    },
  );
}
