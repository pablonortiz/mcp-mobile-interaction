const CHECK_INTERVAL_MS = 10_000;

/**
 * Exits when the MCP client that spawned this server is gone. Without it the
 * server outlives every session that ever started it — 8 orphans were measured
 * on a normal workday machine.
 */
export function startParentWatchdog(
  onExit: () => void | Promise<void>,
  intervalMs = CHECK_INTERVAL_MS,
): NodeJS.Timeout {
  const parentPid = process.ppid;

  const timer = setInterval(() => {
    if (!isParentAlive(parentPid)) {
      void Promise.resolve(onExit()).finally(() => process.exit(0));
    }
  }, intervalMs);

  timer.unref();
  return timer;
}

/** A reparented process (ppid 1) or an unsignalable pid means the client died. */
function isParentAlive(parentPid: number): boolean {
  if (parentPid <= 1 || process.ppid !== parentPid) return false;
  try {
    process.kill(parentPid, 0);
    return true;
  } catch {
    return false;
  }
}
