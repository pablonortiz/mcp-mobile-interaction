import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDriver } from "../platforms/driver.js";
import type { UiElement } from "../types.js";
import { matchElement, describeCriteria, type MatchCriteria } from "../utils/element-matcher.js";
import { formatUiElements, UI_LINE_FORMAT } from "../utils/format-ui.js";
import { scrollOnce } from "../utils/scroll.js";
import { READ_ONLY } from "../utils/annotations.js";

export function registerFindElementTool(server: McpServer) {
  server.tool(
    "find_element",
    "Find UI elements by text, resource_id, or type without interacting. Returns matching element details (center, size, state flags). Useful for assertions and verifications.",
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
        .describe("If true, scroll iteratively to find the element. Default: false"),
      scroll_direction: z
        .enum(["down", "up"])
        .optional()
        .describe("Direction to scroll the content when scroll_to_find is true. Default: down"),
      max_scrolls: z
        .number()
        .int()
        .optional()
        .describe("Maximum number of scrolls when scroll_to_find is true. Default: 5"),
    },
    READ_ONLY,
    async ({
      platform,
      device_id,
      text_exact,
      text_contains,
      resource_id,
      type_contains,
      max_results,
      scroll_to_find,
      scroll_direction,
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

      const driver = getDriver(platform);
      const criteria: MatchCriteria = { text_exact, text_contains, resource_id, type_contains };
      const limit = max_results ?? 10;
      let allMatches: UiElement[] = [];

      if (scroll_to_find) {
        const scrollLimit = max_scrolls ?? 5;
        for (let i = 0; i <= scrollLimit; i++) {
          const tree = await driver.getUiTree(device_id);
          const matches = tree.filter((el) => matchElement(el, criteria));
          if (matches.length > 0) {
            allMatches = matches;
            break;
          }
          if (i < scrollLimit) {
            await scrollOnce(platform, scroll_direction ?? "down", device_id);
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
        }
      } else {
        const tree = await driver.getUiTree(device_id);
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

      return {
        content: [{
          type: "text" as const,
          text: `Found ${results.length} element(s) matching ${criteriaDesc} (${UI_LINE_FORMAT}):\n${formatUiElements(results)}`,
        }],
      };
    },
  );
}
