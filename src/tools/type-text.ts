import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  resolvePlatform,
  PLATFORM_DESCRIPTION,
} from "../utils/resolve-platform.js";
import { getDriver } from "../platforms/driver.js";
import { performObservation } from "../utils/observe.js";
import { buildResponseContent } from "../utils/format-response.js";
import { ACTION } from "../utils/annotations.js";
import { verifyTypedText } from "../utils/verify-input.js";

export function registerTypeTextTool(server: McpServer) {
  server.tool(
    "type_text",
    "Type text into the currently focused input field. Full Unicode support: non-ASCII text (accents, emoji) is delivered via clipboard paste on Android.",
    {
      platform: z.enum(["android", "ios"]).optional().describe(PLATFORM_DESCRIPTION),
      device_id: z
        .string()
        .optional()
        .describe("Device ID. Omit to use the first connected device."),
      text: z.string().describe("Text to type"),
      observe: z
        .enum(["none", "ui_tree", "screenshot", "both", "on_change"])
        .optional()
        .describe('Capture screen state after the action. "on_change" returns the first tree that differs from the one before the action — use it to catch a toast or a transient error that a fixed delay would miss. Default: none'),
      observe_delay_ms: z
        .number()
        .int()
        .optional()
        .describe("Ms to wait before observing. Default: 500"),
      observe_stabilize: z
        .boolean()
        .optional()
        .describe("If true, wait for UI to stabilize instead of fixed delay. Default: false"),
      verify: z
        .boolean()
        .optional()
        .describe("Re-read the focused field afterwards and warn if the text did not land. Default: true"),
    },
    ACTION,
    async ({ platform: platformArg, device_id, text, observe, observe_delay_ms, observe_stabilize, verify }) => {
      const platform = await resolvePlatform(platformArg);
      const method = await getDriver(platform).typeText(text, device_id);

      const verification =
        verify === false
          ? undefined
          : await verifyTypedText(
              () => getDriver(platform).getUiTree(device_id),
              text,
            );

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

      const verdict = !verification
        ? ""
        : verification.ok
          ? verification.note
            ? `\n(${verification.note})`
            : "\nVerified: the field now contains this text."
          : `\nWarning: the text did not land — ${verification.note}.`;

      return {
        content: buildResponseContent(
          `Typed "${preview}" on ${platform} device${methodNote}${verdict}`,
          observation,
        ),
        ...(verification && !verification.ok ? { isError: true } : {}),
      };
    },
  );
}
