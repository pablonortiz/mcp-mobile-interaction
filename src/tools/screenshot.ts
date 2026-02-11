import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as android from "../platforms/android.js";
import * as ios from "../platforms/ios.js";
import { compressScreenshot } from "../utils/image.js";

export function registerScreenshotTool(server: McpServer) {
  server.tool(
    "screenshot",
    "Capture a screenshot from an Android or iOS device/emulator/simulator. Returns the image as base64 JPEG.",
    {
      platform: z.enum(["android", "ios"]).describe("Target platform"),
      device_id: z
        .string()
        .optional()
        .describe("Device ID. Omit to use the first connected device."),
      quality: z
        .number()
        .min(1)
        .max(100)
        .optional()
        .describe("JPEG quality (1-100). Default: 50"),
      scale: z
        .number()
        .min(0.1)
        .max(1.0)
        .optional()
        .describe("Scale factor (0.1-1.0). Default: 0.5"),
    },
    async ({ platform, device_id, quality, scale }) => {
      const rawBuffer =
        platform === "android"
          ? await android.screenshot(device_id)
          : await ios.screenshot(device_id);

      const { base64, width, height } = await compressScreenshot(rawBuffer, {
        quality: quality ?? 50,
        scale: scale ?? 0.5,
      });

      return {
        content: [
          {
            type: "image" as const,
            data: base64,
            mimeType: "image/jpeg" as const,
          },
          {
            type: "text" as const,
            text: `Screenshot captured (${width}x${height}, platform: ${platform})`,
          },
        ],
      };
    },
  );
}
