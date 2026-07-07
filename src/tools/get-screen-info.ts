import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDriver } from "../platforms/driver.js";
import { READ_ONLY } from "../utils/annotations.js";

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
    READ_ONLY,
    async ({ platform, device_id }) => {
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
