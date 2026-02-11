import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as android from "../platforms/android.js";
import * as ios from "../platforms/ios.js";
import type { UiElement } from "../types.js";
import { performObservation } from "../utils/observe.js";
import { filterUiElements } from "../utils/ui-filter.js";
import { buildResponseContent } from "../utils/format-response.js";

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
    async ({
      platform,
      device_id,
      text_contains,
      text_exact,
      type_contains,
      clickable,
      timeout_ms,
      poll_interval_ms,
      observe,
    }) => {
      const timeout = timeout_ms ?? 10_000;
      const pollInterval = poll_interval_ms ?? 500;
      const start = Date.now();

      let lastTree: UiElement[] = [];

      while (Date.now() - start < timeout) {
        const tree =
          platform === "android"
            ? await android.getUiTree(device_id)
            : await ios.getUiTree(device_id);

        lastTree = tree;
        const matches = tree.filter((el) => {
          if (text_exact !== undefined && el.text !== text_exact) return false;
          if (
            text_contains !== undefined &&
            !el.text.toLowerCase().includes(text_contains.toLowerCase())
          )
            return false;
          if (
            type_contains !== undefined &&
            !el.type.toLowerCase().includes(type_contains.toLowerCase())
          )
            return false;
          if (clickable !== undefined && el.clickable !== clickable)
            return false;
          return true;
        });

        if (matches.length > 0) {
          const observation = await performObservation({
            mode: observe ?? "none",
            platform,
            deviceId: device_id,
            delayMs: 0,
            stabilize: false,
          });

          const matchText = `Found ${matches.length} matching element(s) after ${Date.now() - start}ms:\n${JSON.stringify(matches, null, 2)}`;

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
            text: `Timeout after ${timeout}ms: no element found matching criteria. Last UI tree (${filtered.length} relevant elements):\n${JSON.stringify(filtered, null, 2)}`,
          },
        ],
        isError: true,
      };
    },
  );
}
