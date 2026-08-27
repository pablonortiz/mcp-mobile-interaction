import { createHash } from "crypto";

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
  options?: { force?: boolean; summary?: string },
): DedupeResult {
  const digest = hash(text);

  if (!options?.force && lastEmitted.get(key) === digest) {
    return {
      text: `${options?.summary ?? "Response"} is unchanged since the last read (hash ${digest.slice(0, 8)}). Nothing on screen moved. Pass force_full: true to receive it in full anyway.`,
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
