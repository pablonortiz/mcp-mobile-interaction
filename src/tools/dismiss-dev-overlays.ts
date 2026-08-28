import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  resolvePlatform,
  PLATFORM_DESCRIPTION,
} from "../utils/resolve-platform.js";
import { getDriver } from "../platforms/driver.js";
import { clearDevOverlays } from "../utils/dev-overlays.js";
import { ACTION } from "../utils/annotations.js";

export function registerDismissDevOverlaysTool(server: McpServer) {
  server.tool(
    "dismiss_dev_overlays",
    "Close React Native development overlays (LogBox error/warning boxes and the warning banner) that sit on top of the app. They intercept taps aimed at whatever is underneath, so clearing them first makes a debug build behave like a release one.",
    {
      platform: z.enum(["android", "ios"]).optional().describe(PLATFORM_DESCRIPTION),
      device_id: z
        .string()
        .optional()
        .describe("Device ID. Omit to use the first connected device."),
    },
    ACTION,
    async ({ platform: platformArg, device_id }) => {
      const platform = await resolvePlatform(platformArg);
      const dismissed = await clearDevOverlays(getDriver(platform), device_id);

      return {
        content: [{
          type: "text" as const,
          text:
            dismissed.length === 0
              ? `No development overlays on screen — nothing is intercepting taps on ${platform} device.`
              : `Dismissed ${dismissed.length} development overlay(s) on ${platform} device: ${dismissed.join(", ")}. The app's own UI is now on top.`,
        }],
      };
    },
  );
}
