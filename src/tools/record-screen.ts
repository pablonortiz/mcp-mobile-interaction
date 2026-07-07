import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDriver } from "../platforms/driver.js";
import { ACTION } from "../utils/annotations.js";

export function registerRecordScreenTool(server: McpServer) {
  server.tool(
    "record_screen",
    'Record the device screen to an mp4 file. action "start" begins recording (Android caps at 180s), action "stop" finalizes it and returns the local file path. Useful for bug repro evidence.',
    {
      platform: z.enum(["android", "ios"]).describe("Target platform"),
      device_id: z
        .string()
        .optional()
        .describe("Device ID. Omit to use the first connected device."),
      action: z
        .enum(["start", "stop"])
        .describe('"start" to begin recording, "stop" to finish and retrieve the video'),
    },
    ACTION,
    async ({ platform, device_id, action }) => {
      const driver = getDriver(platform);

      if (action === "start") {
        const deviceId = await driver.startRecording(device_id);
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
