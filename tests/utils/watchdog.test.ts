import { spawn } from "child_process";
import {
  captureAncestry,
  anyAncestorGone,
} from "../../src/utils/watchdog.js";

describe("captureAncestry", () => {
  it("walks up the real process tree", async () => {
    const chain = await captureAncestry(process.pid, 3);
    expect(chain.length).toBeGreaterThan(0);
    expect(chain[0]).toBe(process.ppid);
  });

  it("reaches past the immediate parent", async () => {
    // The npm-installed server runs as client → npm exec → node, so watching
    // only ppid would watch the npm wrapper instead of the client.
    const chain = await captureAncestry(process.pid, 3);
    expect(chain.length).toBeGreaterThan(1);
  });

  it("honours the depth limit", async () => {
    expect((await captureAncestry(process.pid, 1)).length).toBeLessThanOrEqual(1);
  });

  it("stops at init rather than watching pid 1", async () => {
    const chain = await captureAncestry(process.pid, 20);
    expect(chain).not.toContain(1);
    expect(chain).not.toContain(0);
  });

  it("returns nothing for a pid that does not exist", async () => {
    expect(await captureAncestry(2_147_483_646, 3)).toEqual([]);
  });
});

describe("anyAncestorGone", () => {
  it("stays quiet while every ancestor is alive", () => {
    expect(anyAncestorGone([process.pid, process.ppid])).toBe(false);
  });

  it("fires when one of them is gone", async () => {
    const child = spawn("node", ["-e", "setTimeout(() => {}, 50)"]);
    const pid = child.pid!;
    await new Promise((resolve) => child.on("exit", resolve));
    // A dead grandparent must count even when the direct parent is fine.
    expect(anyAncestorGone([process.pid, pid])).toBe(true);
  });

  it("treats an empty chain as healthy", () => {
    expect(anyAncestorGone([])).toBe(false);
  });
});
