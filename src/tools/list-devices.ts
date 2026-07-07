import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDriver } from "../platforms/driver.js";
import type { Device, Platform } from "../types.js";
import { READ_ONLY } from "../utils/annotations.js";

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
    READ_ONLY,
    async ({ platform }) => {
      const platforms: Platform[] = platform ? [platform] : ["android", "ios"];
      const results: Device[] = [];

      for (const p of platforms) {
        try {
          results.push(...(await getDriver(p).listDevices()));
        } catch (e: any) {
          results.push({
            id: "error",
            name: `${p} error: ${e.message}`,
            platform: p,
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
