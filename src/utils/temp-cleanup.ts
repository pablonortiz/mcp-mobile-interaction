import { readdir, stat, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const OWNED_PREFIXES = ["mcp-recording-", "mcp-screenshot-", "logcat-"];

/**
 * Deletes this server's own leftovers in the temp directory. Recordings are
 * handed to the caller as a path and never cleaned up afterwards — 226 MB from
 * a single day's session were found sitting there, one file of 131 MB.
 */
export async function cleanupOldTempFiles(
  maxAgeMs = MAX_AGE_MS,
): Promise<number> {
  const directory = tmpdir();
  let removed = 0;

  try {
    const entries = await readdir(directory);
    const cutoff = Date.now() - maxAgeMs;

    for (const entry of entries) {
      if (!OWNED_PREFIXES.some((prefix) => entry.startsWith(prefix))) continue;
      const path = join(directory, entry);
      try {
        const info = await stat(path);
        if (info.mtimeMs >= cutoff) continue;
        await unlink(path);
        removed++;
      } catch {
        // Another instance may have removed it, or it may not be ours to touch.
      }
    }
  } catch {
    // No temp directory access — nothing to clean.
  }

  return removed;
}
