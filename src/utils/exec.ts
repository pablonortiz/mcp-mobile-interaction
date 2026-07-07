import { execFile, spawn, type ChildProcess } from "child_process";

const DEFAULT_TIMEOUT = 15_000;
const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024; // 10 MB

export interface RunOptions {
  timeout?: number;
  maxBuffer?: number;
  stdin?: string;
}

/**
 * Runs a command without a local shell (execFile) and resolves with stdout.
 * Arguments are passed verbatim — no local quoting/escaping needed.
 */
export function run(
  file: string,
  args: string[],
  options?: RunOptions,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      file,
      args,
      {
        timeout: options?.timeout ?? DEFAULT_TIMEOUT,
        maxBuffer: options?.maxBuffer ?? DEFAULT_MAX_BUFFER,
      },
      (error, stdout, stderr) => {
        if (error) {
          const msg = stderr?.trim() || error.message;
          reject(new Error(`Command failed: ${file} ${args.join(" ")}\n${msg}`));
          return;
        }
        resolve(stdout);
      },
    );
    writeStdin(child, options?.stdin);
  });
}

export function runBuffer(
  file: string,
  args: string[],
  options?: RunOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      file,
      args,
      {
        timeout: options?.timeout ?? DEFAULT_TIMEOUT,
        maxBuffer: options?.maxBuffer ?? DEFAULT_MAX_BUFFER,
        encoding: "buffer",
      },
      (error, stdout, stderr) => {
        if (error) {
          const msg = stderr?.toString().trim() || error.message;
          reject(new Error(`Command failed: ${file} ${args.join(" ")}\n${msg}`));
          return;
        }
        resolve(stdout);
      },
    );
    writeStdin(child, options?.stdin);
  });
}

/**
 * Spawns a long-lived process (e.g. screen recording) and returns the handle.
 */
export function spawnProc(file: string, args: string[]): ChildProcess {
  return spawn(file, args, { stdio: ["ignore", "pipe", "pipe"] });
}

/**
 * Quotes a value for the REMOTE shell (`adb shell` re-interprets its joined
 * arguments on the device). execFile already bypasses the local shell; this
 * protects text/URLs containing &, $, quotes, etc. from the device-side shell.
 */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function writeStdin(child: ChildProcess, stdin?: string): void {
  if (stdin === undefined || !child.stdin) return;
  child.stdin.write(stdin);
  child.stdin.end();
}
