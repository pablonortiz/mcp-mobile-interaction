import { execFile } from "child_process";

const CHECK_INTERVAL_MS = 10_000;

/**
 * How far up the process tree to watch. The real client is not the immediate
 * parent: an npm-installed server runs as `claude → npm exec <pkg> → node`, so
 * watching only ppid means the server survives its client and keeps running
 * under an orphaned npm wrapper. Three levels reach the client without
 * climbing into the terminal or the shell, which can legitimately outlive it.
 */
const ANCESTRY_DEPTH = 3;

/**
 * Exits when the MCP client that spawned this server is gone. Without it the
 * server outlives every session that ever started it.
 */
export async function startParentWatchdog(
  onExit: () => void | Promise<void>,
  intervalMs = CHECK_INTERVAL_MS,
): Promise<NodeJS.Timeout | undefined> {
  const ancestry = await captureAncestry(process.pid, ANCESTRY_DEPTH);
  if (ancestry.length === 0) return undefined;

  const timer = setInterval(() => {
    if (anyAncestorGone(ancestry)) {
      void Promise.resolve(onExit()).finally(() => process.exit(0));
    }
  }, intervalMs);

  timer.unref();
  return timer;
}

/** The chain of ancestor pids above `pid`, closest first, stopping at init. */
export async function captureAncestry(
  pid: number,
  depth: number,
): Promise<number[]> {
  const chain: number[] = [];
  let current = pid;

  for (let level = 0; level < depth; level++) {
    const parent = await parentOf(current);
    if (parent === undefined || parent <= 1) break;
    chain.push(parent);
    current = parent;
  }
  return chain;
}

function parentOf(pid: number): Promise<number | undefined> {
  return new Promise((resolve) => {
    execFile("ps", ["-o", "ppid=", "-p", String(pid)], (error, stdout) => {
      if (error) return resolve(undefined);
      const parsed = parseInt(stdout.trim(), 10);
      resolve(Number.isNaN(parsed) ? undefined : parsed);
    });
  });
}

/** True once any watched ancestor is gone — the client chain has broken. */
export function anyAncestorGone(ancestry: number[]): boolean {
  return ancestry.some((pid) => !isAlive(pid));
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
