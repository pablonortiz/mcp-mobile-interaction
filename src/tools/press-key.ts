import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as android from "../platforms/android.js";
import * as ios from "../platforms/ios.js";
import type { UiElement } from "../types.js";
import { performObservation } from "../utils/observe.js";
import { buildResponseContent } from "../utils/format-response.js";

function hashTree(tree: UiElement[]): string {
  return tree
    .map((e) => `${e.type}|${e.text}|${e.clickable}`)
    .join("\n");
}

export function registerPressKeyTool(server: McpServer) {
  server.tool(
    "press_key",
    "Press a hardware or navigation key on the device (home, back, enter, delete, volume_up, volume_down, power, tab, recent_apps)",
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
          "volume_up",
          "volume_down",
          "power",
          "tab",
          "recent_apps",
        ])
        .describe("Key to press"),
      observe: z
        .enum(["none", "ui_tree", "screenshot", "both"])
        .optional()
        .describe(
          "Capture screen state after action. Default: none",
        ),
      observe_delay_ms: z
        .number()
        .int()
        .optional()
        .describe("Ms to wait before observing. Default: 500"),
      observe_stabilize: z
        .boolean()
        .optional()
        .describe(
          "If true, wait for UI to stabilize instead of fixed delay. Default: false",
        ),
    },
    async ({ platform, device_id, key, observe, observe_delay_ms, observe_stabilize }) => {
      // For back key: snapshot UI before to detect if screen changed
      let beforeHash: string | undefined;
      if (key === "back") {
        try {
          const tree = platform === "android"
            ? await android.getUiTree(device_id)
            : await ios.getUiTree(device_id);
          beforeHash = hashTree(tree);
        } catch {
          // Best-effort
        }
      }

      if (platform === "android") {
        await android.pressKey(key, device_id);
      } else {
        await ios.pressKey(key, device_id);
      }

      const observation = await performObservation({
        mode: observe ?? "none",
        platform,
        deviceId: device_id,
        delayMs: observe_delay_ms ?? 500,
        stabilize: observe_stabilize,
      });

      let confirmText = `Pressed "${key}" on ${platform} device`;

      // For back: detect if screen unchanged and add hint
      if (key === "back" && beforeHash !== undefined) {
        try {
          // Ensure enough time has passed for back to take effect
          if (!observe || observe === "none") {
            await new Promise((resolve) => setTimeout(resolve, 500));
          }

          const afterTree = platform === "android"
            ? await android.getUiTree(device_id)
            : await ios.getUiTree(device_id);
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
