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

/** Buttons on an expanded LogBox, in the order they are preferred. */
const DISMISS_LABELS = ["Dismiss", "Minimize"];

/** Text that identifies the collapsed banner, which has no labelled button. */
const BANNER_MARKERS = [
  "open debugger to view warnings",
  "view warnings",
  "log 1 of",
];

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
        const control = findDismissControl(tree) ?? findBannerCloseButton(tree);
        if (!control) break;

        await driver.tap(control.center_x, control.center_y, device_id);
        dismissed.push(control.label);
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

interface DismissTarget {
  center_x: number;
  center_y: number;
  label: string;
}

function findDismissControl(tree: UiElement[]): DismissTarget | undefined {
  for (const label of DISMISS_LABELS) {
    const control = tree.find(
      (element) => element.clickable && matchElement(element, { text_exact: label }),
    );
    if (control) {
      return { center_x: control.center_x, center_y: control.center_y, label };
    }
  }
  return undefined;
}

/**
 * The collapsed warning banner carries no labelled button — its close control
 * is a small unlabelled tap target at the right edge of the banner's bounds.
 */
function findBannerCloseButton(tree: UiElement[]): DismissTarget | undefined {
  const banner = tree.find((element) =>
    BANNER_MARKERS.some((marker) => element.text.toLowerCase().includes(marker)),
  );
  if (!banner) return undefined;

  const bannerRight = banner.bounds.x + banner.bounds.width;
  const closeButton = tree.find(
    (element) =>
      element.clickable &&
      element.text === "" &&
      element.bounds.width < banner.bounds.height &&
      element.center_y >= banner.bounds.y &&
      element.center_y <= banner.bounds.y + banner.bounds.height &&
      element.center_x > bannerRight - banner.bounds.height * 2,
  );

  if (!closeButton) return undefined;
  return {
    center_x: closeButton.center_x,
    center_y: closeButton.center_y,
    label: "warning banner",
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
