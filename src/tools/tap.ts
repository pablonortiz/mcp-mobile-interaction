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

export function registerTapTool(server: McpServer) {
  server.tool(
    "tap",
    "Tap at a specific coordinate on the device screen",
    {
      platform: z.enum(["android", "ios"]).optional().describe(PLATFORM_DESCRIPTION),
      device_id: z
        .string()
        .optional()
        .describe("Device ID. Omit for the connected device."),
      x: z.number().describe("X coordinate to tap (in native device resolution by default)"),
      y: z.number().describe("Y coordinate to tap (in native device resolution by default)"),
      screenshot_scale: z
        .number()
        .min(0.1)
        .max(1.0)
        .optional()
        .describe(
          "If coordinates come from a scaled screenshot, provide the scale factor (e.g. 0.5). Coordinates will be auto-converted to native resolution.",
        ),
      observe: z
        .enum(["none", "ui_tree", "screenshot", "both", "on_change"])
        .optional()
        .describe('Capture screen state after the action. "on_change" returns the first tree that differs — catches a toast a fixed delay would miss. Default: none'),
      observe_delay_ms: z
        .number()
        .int()
        .optional()
        .describe("Ms to wait before observing. Default: 500"),
      observe_stabilize: z
        .boolean()
        .optional()
        .describe("Wait for the UI to settle instead of a fixed delay. Default: false"),
    },
    ACTION,
    async ({ platform: platformArg, device_id, x, y, screenshot_scale, observe, observe_delay_ms, observe_stabilize }) => {
      const platform = await resolvePlatform(platformArg);
      const nativeX = screenshot_scale ? Math.round(x / screenshot_scale) : Math.round(x);
      const nativeY = screenshot_scale ? Math.round(y / screenshot_scale) : Math.round(y);

      await getDriver(platform).tap(nativeX, nativeY, device_id);

      const observation = await performObservation({
        mode: observe ?? "none",
        platform,
        deviceId: device_id,
        delayMs: observe_delay_ms ?? 500,
        stabilize: observe_stabilize,
      });

      return {
        content: buildResponseContent(
          `Tapped at (${nativeX}, ${nativeY}) on ${platform} device${screenshot_scale ? ` (converted from screenshot coords ${x},${y} with scale=${screenshot_scale})` : ""}`,
          observation,
        ),
      };
    },
  );
}
