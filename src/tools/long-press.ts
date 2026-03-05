import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as android from "../platforms/android.js";
import * as ios from "../platforms/ios.js";
import { performObservation } from "../utils/observe.js";
import { buildResponseContent } from "../utils/format-response.js";

export function registerLongPressTool(server: McpServer) {
  server.tool(
    "long_press",
    "Long-press at a specific coordinate on the device screen",
    {
      platform: z.enum(["android", "ios"]).describe("Target platform"),
      device_id: z
        .string()
        .optional()
        .describe("Device ID. Omit to use the first connected device."),
      x: z.number().describe("X coordinate to long-press (in native device resolution by default)"),
      y: z.number().describe("Y coordinate to long-press (in native device resolution by default)"),
      screenshot_scale: z
        .number()
        .min(0.1)
        .max(1.0)
        .optional()
        .describe(
          "If coordinates come from a scaled screenshot, provide the scale factor (e.g. 0.5). Coordinates will be auto-converted to native resolution.",
        ),
      duration_ms: z
        .number()
        .int()
        .optional()
        .describe("Duration of the long press in milliseconds. Default: 1000"),
      observe: z
        .enum(["none", "ui_tree", "screenshot", "both"])
        .optional()
        .describe(
          "Capture screen state after action. Default: none",
        ),
      observe_delay_ms: z
        .number()
        .int()
        .optional()
        .describe("Ms to wait before observing. Default: 500"),
      observe_stabilize: z
        .boolean()
        .optional()
        .describe(
          "If true, wait for UI to stabilize instead of fixed delay. Default: false",
        ),
    },
    async ({ platform, device_id, x, y, screenshot_scale, duration_ms, observe, observe_delay_ms, observe_stabilize }) => {
      const duration = duration_ms ?? 1000;
      const nativeX = screenshot_scale ? Math.round(x / screenshot_scale) : Math.round(x);
      const nativeY = screenshot_scale ? Math.round(y / screenshot_scale) : Math.round(y);

      if (platform === "android") {
        await android.longPress(nativeX, nativeY, duration, device_id);
      } else {
        await ios.longPress(nativeX, nativeY, duration, device_id);
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
          `Long-pressed at (${nativeX}, ${nativeY}) for ${duration}ms on ${platform} device${screenshot_scale ? ` (converted from screenshot coords ${x},${y} with scale=${screenshot_scale})` : ""}`,
          observation,
        ),
      };
    },
  );
}
