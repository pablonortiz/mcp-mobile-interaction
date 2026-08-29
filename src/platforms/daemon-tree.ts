import type { UiElement } from "../types.js";
import { annotateOverlays } from "../utils/overlay-detect.js";
import { isIconGlyph } from "../utils/xml.js";

/**
 * Parses the daemon's line protocol into the same shape the XML parser
 * produces, so callers cannot tell which source served the tree.
 *
 * Line: depth|class|text|resourceId|contentDesc|clickable|enabled|focused|scrollable|l,t,r,b
 */
export function parseDaemonTree(payload: string): UiElement[] {
  const lines = payload.split("\n");
  const elements: UiElement[] = [];

  for (const line of lines.slice(1)) {
    const element = parseLine(line);
    if (element) elements.push(element);
  }
  return annotateOverlays(elements);
}

function parseLine(line: string): UiElement | undefined {
  if (!line.trim()) return undefined;
  const parts = line.split("|");
  if (parts.length < 10) return undefined;

  const [, className, text, resourceId, contentDesc, clickable, enabled, focused, scrollable, bounds] = parts;
  const [left, top, right, bottom] = bounds.split(",").map(Number);
  if ([left, top, right, bottom].some(Number.isNaN)) return undefined;

  return {
    // The XML path merges text and content-desc into one field; matching all
    // over the codebase depends on that, so the daemon path merges it too.
    text: displayText(text, contentDesc),
    type: shortType(className),
    resource_id: resourceId || undefined,
    clickable: clickable === "true",
    enabled: enabled === "true",
    focused: focused === "true",
    ...(scrollable === "true" ? { scrollable: true } : {}),
    bounds: { x: left, y: top, width: right - left, height: bottom - top },
    center_x: Math.round((left + right) / 2),
    center_y: Math.round((top + bottom) / 2),
  } as UiElement;
}

function displayText(text: string, contentDesc: string): string {
  const clean = isIconGlyph(text) ? "" : text;
  if (clean && contentDesc) return `${clean}, ${contentDesc}`;
  return clean || (isIconGlyph(contentDesc) ? "" : contentDesc) || "";
}

/** `android.widget.TextView` → `TextView`, matching the XML parser's output. */
function shortType(className: string): string {
  const parts = className.split(".");
  return parts[parts.length - 1] || className;
}
