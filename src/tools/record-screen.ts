import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  resolvePlatform,
  PLATFORM_DESCRIPTION,
} from "../utils/resolve-platform.js";
import { getDriver } from "../platforms/driver.js";
import * as android from "../platforms/android.js";
import { ACTION } from "../utils/annotations.js";

export function registerRecordScreenTool(server: McpServer) {
  server.tool(
    "record_screen",
    'Record the device screen to an mp4 file. action "start" begins recording (Android caps at 180s), action "stop" finalizes it and returns the local file path. Useful for bug repro evidence.',
    {
      platform: z.enum(["android", "ios"]).optional().describe(PLATFORM_DESCRIPTION),
      device_id: z
        .string()
        .optional()
        .describe("Device ID. Omit for the connected device."),
      action: z
        .enum(["start", "stop", "status"])
        .describe('"start" to begin recording, "stop" to finish and retrieve the video, "status" to check without changing anything'),
      force: z
        .boolean()
        .optional()
        .describe("With action \"start\": discard a recording already in progress instead of failing. Default: false"),
    },
    ACTION,
    async ({ platform: platformArg, device_id, action, force }) => {
      const platform = await resolvePlatform(platformArg);
      const driver = getDriver(platform);

      if (action === "status") {
        const deviceId = device_id ?? (await driver.getFirstDeviceId());
        const recording =
          platform === "android"
            ? await android.isRecordingOnDevice(deviceId)
            : false;
        return {
          content: [{
            type: "text" as const,
            text: recording
              ? `A recording is in progress on ${deviceId}. Use action: "stop" to finalize it, or action: "start" with force: true to discard it.`
              : `No recording in progress on ${deviceId}.`,
          }],
        };
      }

      if (action === "start") {
        const deviceId = await driver.startRecording(device_id, force);
        return {
          content: [{
            type: "text" as const,
            text: `Screen recording started on ${platform} device ${deviceId}${platform === "android" ? " (max 180 seconds)" : ""}. Call record_screen with action: "stop" to finish and get the video file.`,
          }],
        };
      }

      const path = await driver.stopRecording(device_id);
      return {
        content: [{
          type: "text" as const,
          text: `Screen recording stopped. Video saved to: ${path}`,
        }],
      };
    },
  );
}
