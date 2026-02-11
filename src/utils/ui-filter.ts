import type { UiElement } from "../types.js";

/**
 * Filters UI tree to only relevant elements, reducing token noise.
 * Default: only elements with non-empty text OR clickable.
 */
export function filterUiElements(
  elements: UiElement[],
  includeAll = false,
): UiElement[] {
  if (includeAll) return elements;

  return elements.filter((el) => el.text.trim() !== "" || el.clickable);
}
