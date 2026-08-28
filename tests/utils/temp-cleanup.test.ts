import { mkdtemp, writeFile, utimes, readdir } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { jest } from "@jest/globals";

const scratch = await mkdtemp(join(tmpdir(), "cleanup-test-"));
jest.unstable_mockModule("os", () => ({ tmpdir: () => scratch }));

const { cleanupOldTempFiles } = await import("../../src/utils/temp-cleanup.js");

async function makeFile(name: string, ageHours: number): Promise<string> {
  const path = join(scratch, name);
  await writeFile(path, "x");
  const when = new Date(Date.now() - ageHours * 3600_000);
  await utimes(path, when, when);
  return path;
}

describe("cleanupOldTempFiles", () => {
  it("removes this server's stale recordings", async () => {
    await makeFile("mcp-recording-emulator-5554-123.mp4", 48);
    expect(await cleanupOldTempFiles()).toBe(1);
    expect(await readdir(scratch)).not.toContain(
      "mcp-recording-emulator-5554-123.mp4",
    );
  });

  it("keeps recent files — a caller may still be reading them", async () => {
    await makeFile("mcp-recording-emulator-5554-456.mp4", 1);
    expect(await cleanupOldTempFiles()).toBe(0);
  });

  it("leaves files that are not ours alone", async () => {
    await makeFile("someone-elses-video.mp4", 72);
    await cleanupOldTempFiles();
    expect(await readdir(scratch)).toContain("someone-elses-video.mp4");
  });

  it("covers screenshots and log dumps too", async () => {
    await makeFile("mcp-screenshot-dev1.png", 48);
    await makeFile("logcat-emulator-5554-999.log", 48);
    expect(await cleanupOldTempFiles()).toBe(2);
  });
});
