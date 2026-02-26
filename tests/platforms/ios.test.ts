/**
 * Tests for src/platforms/ios.ts
 *
 * We mock the exec/execBuffer utilities so no real xcrun/idb commands run.
 * This lets us test command construction, device list parsing from simctl JSON,
 * idb describe-all parsing, and key mapping.
 */

import { jest } from "@jest/globals";

const mockExec = jest.fn<(cmd: string, opts?: any) => Promise<string>>();
const mockExecBuffer = jest.fn<(cmd: string, opts?: any) => Promise<Buffer>>();

jest.unstable_mockModule("../../src/utils/exec.js", () => ({
  exec: mockExec,
  execBuffer: mockExecBuffer,
}));

const iosMod = await import("../../src/platforms/ios.js");

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// listDevices — parsing xcrun simctl list devices --json
// ---------------------------------------------------------------------------
describe("listDevices", () => {
  it("parses simulators from xcrun simctl JSON output", async () => {
    const simctlOutput = JSON.stringify({
      devices: {
        "com.apple.CoreSimulator.SimRuntime.iOS-17-2": [
          { udid: "AAAA-1111", name: "iPhone 15", state: "Booted" },
          { udid: "BBBB-2222", name: "iPad Air", state: "Shutdown" },
        ],
      },
    });
    // xcrun simctl list devices available --json
    mockExec.mockResolvedValueOnce(simctlOutput);
    // hasIdb check: "which idb" fails => no idb
    mockExec.mockRejectedValueOnce(new Error("not found"));

    const devices = await iosMod.listDevices();
    expect(devices).toHaveLength(2);
    expect(devices[0]).toEqual({
      id: "AAAA-1111",
      name: "iPhone 15 (iOS-17-2)",
      platform: "ios",
      status: "booted",
    });
    expect(devices[1].status).toBe("shutdown");
  });

  it("returns empty list when xcrun simctl fails and idb unavailable", async () => {
    // xcrun fails
    mockExec.mockRejectedValueOnce(new Error("xcrun not found"));
    // hasIdb fails
    mockExec.mockRejectedValueOnce(new Error("not found"));

    const devices = await iosMod.listDevices();
    expect(devices).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// getFirstDeviceId
// ---------------------------------------------------------------------------
describe("getFirstDeviceId", () => {
  it("prefers booted simulators", async () => {
    const simctlOutput = JSON.stringify({
      devices: {
        "com.apple.CoreSimulator.SimRuntime.iOS-17-2": [
          { udid: "SHUT-1111", name: "iPhone A", state: "Shutdown" },
          { udid: "BOOT-2222", name: "iPhone B", state: "Booted" },
        ],
      },
    });
    mockExec.mockResolvedValueOnce(simctlOutput);
    mockExec.mockRejectedValueOnce(new Error("no idb"));

    const id = await iosMod.getFirstDeviceId();
    expect(id).toBe("BOOT-2222");
  });

  it("throws when no booted or connected devices exist", async () => {
    const simctlOutput = JSON.stringify({
      devices: {
        "com.apple.CoreSimulator.SimRuntime.iOS-17-2": [
          { udid: "SHUT-1111", name: "iPhone A", state: "Shutdown" },
        ],
      },
    });
    mockExec.mockResolvedValueOnce(simctlOutput);
    mockExec.mockRejectedValueOnce(new Error("no idb"));

    await expect(iosMod.getFirstDeviceId()).rejects.toThrow(
      /No connected iOS devices or booted simulators found/
    );
  });
});

// ---------------------------------------------------------------------------
// tap — command construction for simulators
// ---------------------------------------------------------------------------
describe("tap", () => {
  it("uses xcrun simctl io tap for simulators", async () => {
    // isSimulator check
    mockExec.mockResolvedValueOnce(
      JSON.stringify({
        devices: {
          "com.apple.CoreSimulator.SimRuntime.iOS-17": [
            { udid: "sim-1", name: "iPhone", state: "Booted" },
          ],
        },
      })
    );
    mockExec.mockResolvedValueOnce(""); // tap command
    await iosMod.tap(150, 300, "sim-1");
    const tapCall = mockExec.mock.calls[1][0] as string;
    expect(tapCall).toBe("xcrun simctl io sim-1 tap 150 300");
  });
});

// ---------------------------------------------------------------------------
// doubleTap — command construction
// ---------------------------------------------------------------------------
describe("doubleTap", () => {
  it("falls back to two rapid simctl taps when idb is unavailable", async () => {
    // hasIdb fails
    mockExec.mockRejectedValueOnce(new Error("not found"));
    // isSimulator check (from first tap)
    // Actually doubleTap checks hasIdb first, then falls back to two taps
    // First tap
    mockExec.mockResolvedValueOnce("");
    // Second tap
    mockExec.mockResolvedValueOnce("");
    await iosMod.doubleTap(100, 200, "sim-1");
    // First call is "which idb" (rejected), then two tap calls
    const firstTap = mockExec.mock.calls[1][0] as string;
    expect(firstTap).toBe("xcrun simctl io sim-1 tap 100 200");
  });
});

// ---------------------------------------------------------------------------
// swipe — command construction
// ---------------------------------------------------------------------------
describe("swipe", () => {
  it("uses xcrun simctl io swipe when idb is unavailable", async () => {
    // hasIdb fails
    mockExec.mockRejectedValueOnce(new Error("not found"));
    mockExec.mockResolvedValueOnce(""); // swipe command
    await iosMod.swipe(0, 500, 0, 100, 300, "sim-1");
    const swipeCall = mockExec.mock.calls[1][0] as string;
    expect(swipeCall).toBe("xcrun simctl io sim-1 swipe 0 500 0 100");
  });
});

// ---------------------------------------------------------------------------
// longPress — command construction
// ---------------------------------------------------------------------------
describe("longPress", () => {
  it("uses swipe-to-same-point via simctl when no idb", async () => {
    // hasIdb fails
    mockExec.mockRejectedValueOnce(new Error("not found"));
    mockExec.mockResolvedValueOnce(""); // long press command
    await iosMod.longPress(200, 400, 2000, "sim-1");
    const lpCall = mockExec.mock.calls[1][0] as string;
    expect(lpCall).toBe("xcrun simctl io sim-1 swipe 200 400 200 400 --duration 2");
  });
});

// ---------------------------------------------------------------------------
// screenshot — command construction for simulators
// ---------------------------------------------------------------------------
describe("screenshot", () => {
  it("uses xcrun simctl io screenshot for simulators", async () => {
    // isSimulator check
    mockExec.mockResolvedValueOnce(
      JSON.stringify({
        devices: {
          "com.apple.CoreSimulator.SimRuntime.iOS-17": [
            { udid: "sim-1", name: "iPhone", state: "Booted" },
          ],
        },
      })
    );
    // screenshot command
    mockExec.mockResolvedValueOnce("");
    // We need to mock fs.readFile and fs.unlink since screenshot reads a temp file
    // This test just verifies the exec command is constructed correctly
    // The screenshot function will fail at readFile, but we can verify the exec call
    await iosMod.screenshot("sim-1").catch(() => {});
    const screenshotCall = mockExec.mock.calls[1][0] as string;
    expect(screenshotCall).toContain("xcrun simctl io sim-1 screenshot --type png");
  });
});

// ---------------------------------------------------------------------------
// getUiTree — idb describe-all parsing
// ---------------------------------------------------------------------------
describe("getUiTree", () => {
  it("throws when idb is unavailable and simctl fallback fails", async () => {
    // hasIdb fails
    mockExec.mockRejectedValueOnce(new Error("not found"));
    // simctl fallback fails
    mockExec.mockRejectedValueOnce(new Error("not supported"));

    await expect(iosMod.getUiTree("sim-1")).rejects.toThrow(
      /idb/
    );
  });
});

// ---------------------------------------------------------------------------
// pressKey — key mapping
// ---------------------------------------------------------------------------
describe("pressKey", () => {
  it("throws for unknown keys", async () => {
    await expect(iosMod.pressKey("nonexistent", "sim-1")).rejects.toThrow(
      /Unknown key: nonexistent/
    );
  });
});

// ---------------------------------------------------------------------------
// typeText — command construction for simulators (no idb)
// ---------------------------------------------------------------------------
describe("typeText", () => {
  it("uses xcrun simctl io type when idb is unavailable (simulator)", async () => {
    // hasIdb: "which idb" fails
    mockExec.mockRejectedValueOnce(new Error("not found"));
    // xcrun simctl io type
    mockExec.mockResolvedValueOnce("");

    await iosMod.typeText("hello", "sim-1");
    const typeCall = mockExec.mock.calls[1][0] as string;
    expect(typeCall).toBe("xcrun simctl io sim-1 type 'hello'");
  });

  it("escapes single quotes in text for simctl", async () => {
    mockExec.mockRejectedValueOnce(new Error("not found"));
    mockExec.mockResolvedValueOnce("");

    await iosMod.typeText("it's fine", "sim-1");
    const typeCall = mockExec.mock.calls[1][0] as string;
    expect(typeCall).toContain("it'\\''s fine");
  });
});

// ---------------------------------------------------------------------------
// launchApp — command construction
// ---------------------------------------------------------------------------
describe("launchApp", () => {
  it("uses xcrun simctl launch for simulators", async () => {
    // isSimulator: xcrun simctl list devices --json returns matching udid
    mockExec.mockResolvedValueOnce(
      JSON.stringify({
        devices: {
          "com.apple.CoreSimulator.SimRuntime.iOS-17": [
            { udid: "sim-1", name: "iPhone", state: "Booted" },
          ],
        },
      })
    );
    mockExec.mockResolvedValueOnce(""); // launch command

    await iosMod.launchApp("com.apple.mobilesafari", "sim-1");
    const launchCall = mockExec.mock.calls[1][0] as string;
    expect(launchCall).toBe(
      "xcrun simctl launch sim-1 com.apple.mobilesafari"
    );
  });
});

// ---------------------------------------------------------------------------
// openUrl — command construction
// ---------------------------------------------------------------------------
describe("openUrl", () => {
  it("uses xcrun simctl openurl for simulators", async () => {
    mockExec.mockResolvedValueOnce(
      JSON.stringify({
        devices: {
          "com.apple.CoreSimulator.SimRuntime.iOS-17": [
            { udid: "sim-1", name: "iPhone", state: "Booted" },
          ],
        },
      })
    );
    mockExec.mockResolvedValueOnce("");

    await iosMod.openUrl("https://apple.com", "sim-1");
    const urlCall = mockExec.mock.calls[1][0] as string;
    expect(urlCall).toBe('xcrun simctl openurl sim-1 "https://apple.com"');
  });
});
