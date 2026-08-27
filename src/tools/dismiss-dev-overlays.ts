import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  resolvePlatform,
  PLATFORM_DESCRIPTION,
} from "../utils/resolve-platform.js";
import { getDriver } from "../platforms/driver.js";
import { matchElement } from "../utils/element-matcher.js";
import { ACTION } from "../utils/annotations.js";
import type { UiElement } from "../types.js";

const MAX_ROUNDS = 8;
const SETTLE_MS = 400;

/** Controls that close React Native's LogBox, in the order they are preferred. */
const DISMISS_LABELS = ["Dismiss", "Minimize"];

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
      const driver = getDriver(platform);

      const dismissed: string[] = [];

      for (let round = 0; round < MAX_ROUNDS; round++) {
        const tree = await driver.getUiTree(device_id);
        const control = findDismissControl(tree);
        if (!control) break;

        await driver.tap(control.center_x, control.center_y, device_id);
        dismissed.push(control.text);
        await delay(SETTLE_MS);
      }

      if (dismissed.length === 0) {
        return {
          content: [{
            type: "text" as const,
            text: `No development overlays on screen — nothing is intercepting taps on ${platform} device.`,
          }],
        };
      }

      return {
        content: [{
          type: "text" as const,
          text: `Dismissed ${dismissed.length} development overlay(s) on ${platform} device: ${dismissed.join(", ")}. The app's own UI is now on top.`,
        }],
      };
    },
  );
}

function findDismissControl(tree: UiElement[]): UiElement | undefined {
  for (const label of DISMISS_LABELS) {
    const control = tree.find(
      (element) =>
        element.clickable &&
        matchElement(element, { text_exact: label }),
    );
    if (control) return control;
  }
  return undefined;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
