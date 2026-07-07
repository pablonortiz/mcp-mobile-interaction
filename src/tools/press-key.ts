import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDriver } from "../platforms/driver.js";
import type { UiElement } from "../types.js";
import { performObservation } from "../utils/observe.js";
import { buildResponseContent } from "../utils/format-response.js";
import { ACTION } from "../utils/annotations.js";

function hashTree(tree: UiElement[]): string {
  return tree
    .map((e) => `${e.type}|${e.text}|${e.clickable}`)
    .join("\n");
}

export function registerPressKeyTool(server: McpServer) {
  server.tool(
    "press_key",
    "Press a hardware or navigation key on the device (home, back, enter, delete, paste, volume_up, volume_down, power, tab, recent_apps, menu, escape, search, camera, media_play_pause) or send a raw Android keycode. Supports repeat for multiple presses in one call.",
    {
      platform: z.enum(["android", "ios"]).describe("Target platform"),
      device_id: z
        .string()
        .optional()
        .describe("Device ID. Omit to use the first connected device."),
      key: z
        .enum([
          "home",
          "back",
          "enter",
          "delete",
          "paste",
          "volume_up",
          "volume_down",
          "power",
          "tab",
          "recent_apps",
          "menu",
          "escape",
          "search",
          "camera",
          "media_play_pause",
        ])
        .optional()
        .describe("Key to press. Either key or keycode must be provided."),
      keycode: z
        .number()
        .int()
        .min(0)
        .max(999)
        .optional()
        .describe("Android keycode number (0-999). Use for keys not in the named list. See https://developer.android.com/reference/android/view/KeyEvent. Ignored on iOS."),
      repeat: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe("Press the key this many times (e.g. delete x10). Default: 1"),
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
    async ({ platform, device_id, key, keycode, repeat, observe, observe_delay_ms, observe_stabilize }) => {
      if (!key && keycode === undefined) {
        return {
          content: [{ type: "text" as const, text: "Error: Provide at least one of key or keycode." }],
          isError: true,
        };
      }

      const driver = getDriver(platform);

      // For back key: snapshot UI before to detect if screen changed
      let beforeHash: string | undefined;
      if (key === "back") {
        try {
          beforeHash = hashTree(await driver.getUiTree(device_id));
        } catch {
          // Best-effort
        }
      }

      await driver.pressKey(key, device_id, keycode, repeat ?? 1);

      const observation = await performObservation({
        mode: observe ?? "none",
        platform,
        deviceId: device_id,
        delayMs: observe_delay_ms ?? 500,
        stabilize: observe_stabilize,
      });

      const keyLabel = key ?? `keycode(${keycode})`;
      const repeatLabel = repeat && repeat > 1 ? ` x${repeat}` : "";
      let confirmText = `Pressed "${keyLabel}"${repeatLabel} on ${platform} device`;

      // For back: detect if screen unchanged and add hint
      if (key === "back" && beforeHash !== undefined) {
        try {
          if (!observe || observe === "none") {
            await new Promise((resolve) => setTimeout(resolve, 500));
          }

          const afterTree = await driver.getUiTree(device_id);
          const afterHash = hashTree(afterTree);

          if (beforeHash === afterHash) {
            const overlay = afterTree.find((el) => el.is_overlay);
            if (overlay) {
              confirmText += `\nScreen unchanged after back press — an overlay/scrim was detected (${overlay.resource_id ?? "unnamed"} at ${overlay.center_x},${overlay.center_y}). Tap it to dismiss the modal or bottom sheet.`;
            } else {
              confirmText += "\nScreen unchanged after back press — a modal or bottom sheet may be open. Try tapping outside it to dismiss.";
            }
          }
        } catch {
          // Best-effort
        }
      }

      return {
        content: buildResponseContent(confirmText, observation),
      };
    },
  );
}
