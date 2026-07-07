import type { UiElement } from "../types.js";

const DEFAULT_MAX_ELEMENTS = 120;

export const UI_LINE_FORMAT =
  'format: [n] Type "text" @(center_x,center_y) WxH #resource_id flags';

export function formatUiElement(el: UiElement): string {
  const parts = [
    `[${el.index}]`,
    el.type,
    `"${el.text}"`,
    `@(${el.center_x},${el.center_y})`,
    `${el.bounds.width}x${el.bounds.height}`,
  ];
  if (el.resource_id) parts.push(`#${el.resource_id}`);

  const flags: string[] = [];
  if (el.clickable) flags.push("clickable");
  if (el.enabled === false) flags.push("disabled");
  if (el.focused) flags.push("focused");
  if (el.is_overlay) flags.push("overlay");
  if (flags.length > 0) parts.push(flags.join(","));

  return parts.join(" ");
}

/**
 * Compact one-line-per-element rendering of a UI tree. Roughly 4x fewer
 * tokens than pretty-printed JSON, which matters on every observe call.
 */
export function formatUiElements(
  elements: UiElement[],
  maxElements: number = DEFAULT_MAX_ELEMENTS,
): string {
  const shown = elements.slice(0, maxElements);
  const lines = shown.map(formatUiElement);
  const hidden = elements.length - shown.length;
  if (hidden > 0) {
    lines.push(
      `… +${hidden} more elements (narrow with only_clickable, only_with_text, type_filter or resource_id_contains)`,
    );
  }
  return lines.join("\n");
}

export function formatUiTree(
  elements: UiElement[],
  label = "UI elements",
  maxElements?: number,
): string {
  return `${label} (${elements.length}; ${UI_LINE_FORMAT}):\n${formatUiElements(elements, maxElements)}`;
}
