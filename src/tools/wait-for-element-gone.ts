import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as android from "../platforms/android.js";
import * as ios from "../platforms/ios.js";
import { performObservation } from "../utils/observe.js";
import { buildResponseContent } from "../utils/format-response.js";
import { matchElement, hasCriteria, describeCriteria, type MatchCriteria } from "../utils/element-matcher.js";

export function registerWaitForElementGoneTool(server: McpServer) {
  server.tool(
    "wait_for_element_gone",
    "Poll the UI tree until an element matching the criteria disappears from screen. Useful for waiting until loading indicators, skeletons, or dialogs go away.",
    {
      platform: z.enum(["android", "ios"]).describe("Target platform"),
      device_id: z
        .string()
        .optional()
        .describe("Device ID. Omit to use the first connected device."),
      text_contains: z
        .string()
        .optional()
        .describe("Wait for element with this text substring to disappear (case-insensitive)"),
      text_exact: z
        .string()
        .optional()
        .describe("Wait for element with this exact text to disappear"),
      resource_id: z
        .string()
        .optional()
        .describe("Wait for element with this resource_id substring to disappear (case-insensitive)"),
      type_contains: z
        .string()
        .optional()
        .describe("Filter by element type containing this substring (case-insensitive)"),
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
        .describe("Capture screen state after element disappears. Default: none"),
    },
    async ({
      platform,
      device_id,
      text_contains,
      text_exact,
      resource_id,
      type_contains,
      timeout_ms,
      poll_interval_ms,
      observe,
    }) => {
      const criteria: MatchCriteria = {
        text_exact,
        text_contains,
        resource_id,
        type_contains,
      };

      if (!hasCriteria(criteria)) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Error: Provide at least one criterion (text_contains, text_exact, resource_id, or type_contains).",
            },
          ],
          isError: true,
        };
      }

      const timeout = timeout_ms ?? 10_000;
      const pollInterval = poll_interval_ms ?? 500;
      const start = Date.now();

      while (Date.now() - start < timeout) {
        const tree =
          platform === "android"
            ? await android.getUiTree(device_id)
            : await ios.getUiTree(device_id);

        const matches = tree.filter((el) => matchElement(el, criteria));

        if (matches.length === 0) {
          const elapsed = Date.now() - start;

          const observation = await performObservation({
            mode: observe ?? "none",
            platform,
            deviceId: device_id,
            delayMs: 0,
            stabilize: false,
          });

          return {
            content: buildResponseContent(
              `Element gone after ${elapsed}ms (${describeCriteria(criteria)})`,
              observation,
            ),
          };
        }

        await new Promise((resolve) => setTimeout(resolve, pollInterval));
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `Timeout after ${timeout}ms: element still present (${describeCriteria(criteria)}).`,
          },
        ],
        isError: true,
      };
    },
  );
}
