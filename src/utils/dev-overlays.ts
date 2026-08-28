import type { PlatformDriver } from "../platforms/driver.js";
import type { UiElement } from "../types.js";
import { matchElement } from "./element-matcher.js";

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

interface DismissTarget {
  center_x: number;
  center_y: number;
  label: string;
}

/**
 * Closes React Native's development overlays. They sit on top of the app and
 * intercept taps aimed at whatever is underneath, so clearing them makes a
 * debug build behave like a release one.
 */
export async function clearDevOverlays(
  driver: PlatformDriver,
  deviceId: string | undefined,
): Promise<string[]> {
  const dismissed: string[] = [];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const tree = await driver.getUiTree(deviceId);
    const control = findDismissControl(tree) ?? findBannerCloseButton(tree);
    if (!control) break;

    await driver.tap(control.center_x, control.center_y, deviceId);
    dismissed.push(control.label);
    await delay(SETTLE_MS);
  }

  return dismissed;
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
