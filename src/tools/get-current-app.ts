import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDriver } from "../platforms/driver.js";
import { READ_ONLY } from "../utils/annotations.js";

export function registerGetCurrentAppTool(server: McpServer) {
  server.tool(
    "get_current_app",
    "Get the app (package + activity) currently in the foreground. Useful for asserting navigation and deep link results. Android only.",
    {
      platform: z.enum(["android", "ios"]).describe("Target platform"),
      device_id: z
        .string()
        .optional()
        .describe("Device ID. Omit to use the first connected device."),
    },
    READ_ONLY,
    async ({ platform, device_id }) => {
      const driver = getDriver(platform);
      const deviceId = device_id ?? (await driver.getFirstDeviceId());

      const app = await driver.getForegroundApp(deviceId);

      return {
        content: [{
          type: "text" as const,
          text: `Foreground app on ${platform} device ${deviceId}: ${app.package}${app.activity ? ` (${app.activity})` : ""}`,
        }],
      };
    },
  );
}
