import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as android from "../platforms/android.js";
import * as ios from "../platforms/ios.js";
import type { UiElement } from "../types.js";
import { matchElement, describeCriteria, type MatchCriteria } from "../utils/element-matcher.js";

function getUiTree(platform: string, deviceId?: string) {
  return platform === "android"
    ? android.getUiTree(deviceId)
    : ios.getUiTree(deviceId);
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

export function registerFindElementTool(server: McpServer) {
  server.tool(
    "find_element",
    "Find UI elements by text, resource_id, or type without interacting. Returns matching element details (bounds, center, clickable, etc.). Useful for assertions and verifications.",
    {
      platform: z.enum(["android", "ios"]).describe("Target platform"),
      device_id: z
        .string()
        .optional()
        .describe("Device ID. Omit to use the first connected device."),
      text_exact: z
        .string()
        .optional()
        .describe("Find element whose text matches exactly"),
      text_contains: z
        .string()
        .optional()
        .describe("Find element whose text contains this substring (case-insensitive)"),
      resource_id: z
        .string()
        .optional()
        .describe("Find element whose resource_id contains this substring (case-insensitive)"),
      type_contains: z
        .string()
        .optional()
        .describe("Filter by element type containing this substring (case-insensitive)"),
      max_results: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe("Maximum number of matching elements to return. Default: 10"),
      scroll_to_find: z
        .boolean()
        .optional()
        .describe("If true, scroll down iteratively to find the element. Default: false"),
      max_scrolls: z
        .number()
        .int()
        .optional()
        .describe("Maximum number of scrolls when scroll_to_find is true. Default: 5"),
    },
    async ({
      platform,
      device_id,
      text_exact,
      text_contains,
      resource_id,
      type_contains,
      max_results,
      scroll_to_find,
      max_scrolls,
    }) => {
      if (!text_exact && !text_contains && !resource_id && !type_contains) {
        return {
          content: [{
            type: "text" as const,
            text: "Error: Provide at least one of text_exact, text_contains, resource_id, or type_contains.",
          }],
          isError: true,
        };
      }

      const criteria: MatchCriteria = { text_exact, text_contains, resource_id, type_contains };
      const limit = max_results ?? 10;
      let allMatches: UiElement[] = [];

      if (scroll_to_find) {
        const scrollLimit = max_scrolls ?? 5;
        for (let i = 0; i <= scrollLimit; i++) {
          const tree = await getUiTree(platform, device_id);
          const matches = tree.filter((el) => matchElement(el, criteria));
          if (matches.length > 0) {
            allMatches = matches;
            break;
          }
          if (i < scrollLimit) {
            await swipeDown(platform, device_id);
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
        }
      } else {
        const tree = await getUiTree(platform, device_id);
        allMatches = tree.filter((el) => matchElement(el, criteria));
      }

      const results = allMatches.slice(0, limit);
      const criteriaDesc = describeCriteria(criteria);

      if (results.length === 0) {
        return {
          content: [{
            type: "text" as const,
            text: `No elements found matching ${criteriaDesc}.`,
          }],
        };
      }

      const lines = results.map((el, i) =>
        `[${i}] ${el.type} "${el.text}" at (${el.center_x}, ${el.center_y}) - clickable: ${el.clickable}, resource_id: ${el.resource_id ?? "none"}`
      );

      return {
        content: [{
          type: "text" as const,
          text: `Found ${results.length} element(s) matching ${criteriaDesc}:\n\n${lines.join("\n")}`,
        }],
      };
    },
  );
}
