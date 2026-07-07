import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDriver } from "../platforms/driver.js";
import type { UiElement } from "../types.js";
import { performObservation } from "../utils/observe.js";
import { filterUiElements } from "../utils/ui-filter.js";
import { formatUiTree } from "../utils/format-ui.js";
import { buildResponseContent } from "../utils/format-response.js";
import { matchElement, describeCriteria, type MatchCriteria } from "../utils/element-matcher.js";
import { READ_ONLY } from "../utils/annotations.js";

export function registerWaitForElementTool(server: McpServer) {
  server.tool(
    "wait_for_element",
    "Poll the UI tree until an element matching the criteria appears on screen. Returns matched elements and optionally the full UI tree or screenshot.",
    {
      platform: z.enum(["android", "ios"]).describe("Target platform"),
      device_id: z
        .string()
        .optional()
        .describe("Device ID. Omit to use the first connected device."),
      text_contains: z
        .string()
        .optional()
        .describe("Wait for element whose text contains this substring (case-insensitive)"),
      text_exact: z
        .string()
        .optional()
        .describe("Wait for element whose text matches exactly"),
      resource_id: z
        .string()
        .optional()
        .describe("Wait for element whose resource_id contains this substring (case-insensitive)"),
      type_contains: z
        .string()
        .optional()
        .describe("Filter by element type containing this substring (case-insensitive)"),
      clickable: z
        .boolean()
        .optional()
        .describe("If set, only match elements with this clickable state"),
      timeout_ms: z
        .number()
        .int()
        .optional()
        .describe("Maximum time to wait in ms. Default: 10000"),
      poll_interval_ms: z
        .number()
        .int()
        .optional()
        .describe("Polling interval in ms. Default: 500"),
      observe: z
        .enum(["none", "ui_tree", "screenshot", "both"])
        .optional()
        .describe("Additional observation after element found. Default: none"),
    },
    READ_ONLY,
    async ({
      platform,
      device_id,
      text_contains,
      text_exact,
      resource_id,
      type_contains,
      clickable,
      timeout_ms,
      poll_interval_ms,
      observe,
    }) => {
      const driver = getDriver(platform);
      const timeout = timeout_ms ?? 10_000;
      const pollInterval = poll_interval_ms ?? 500;
      const start = Date.now();
      const criteria: MatchCriteria = {
        text_exact,
        text_contains,
        resource_id,
        type_contains,
        clickable,
      };

      let lastTree: UiElement[] = [];

      while (Date.now() - start < timeout) {
        const tree = await driver.getUiTree(device_id);

        lastTree = tree;
        const matches = tree.filter((el) => matchElement(el, criteria));

        if (matches.length > 0) {
          const observation = await performObservation({
            mode: observe ?? "none",
            platform,
            deviceId: device_id,
            delayMs: 0,
            stabilize: false,
          });

          const matchText = `Found ${matches.length} matching element(s) after ${Date.now() - start}ms:\n${formatUiTree(matches, "Matches")}`;

          return {
            content: buildResponseContent(matchText, observation),
          };
        }

        await new Promise((resolve) => setTimeout(resolve, pollInterval));
      }

      // Timeout — return error with last UI tree for debugging
      const filtered = filterUiElements(lastTree);
      return {
        content: [
          {
            type: "text" as const,
            text: `Timeout after ${timeout}ms: no element found matching criteria (${describeCriteria(criteria)}). ${formatUiTree(filtered, "Last UI tree")}`,
          },
        ],
        isError: true,
      };
    },
  );
}
