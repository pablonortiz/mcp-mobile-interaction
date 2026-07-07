import type { Platform } from "../types.js";
import { getDriver } from "../platforms/driver.js";

export type ScrollDirection = "down" | "up";

/**
 * Scrolls the content one step in the given direction (finger swipes the
 * opposite way). Used by scroll_to_find in tap_element / find_element.
 */
export async function scrollOnce(
  platform: Platform,
  direction: ScrollDirection = "down",
  deviceId?: string,
): Promise<void> {
  const driver = getDriver(platform);
  const info = await driver.getScreenInfo(deviceId);

  const cx = Math.round(info.width / 2);
  const cy = Math.round(info.height / 2);
  const dist = Math.round(info.height * 0.3);

  if (direction === "down") {
    await driver.swipe(cx, cy + dist, cx, cy - dist, 300, deviceId);
  } else {
    await driver.swipe(cx, cy - dist, cx, cy + dist, 300, deviceId);
  }
}
