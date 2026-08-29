import { createHash } from "crypto";
import { readFile } from "fs/promises";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { connect } from "net";
import { spawn } from "child_process";
import { run } from "../utils/exec.js";

const REMOTE_JAR = "/data/local/tmp/mcp-uiautomator-daemon.jar";
const DEVICE_PORT = 9008;
const STARTUP_TIMEOUT_MS = 15_000;
const REQUEST_TIMEOUT_MS = 20_000;

interface DaemonHandle {
  localPort: number;
  process: ReturnType<typeof spawn>;
}

const daemons = new Map<string, DaemonHandle>();

/**
 * Devices where the daemon could not run. Without this, a device that cannot
 * host it would pay a failed startup on every single read.
 */
const unavailable = new Map<string, { reason: string; until: number }>();
const RETRY_AFTER_MS = 5 * 60_000;

export function markUnavailable(deviceId: string, reason: string): void {
  unavailable.set(deviceId, { reason, until: Date.now() + RETRY_AFTER_MS });
}

/** Why the daemon is not being used on this device, if it is not. */
export function unavailableReason(deviceId: string): string | undefined {
  const entry = unavailable.get(deviceId);
  if (!entry) return undefined;
  if (Date.now() >= entry.until) {
    unavailable.delete(deviceId);
    return undefined;
  }
  return entry.reason;
}

/** Where the compiled daemon lives inside the published package. */
function jarPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "assets", "uiautomator-daemon.jar");
}

/**
 * Starts the on-device daemon if it is not already running, and returns the
 * local port forwarded to it. The jar is pushed to /data/local/tmp and executed
 * with app_process — no APK is installed, nothing is registered with the
 * package manager, and `rm` undoes it completely.
 */
export async function ensureDaemon(deviceId: string): Promise<number> {
  const blocked = unavailableReason(deviceId);
  if (blocked) throw new Error(`The UI daemon is unavailable on ${deviceId}: ${blocked}`);

  const existing = daemons.get(deviceId);
  if (existing && (await isAlive(existing.localPort))) return existing.localPort;
  if (existing) daemons.delete(deviceId);

  await pushJarIfNeeded(deviceId);

  const child = spawn("adb", [
    "-s",
    deviceId,
    "shell",
    // uiautomator.jar carries UiAutomationShellWrapper, which is where the
    // accessibility connection comes from — the same class the shell command uses.
    `CLASSPATH=${REMOTE_JAR}:/system/framework/uiautomator.jar app_process /system/bin probe.Daemon ${DEVICE_PORT}`,
  ]);
  child.stdout?.setEncoding("utf8");

  await waitForReady(child);
  // Port 0 lets adb pick a free local port: a fixed one is silently stolen by
  // the next device that asks for it, and the two sessions cross wires.
  const forwarded = await run("adb", ["-s", deviceId, "forward", "tcp:0", `tcp:${DEVICE_PORT}`]);
  const localPort = parseInt(forwarded.trim(), 10);

  daemons.set(deviceId, { localPort, process: child });
  return localPort;
}

/** Re-pushes only when the device copy differs from the packaged one. */
async function pushJarIfNeeded(deviceId: string): Promise<void> {
  const local = await readFile(jarPath());
  const localHash = createHash("md5").update(local).digest("hex");

  const remoteHash = await run("adb", ["-s", deviceId, "shell", `md5sum ${REMOTE_JAR} 2>/dev/null || true`])
    .then((out) => out.trim().split(/\s+/)[0])
    .catch(() => "");

  if (remoteHash === localHash) return;
  await run("adb", ["-s", deviceId, "push", jarPath(), REMOTE_JAR], { timeout: 30_000 });
}

function waitForReady(child: ReturnType<typeof spawn>): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("The UI daemon did not report READY in time.")),
      STARTUP_TIMEOUT_MS,
    );
    child.stdout?.on("data", (chunk: string) => {
      if (chunk.includes("READY")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on("exit", () => {
      clearTimeout(timer);
      reject(new Error("The UI daemon exited during startup."));
    });
  });
}

async function isAlive(localPort: number): Promise<boolean> {
  try {
    return (await request(localPort, "ping")).startsWith("PONG");
  } catch {
    return false;
  }
}

/** One request per connection, mirroring the daemon's protocol. */
export function request(localPort: number, line: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(localPort, "127.0.0.1", () => socket.write(`${line}\n`));
    let data = "";
    socket.setTimeout(REQUEST_TIMEOUT_MS);
    socket.on("data", (chunk) => { data += chunk; });
    socket.on("end", () => resolve(data));
    socket.on("timeout", () => { socket.destroy(); reject(new Error("UI daemon request timed out.")); });
    socket.on("error", reject);
  });
}

/** Stops the daemon so other UiAutomator clients can use the device again. */
export async function stopDaemon(deviceId: string): Promise<void> {
  const handle = daemons.get(deviceId);
  if (!handle) return;
  daemons.delete(deviceId);
  await request(handle.localPort, "quit").catch(() => {});
  handle.process.kill();
  await run("adb", ["-s", deviceId, "forward", "--remove", `tcp:${handle.localPort}`]).catch(() => {});
}

export async function stopAllDaemons(): Promise<void> {
  await Promise.all([...daemons.keys()].map((id) => stopDaemon(id)));
}

/**
 * On by default. Reading the screen through the daemon costs ~4ms against
 * ~1900ms for `uiautomator dump`, and it works on screens where the command
 * fails outright ("could not get idle state").
 *
 * Set MCP_MOBILE_FAST_TREE=0 to opt out. The one reason to do so: the daemon
 * holds UiAutomation exclusively, so nothing else on that device can use it
 * while it runs — not Appium, not Maestro, not the shell command.
 */
export function isDaemonEnabled(): boolean {
  return process.env.MCP_MOBILE_FAST_TREE !== "0";
}

/** True once a daemon is running for this device. */
export function hasDaemon(deviceId: string): boolean {
  return daemons.has(deviceId);
}
