import { jest } from "@jest/globals";
import { exec, execBuffer } from "../../src/utils/exec.js";

describe("exec", () => {
  it("resolves with stdout for a successful command", async () => {
    const result = await exec("echo hello");
    expect(result).toContain("hello");
  });

  it("rejects when command fails", async () => {
    await expect(exec("nonexistent_cmd_xyz_123")).rejects.toThrow(
      /Command failed/
    );
  });

  it("rejects when command times out", async () => {
    await expect(
      exec("sleep 10", { timeout: 100 })
    ).rejects.toThrow();
  });

  it("uses default timeout of 15s when not specified", async () => {
    // Just verify it doesn't throw for a fast command
    const result = await exec("echo ok");
    expect(result).toContain("ok");
  });
});

describe("execBuffer", () => {
  it("resolves with a Buffer for a successful command", async () => {
    const result = await execBuffer("echo binary");
    expect(Buffer.isBuffer(result)).toBe(true);
  });

  it("rejects when command fails", async () => {
    await expect(execBuffer("nonexistent_cmd_xyz_456")).rejects.toThrow(
      /Command failed/
    );
  });
});
