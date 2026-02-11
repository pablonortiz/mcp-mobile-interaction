import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as android from "../platforms/android.js";
import * as ios from "../platforms/ios.js";

export function registerGetScreenInfoTool(server: McpServer) {
  server.tool(
    "get_screen_info",
    "Get screen dimensions, density, and orientation for a device",
    {
      platform: z.enum(["android", "ios"]).describe("Target platform"),
      device_id: z
        .string()
        .optional()
        .describe("Device ID. Omit to use the first connected device."),
    },
    async ({ platform, device_id }) => {
      const info =
        platform === "android"
          ? await android.getScreenInfo(device_id)
          : await ios.getScreenInfo(device_id);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(info, null, 2),
          },
        ],
      };
    },
  );
}
