import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as android from "../platforms/android.js";
import * as ios from "../platforms/ios.js";

export function registerListDevicesTool(server: McpServer) {
  server.tool(
    "list_devices",
    "List connected Android and/or iOS devices and emulators/simulators",
    {
      platform: z
        .enum(["android", "ios"])
        .optional()
        .describe("Platform to list devices for. Omit to list both."),
    },
    async ({ platform }) => {
      const results = [];

      if (!platform || platform === "android") {
        try {
          const devices = await android.listDevices();
          results.push(...devices);
        } catch (e: any) {
          results.push({
            id: "error",
            name: `Android error: ${e.message}`,
            platform: "android",
            status: "error",
          });
        }
      }

      if (!platform || platform === "ios") {
        try {
          const devices = await ios.listDevices();
          results.push(...devices);
        } catch (e: any) {
          results.push({
            id: "error",
            name: `iOS error: ${e.message}`,
            platform: "ios",
            status: "error",
          });
        }
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(results, null, 2),
          },
        ],
      };
    },
  );
}
