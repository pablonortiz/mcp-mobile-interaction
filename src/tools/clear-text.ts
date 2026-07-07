import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDriver } from "../platforms/driver.js";
import { performObservation } from "../utils/observe.js";
import { buildResponseContent } from "../utils/format-response.js";
import { ACTION } from "../utils/annotations.js";

export function registerClearTextTool(server: McpServer) {
  server.tool(
    "clear_text",
    "Clear the currently focused text field. On Android it reads the focused element's text length from the UI tree and deletes accordingly (move to end + backspaces).",
    {
      platform: z.enum(["android", "ios"]).describe("Target platform"),
      device_id: z
        .string()
        .optional()
        .describe("Device ID. Omit to use the first connected device."),
      max_chars: z
        .number()
        .int()
        .min(1)
        .max(250)
        .optional()
        .describe("Fallback number of deletions when the field length cannot be determined. Default: 100 (Android) / 50 (iOS)"),
      observe: z
        .enum(["none", "ui_tree", "screenshot", "both"])
        .optional()
        .describe("Capture screen state after clearing. Default: none"),
      observe_delay_ms: z
        .number()
        .int()
        .optional()
        .describe("Ms to wait before observing. Default: 500"),
    },
    ACTION,
    async ({ platform, device_id, max_chars, observe, observe_delay_ms }) => {
      const deleted = await getDriver(platform).clearTextField(device_id, max_chars);

      const observation = await performObservation({
        mode: observe ?? "none",
        platform,
        deviceId: device_id,
        delayMs: observe_delay_ms ?? 500,
      });

      return {
        content: buildResponseContent(
          `Cleared the focused text field on ${platform} device (~${deleted} deletions sent).`,
          observation,
        ),
      };
    },
  );
}
