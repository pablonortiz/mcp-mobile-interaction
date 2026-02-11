import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as android from "../platforms/android.js";
import * as ios from "../platforms/ios.js";

export function registerGetUiTreeTool(server: McpServer) {
  server.tool(
    "get_ui_tree",
    "Get a simplified flat list of UI elements on the current screen. Each element includes type, text, bounds, center coordinates (for tapping), and whether it is clickable.",
    {
      platform: z.enum(["android", "ios"]).describe("Target platform"),
      device_id: z
        .string()
        .optional()
        .describe("Device ID. Omit to use the first connected device."),
    },
    async ({ platform, device_id }) => {
      const elements =
        platform === "android"
          ? await android.getUiTree(device_id)
          : await ios.getUiTree(device_id);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(elements, null, 2),
          },
        ],
      };
    },
  );
}
