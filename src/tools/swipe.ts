import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as android from "../platforms/android.js";
import * as ios from "../platforms/ios.js";
import { performObservation } from "../utils/observe.js";
import { buildResponseContent } from "../utils/format-response.js";

export function registerSwipeTool(server: McpServer) {
  server.tool(
    "swipe",
    "Swipe on the device screen. Provide explicit coordinates or a direction (up/down/left/right) to auto-compute from screen center.",
    {
      platform: z.enum(["android", "ios"]).describe("Target platform"),
      device_id: z
        .string()
        .optional()
        .describe("Device ID. Omit to use the first connected device."),
      start_x: z
        .number()
        .optional()
        .describe("Start X coordinate in native device resolution. Required if direction is not set."),
      start_y: z
        .number()
        .optional()
        .describe("Start Y coordinate in native device resolution. Required if direction is not set."),
      end_x: z
        .number()
        .optional()
        .describe("End X coordinate in native device resolution. Required if direction is not set."),
      end_y: z
        .number()
        .optional()
        .describe("End Y coordinate in native device resolution. Required if direction is not set."),
      screenshot_scale: z
        .number()
        .min(0.1)
        .max(1.0)
        .optional()
        .describe(
          "If coordinates come from a scaled screenshot, provide the scale factor (e.g. 0.5). Coordinates will be auto-converted to native resolution.",
        ),
      direction: z
        .enum(["up", "down", "left", "right"])
        .optional()
        .describe(
          "Swipe direction. Auto-computes coordinates from screen center. Overrides explicit coordinates.",
        ),
      duration_ms: z
        .number()
        .int()
        .optional()
        .describe("Duration of the swipe in milliseconds. Default: 300"),
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
    async ({
      platform,
      device_id,
      start_x,
      start_y,
      end_x,
      end_y,
      screenshot_scale,
      direction,
      duration_ms,
      observe,
      observe_delay_ms,
      observe_stabilize,
    }) => {
      const duration = duration_ms ?? 300;
      const scaleFn = (v: number) => screenshot_scale ? Math.round(v / screenshot_scale) : Math.round(v);
      let sx: number, sy: number, ex: number, ey: number;

      if (direction) {
        // Auto-compute coordinates based on screen info
        const screenInfo =
          platform === "android"
            ? await android.getScreenInfo(device_id)
            : await ios.getScreenInfo(device_id);

        const cx = Math.round(screenInfo.width / 2);
        const cy = Math.round(screenInfo.height / 2);
        const distX = Math.round(screenInfo.width * 0.3);
        const distY = Math.round(screenInfo.height * 0.3);

        switch (direction) {
          case "up":
            sx = cx; sy = cy + distY; ex = cx; ey = cy - distY;
            break;
          case "down":
            sx = cx; sy = cy - distY; ex = cx; ey = cy + distY;
            break;
          case "left":
            sx = cx + distX; sy = cy; ex = cx - distX; ey = cy;
            break;
          case "right":
            sx = cx - distX; sy = cy; ex = cx + distX; ey = cy;
            break;
        }
      } else {
        if (
          start_x === undefined ||
          start_y === undefined ||
          end_x === undefined ||
          end_y === undefined
        ) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: Provide either direction or all four coordinates (start_x, start_y, end_x, end_y).",
              },
            ],
            isError: true,
          };
        }
        sx = scaleFn(start_x);
        sy = scaleFn(start_y);
        ex = scaleFn(end_x);
        ey = scaleFn(end_y);
      }

      if (platform === "android") {
        await android.swipe(sx, sy, ex, ey, duration, device_id);
      } else {
        await ios.swipe(sx, sy, ex, ey, duration, device_id);
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
          `Swiped from (${sx}, ${sy}) to (${ex}, ${ey}) over ${duration}ms on ${platform} device`,
          observation,
        ),
      };
    },
  );
}
