import type { UiElement } from "../types.js";

export interface ObservationResult {
  uiTree?: UiElement[];
  screenshot?: { base64: string; width: number; height: number };
}

type ContentItem =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: "image/jpeg" };

/**
 * Builds an MCP response content array combining action confirmation,
 * optional UI tree, and optional screenshot.
 */
export function buildResponseContent(
  confirmationText: string,
  observation?: ObservationResult,
): ContentItem[] {
  const content: ContentItem[] = [
    { type: "text" as const, text: confirmationText },
  ];

  if (!observation) return content;

  if (observation.uiTree) {
    content.push({
      type: "text" as const,
      text: `--- UI Tree (${observation.uiTree.length} elements) ---\n${JSON.stringify(observation.uiTree, null, 2)}`,
    });
  }

  if (observation.screenshot) {
    content.push({
      type: "image" as const,
      data: observation.screenshot.base64,
      mimeType: "image/jpeg" as const,
    });
    content.push({
      type: "text" as const,
      text: `Screenshot captured (${observation.screenshot.width}x${observation.screenshot.height})`,
    });
  }

  return content;
}
