import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  resolvePlatform,
  PLATFORM_DESCRIPTION,
} from "../utils/resolve-platform.js";
import * as android from "../platforms/android.js";
import { getDriver } from "../platforms/driver.js";
import { performObservation } from "../utils/observe.js";
import { buildResponseContent } from "../utils/format-response.js";
import { ACTION } from "../utils/annotations.js";

export function registerRotateDeviceTool(server: McpServer) {
  server.tool(
    "rotate_device",
    "Rotate the device screen to a fixed orientation (disables auto-rotate). Android only.",
    {
      platform: z.enum(["android", "ios"]).optional().describe(PLATFORM_DESCRIPTION),
      device_id: z
        .string()
        .optional()
        .describe("Device ID. Omit for the connected device."),
      orientation: z
        .enum(["portrait", "landscape", "reverse_portrait", "reverse_landscape"])
        .describe("Target orientation"),
      observe: z
        .enum(["none", "screenshot"])
        .optional()
        .describe("Capture screenshot after rotating. Default: none"),
    },
    ACTION,
    async ({ platform: platformArg, device_id, orientation, observe }) => {
      const platform = await resolvePlatform(platformArg);
      if (platform === "ios") {
        return {
          content: [{
            type: "text" as const,
            text: "Rotating iOS simulators is not supported via CLI (use Simulator.app: Device > Rotate). This feature is only available on Android.",
          }],
          isError: true,
        };
      }

      const deviceId = device_id ?? (await getDriver(platform).getFirstDeviceId());
      await android.rotate(deviceId, orientation);

      const observation = observe === "screenshot"
        ? await performObservation({
            mode: "screenshot",
            platform,
            deviceId,
            delayMs: 800,
          })
        : undefined;

      return {
        content: buildResponseContent(
          `Rotated Android device ${deviceId} to ${orientation} (auto-rotate disabled).`,
          observation,
        ),
      };
    },
  );
}
