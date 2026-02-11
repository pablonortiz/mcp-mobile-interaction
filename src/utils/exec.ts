import { exec as cpExec } from "child_process";

const DEFAULT_TIMEOUT = 15_000;

export function exec(
  command: string,
  options?: { timeout?: number; maxBuffer?: number },
): Promise<string> {
  const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
  const maxBuffer = options?.maxBuffer ?? 10 * 1024 * 1024; // 10 MB

  return new Promise((resolve, reject) => {
    cpExec(command, { timeout, maxBuffer }, (error, stdout, stderr) => {
      if (error) {
        const msg = stderr?.trim() || error.message;
        reject(new Error(`Command failed: ${command}\n${msg}`));
        return;
      }
      resolve(stdout);
    });
  });
}

export function execBuffer(
  command: string,
  options?: { timeout?: number; maxBuffer?: number },
): Promise<Buffer> {
  const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
  const maxBuffer = options?.maxBuffer ?? 10 * 1024 * 1024;

  return new Promise((resolve, reject) => {
    cpExec(
      command,
      { timeout, maxBuffer, encoding: "buffer" },
      (error, stdout, stderr) => {
        if (error) {
          const msg = stderr?.toString().trim() || error.message;
          reject(new Error(`Command failed: ${command}\n${msg}`));
          return;
        }
        resolve(stdout);
      },
    );
  });
}
