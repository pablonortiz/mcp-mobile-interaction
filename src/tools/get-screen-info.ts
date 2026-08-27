import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  resolvePlatform,
  PLATFORM_DESCRIPTION,
} from "../utils/resolve-platform.js";
import { getDriver } from "../platforms/driver.js";
import { READ_ONLY } from "../utils/annotations.js";

export function registerGetScreenInfoTool(server: McpServer) {
  server.tool(
    "get_screen_info",
    "Get screen dimensions, density, and orientation for a device",
    {
      platform: z.enum(["android", "ios"]).optional().describe(PLATFORM_DESCRIPTION),
      device_id: z
        .string()
        .optional()
        .describe("Device ID. Omit to use the first connected device."),
    },
    READ_ONLY,
    async ({ platform: platformArg, device_id }) => {
      const platform = await resolvePlatform(platformArg);
      const info = await getDriver(platform).getScreenInfo(device_id);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(info),
          },
        ],
      };
    },
  );
}
