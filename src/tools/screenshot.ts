import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDriver } from "../platforms/driver.js";
import { compressScreenshot, type CropRegion } from "../utils/image.js";
import { matchElement } from "../utils/element-matcher.js";
import { READ_ONLY } from "../utils/annotations.js";

export function registerScreenshotTool(server: McpServer) {
  server.tool(
    "screenshot",
    "Capture a screenshot from an Android or iOS device/emulator/simulator. Returns the image as base64 JPEG. Optionally crop to a specific UI element (token-efficient way to inspect one component).",
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
        .describe("JPEG quality (1-100). Default: 50 (80 when cropping)"),
      scale: z
        .number()
        .min(0.1)
        .max(1.0)
        .optional()
        .describe("Scale factor (0.1-1.0). Default: 0.5 (1.0 when cropping)"),
      crop_resource_id: z
        .string()
        .optional()
        .describe("Crop to the element whose resource_id contains this substring (case-insensitive)"),
      crop_text: z
        .string()
        .optional()
        .describe("Crop to the element whose text contains this substring (case-insensitive)"),
      crop_padding: z
        .number()
        .int()
        .optional()
        .describe("Padding in native pixels around the cropped element. Default: 8"),
    },
    READ_ONLY,
    async ({
      platform,
      device_id,
      quality,
      scale,
      crop_resource_id,
      crop_text,
      crop_padding,
    }) => {
      const driver = getDriver(platform);
      const wantsCrop = Boolean(crop_resource_id || crop_text);

      let region: CropRegion | undefined;
      let cropLabel = "";

      if (wantsCrop) {
        const tree = await driver.getUiTree(device_id);
        const target = tree.find((el) =>
          matchElement(el, {
            resource_id: crop_resource_id,
            text_contains: crop_text,
          }),
        );
        if (!target) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Crop target not found (resource_id: ${crop_resource_id ?? "-"}, text: ${crop_text ?? "-"}).`,
              },
            ],
            isError: true,
          };
        }
        const pad = crop_padding ?? 8;
        region = {
          left: target.bounds.x - pad,
          top: target.bounds.y - pad,
          width: target.bounds.width + pad * 2,
          height: target.bounds.height + pad * 2,
        };
        cropLabel = target.text || target.resource_id || target.type;
      }

      const effectiveScale = scale ?? (wantsCrop ? 1.0 : 0.5);
      const effectiveQuality = quality ?? (wantsCrop ? 80 : 50);

      const rawBuffer = await driver.screenshot(device_id);
      const { base64, width, height, nativeWidth, nativeHeight } =
        await compressScreenshot(rawBuffer, {
          quality: effectiveQuality,
          scale: effectiveScale,
          region,
        });

      const text = wantsCrop
        ? `Screenshot cropped to element "${cropLabel}" (${width}x${height}, native region at ${region!.left},${region!.top}). Image coordinates are relative to the crop, not the screen.`
        : `Screenshot captured (${width}x${height}, scale=${effectiveScale} of native ${nativeWidth}x${nativeHeight}). Coordinate tools (tap, swipe, etc.) expect native resolution — multiply screenshot pixel positions by ${Math.round(1 / effectiveScale)} to convert, or pass screenshot_scale=${effectiveScale}.`;

      return {
        content: [
          {
            type: "image" as const,
            data: base64,
            mimeType: "image/jpeg" as const,
          },
          { type: "text" as const, text },
        ],
      };
    },
  );
}
