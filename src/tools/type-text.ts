import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDriver } from "../platforms/driver.js";
import { performObservation } from "../utils/observe.js";
import { buildResponseContent } from "../utils/format-response.js";
import { ACTION } from "../utils/annotations.js";

export function registerTypeTextTool(server: McpServer) {
  server.tool(
    "type_text",
    "Type text into the currently focused input field. Full Unicode support: non-ASCII text (accents, emoji) is delivered via clipboard paste on Android.",
    {
      platform: z.enum(["android", "ios"]).describe("Target platform"),
      device_id: z
        .string()
        .optional()
        .describe("Device ID. Omit to use the first connected device."),
      text: z.string().describe("Text to type"),
      observe: z
        .enum(["none", "ui_tree", "screenshot", "both"])
        .optional()
        .describe("Capture screen state after action. Default: none"),
      observe_delay_ms: z
        .number()
        .int()
        .optional()
        .describe("Ms to wait before observing. Default: 500"),
      observe_stabilize: z
        .boolean()
        .optional()
        .describe("If true, wait for UI to stabilize instead of fixed delay. Default: false"),
    },
    ACTION,
    async ({ platform, device_id, text, observe, observe_delay_ms, observe_stabilize }) => {
      const method = await getDriver(platform).typeText(text, device_id);

      const observation = await performObservation({
        mode: observe ?? "none",
        platform,
        deviceId: device_id,
        delayMs: observe_delay_ms ?? 500,
        stabilize: observe_stabilize,
      });

      const preview = text.length > 80 ? text.slice(0, 80) + "…" : text;
      const methodNote =
        method === "clipboard_paste"
          ? " (delivered via clipboard paste — text contains non-ASCII characters; device clipboard was overwritten)"
          : "";

      return {
        content: buildResponseContent(
          `Typed "${preview}" on ${platform} device${methodNote}`,
          observation,
        ),
      };
    },
  );
}
