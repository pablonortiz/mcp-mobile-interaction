import { createHash } from "crypto";
import type { UiElement } from "../types.js";

const MAX_ENTRIES = 32;
const lastEmitted = new Map<string, string>();

export function resetResponseCache(): void {
  lastEmitted.clear();
}

export interface DedupeResult {
  text: string;
  unchanged: boolean;
}

/**
 * Suppresses re-sending a payload identical to the last one under the same key.
 * The tree is still read every time, so "unchanged" is a verified fact about
 * the current screen rather than an assumption from a stale cache — which also
 * makes it safe when more than one server instance drives the same device.
 */
export function dedupeResponse(
  key: string,
  text: string,
  options?: { force?: boolean; summary?: string; anchors?: string[] },
): DedupeResult {
  const digest = hash(text);

  if (!options?.force && lastEmitted.get(key) === digest) {
    // A bare "unchanged" costs a second call to find out what is on screen;
    // a few anchors make the answer self-sufficient and still save ~87%.
    const anchors = (options?.anchors ?? []).filter(Boolean).slice(0, 3);
    const stillShowing = anchors.length
      ? ` Still showing: ${anchors.map((anchor) => `"${anchor}"`).join(", ")}.`
      : "";
    return {
      text: `${options?.summary ?? "Response"} is unchanged since the last read (hash ${digest.slice(0, 8)}). Nothing on screen moved.${stillShowing} Pass force_full: true to receive it in full anyway.`,
      unchanged: true,
    };
  }

  remember(key, digest);
  return { text, unchanged: false };
}

function remember(key: string, digest: string): void {
  // Bounded so a long session cannot grow the map without limit.
  if (lastEmitted.size >= MAX_ENTRIES && !lastEmitted.has(key)) {
    const oldest = lastEmitted.keys().next().value;
    if (oldest) lastEmitted.delete(oldest);
  }
  lastEmitted.set(key, digest);
}

function hash(text: string): string {
  return createHash("sha1").update(text).digest("hex");
}

/** Labels that identify a screen at a glance — actionable ones come first. */
export function pickAnchors(elements: UiElement[]): string[] {
  const labelled = elements.filter((element) => element.text.trim() !== "");
  const actionable = labelled.filter((element) => element.clickable);
  return [...actionable, ...labelled]
    .map((element) => element.text.trim())
    .filter((label, index, all) => all.indexOf(label) === index)
    .slice(0, 3);
}
