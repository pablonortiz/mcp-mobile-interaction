import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  resolvePlatform,
  PLATFORM_DESCRIPTION,
} from "../utils/resolve-platform.js";
import { getDriver } from "../platforms/driver.js";
import { resolveDeviceId } from "../utils/resolve-device.js";
import { READ_ONLY } from "../utils/annotations.js";

export function registerGetCurrentAppTool(server: McpServer) {
  server.tool(
    "get_current_app",
    "Get the app (package + activity) currently in the foreground. Useful for asserting navigation and deep link results. Android only.",
    {
      platform: z.enum(["android", "ios"]).optional().describe(PLATFORM_DESCRIPTION),
      device_id: z
        .string()
        .optional()
        .describe("Device ID. Omit for the connected device."),
    },
    READ_ONLY,
    async ({ platform: platformArg, device_id }) => {
      const platform = await resolvePlatform(platformArg);
      const driver = getDriver(platform);
      const deviceId = await resolveDeviceId(platform, device_id);

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
