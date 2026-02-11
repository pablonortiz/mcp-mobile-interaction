import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as android from "../platforms/android.js";
import * as ios from "../platforms/ios.js";
import type { UiElement } from "../types.js";
import { performObservation } from "../utils/observe.js";
import { buildResponseContent } from "../utils/format-response.js";

export function registerTapElementTool(server: McpServer) {
  server.tool(
    "tap_element",
    "Find a UI element by text and tap its center. Combines get_ui_tree + tap in one call. Optionally waits for the element to appear first.",
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
      index: z
        .number()
        .int()
        .optional()
        .describe("If multiple matches, tap the Nth one (0-based). Default: 0"),
      wait_for: z
        .boolean()
        .optional()
        .describe("If true, poll until the element appears before tapping. Default: false"),
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
      index: matchIndex,
      wait_for,
      timeout_ms,
      observe,
      observe_delay_ms,
      observe_stabilize,
    }) => {
      if (!text_contains && !text_exact) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Error: Provide either text_contains or text_exact to identify the element.",
            },
          ],
          isError: true,
        };
      }

      const targetIndex = matchIndex ?? 0;
      const timeout = timeout_ms ?? 10_000;

      function matchElement(el: UiElement): boolean {
        if (text_exact !== undefined && el.text !== text_exact) return false;
        if (
          text_contains !== undefined &&
          !el.text.toLowerCase().includes(text_contains.toLowerCase())
        )
          return false;
        return true;
      }

      let target: UiElement | undefined;

      if (wait_for) {
        // Poll until element appears
        const start = Date.now();
        while (Date.now() - start < timeout) {
          const tree =
            platform === "android"
              ? await android.getUiTree(device_id)
              : await ios.getUiTree(device_id);

          const matches = tree.filter(matchElement);
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
                text: `Timeout after ${timeout}ms: element not found (text_contains: "${text_contains ?? ""}", text_exact: "${text_exact ?? ""}")`,
              },
            ],
            isError: true,
          };
        }
      } else {
        // Single attempt
        const tree =
          platform === "android"
            ? await android.getUiTree(device_id)
            : await ios.getUiTree(device_id);

        const matches = tree.filter(matchElement);
        if (matches.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Element not found (text_contains: "${text_contains ?? ""}", text_exact: "${text_exact ?? ""}"). ${tree.length} elements on screen.`,
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
      if (platform === "android") {
        await android.tap(target.center_x, target.center_y, device_id);
      } else {
        await ios.tap(target.center_x, target.center_y, device_id);
      }

      const observation = await performObservation({
        mode: observe ?? "none",
        platform,
        deviceId: device_id,
        delayMs: observe_delay_ms ?? 500,
        stabilize: observe_stabilize,
      });

      return {
        content: buildResponseContent(
          `Tapped element "${target.text}" (${target.type}) at (${target.center_x}, ${target.center_y}) on ${platform} device`,
          observation,
        ),
      };
    },
  );
}
