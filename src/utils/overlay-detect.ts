import type { UiElement } from "../types.js";

const OVERLAY_ID_KEYWORDS = [
  "scrim",
  "overlay",
  "backdrop",
  "dim",
  "touch_outside",
  "modal_barrier",
  "sheet_background",
  "bottom_sheet_overlay",
];

const CONTAINER_TYPES = [
  "view",
  "framelayout",
  "relativelayout",
  "constraintlayout",
  "linearlayout",
  "coordinatorlayout",
  "other",
];

/**
 * Annotates elements that look like overlay/scrim layers (used to dismiss
 * modals and bottom sheets by tapping outside).
 *
 * Detection heuristic:
 * 1. resource_id contains a known overlay keyword, OR
 * 2. clickable + no text + container type + covers >60% of inferred screen area
 */
export function annotateOverlays(elements: UiElement[]): UiElement[] {
  if (elements.length === 0) return elements;

  // Infer screen dimensions from max element bounds
  let maxRight = 0;
  let maxBottom = 0;
  for (const el of elements) {
    const right = el.bounds.x + el.bounds.width;
    const bottom = el.bounds.y + el.bounds.height;
    if (right > maxRight) maxRight = right;
    if (bottom > maxBottom) maxBottom = bottom;
  }

  if (maxRight === 0 || maxBottom === 0) return elements;
  const screenArea = maxRight * maxBottom;

  return elements.map((el) => {
    // Check resource_id keywords
    if (el.resource_id) {
      const idLower = el.resource_id.toLowerCase();
      if (OVERLAY_ID_KEYWORDS.some((kw) => idLower.includes(kw))) {
        return { ...el, is_overlay: true };
      }
    }

    // Geometric + type heuristic
    const area = el.bounds.width * el.bounds.height;
    const coverageRatio = area / screenArea;
    const isContainerType = CONTAINER_TYPES.some((t) =>
      el.type.toLowerCase().includes(t),
    );

    if (
      el.clickable &&
      el.text === "" &&
      isContainerType &&
      coverageRatio > 0.6
    ) {
      return { ...el, is_overlay: true };
    }

    return el;
  });
}
