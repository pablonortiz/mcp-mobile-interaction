import type { Platform, UiElement } from "../types.js";
import { getDriver } from "../platforms/driver.js";

export type ScrollDirection = "down" | "up";

/**
 * Scrolls the content one step in the given direction (finger swipes the
 * opposite way). Used by scroll_to_find in tap_element / find_element.
 *
 * The swipe lands inside the largest scrollable container rather than at the
 * centre of the screen: a list that does not occupy the middle — a side panel,
 * a sheet, a carousel — would otherwise never move, or the wrong one would.
 */
export async function scrollOnce(
  platform: Platform,
  direction: ScrollDirection = "down",
  deviceId?: string,
  tree?: UiElement[],
): Promise<void> {
  const driver = getDriver(platform);
  const info = await driver.getScreenInfo(deviceId);

  const area = scrollableArea(tree) ?? {
    x: 0,
    y: 0,
    width: info.width,
    height: info.height,
  };

  const cx = Math.round(area.x + area.width / 2);
  const cy = Math.round(area.y + area.height / 2);
  const dist = Math.round(area.height * 0.3);

  if (direction === "down") {
    await driver.swipe(cx, cy + dist, cx, cy - dist, 300, deviceId);
  } else {
    await driver.swipe(cx, cy - dist, cx, cy + dist, 300, deviceId);
  }
}

/** Bounds of the largest scrollable element, when the tree names one. */
function scrollableArea(tree?: UiElement[]): UiElement["bounds"] | undefined {
  if (!tree?.length) return undefined;

  const scrollables = tree
    .filter((element) => element.scrollable)
    .sort(
      (first, second) =>
        second.bounds.width * second.bounds.height -
        first.bounds.width * first.bounds.height,
    );

  return scrollables[0]?.bounds;
}
