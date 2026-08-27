import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  resolvePlatform,
  PLATFORM_DESCRIPTION,
} from "../utils/resolve-platform.js";
import { getDriver } from "../platforms/driver.js";
import { performObservation } from "../utils/observe.js";
import { buildResponseContent } from "../utils/format-response.js";
import { ACTION } from "../utils/annotations.js";

export function registerOpenUrlTool(server: McpServer) {
  server.tool(
    "open_url",
    "Open a URL (including deep links with query params) on the device",
    {
      platform: z.enum(["android", "ios"]).optional().describe(PLATFORM_DESCRIPTION),
      device_id: z
        .string()
        .optional()
        .describe("Device ID. Omit to use the first connected device."),
      url: z.string().describe("URL to open (supports deep links)"),
      observe: z
        .enum(["none", "ui_tree", "screenshot", "both", "on_change"])
        .optional()
        .describe('Capture screen state after the action. "on_change" returns the first tree that differs from the one before the action — use it to catch a toast or a transient error that a fixed delay would miss. Default: none'),
      observe_delay_ms: z
        .number()
        .int()
        .optional()
        .describe("Ms to wait before observing. Default: 500"),
      observe_stabilize: z
        .boolean()
        .optional()
        .describe("If true, wait for UI to stabilize instead of fixed delay. Default: false"),
    },
    ACTION,
    async ({ platform: platformArg, device_id, url, observe, observe_delay_ms, observe_stabilize }) => {
      const platform = await resolvePlatform(platformArg);
      await getDriver(platform).openUrl(url, device_id);

      const observation = await performObservation({
        mode: observe ?? "none",
        platform,
        deviceId: device_id,
        delayMs: observe_delay_ms ?? 500,
        stabilize: observe_stabilize,
      });

      return {
        content: buildResponseContent(
          `Opened "${url}" on ${platform} device`,
          observation,
        ),
      };
    },
  );
}
