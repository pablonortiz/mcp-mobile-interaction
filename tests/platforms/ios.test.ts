/**
 * Tests for src/platforms/ios.ts
 *
 * We mock the exec utilities so no real xcrun/idb commands run. simctl has NO
 * UI interaction commands, so tap/swipe/type/UI-tree require idb — these tests
 * pin that requirement and the simctl-based device/app/clipboard commands.
 */

import { jest } from "@jest/globals";

const mockRun = jest.fn<(file: string, args: string[], opts?: any) => Promise<string>>();
const mockRunBuffer = jest.fn<(file: string, args: string[], opts?: any) => Promise<Buffer>>();
const mockSpawnProc = jest.fn();

jest.unstable_mockModule("../../src/utils/exec.js", () => ({
  run: mockRun,
  runBuffer: mockRunBuffer,
  spawnProc: mockSpawnProc,
  shellQuote: (value: string) => `'${value.replace(/'/g, `'\\''`)}'`,
}));

const iosMod = await import("../../src/platforms/ios.js");

const SIMCTL_LIST = JSON.stringify({
  devices: {
    "com.apple.CoreSimulator.SimRuntime.iOS-17-2": [
      { udid: "sim-1", name: "iPhone 15", state: "Booted" },
      { udid: "sim-2", name: "iPad Air", state: "Shutdown" },
    ],
  },
});

function mockCommands({ idb }: { idb: boolean }) {
  mockRun.mockImplementation(async (file, args) => {
    const cmd = (args as string[]).join(" ");
    if (file === "which") {
      if (idb) return "/usr/local/bin/idb";
      throw new Error("idb not found");
    }
    if (file === "xcrun" && cmd.includes("list devices")) return SIMCTL_LIST;
    return "";
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  iosMod.resetCaches();
});

// ---------------------------------------------------------------------------
// listDevices / getFirstDeviceId
// ---------------------------------------------------------------------------
describe("listDevices", () => {
  it("parses simulators from xcrun simctl JSON output", async () => {
    mockCommands({ idb: false });
    const devices = await iosMod.listDevices();
    expect(devices).toHaveLength(2);
    expect(devices[0]).toEqual({
      id: "sim-1",
      name: "iPhone 15 (iOS-17-2)",
      platform: "ios",
      status: "booted",
    });
    expect(devices[1].status).toBe("shutdown");
  });

  it("returns empty list when xcrun simctl fails and idb unavailable", async () => {
    mockRun.mockRejectedValue(new Error("nothing works"));
    const devices = await iosMod.listDevices();
    expect(devices).toHaveLength(0);
  });
});

describe("getFirstDeviceId", () => {
  it("prefers booted simulators", async () => {
    mockCommands({ idb: false });
    const id = await iosMod.getFirstDeviceId();
    expect(id).toBe("sim-1");
  });

  it("throws when no booted or connected devices exist", async () => {
    mockRun.mockImplementation(async (file, args) => {
      if (file === "which") throw new Error("no idb");
      return JSON.stringify({
        devices: {
          "com.apple.CoreSimulator.SimRuntime.iOS-17-2": [
            { udid: "SHUT-1111", name: "iPhone A", state: "Shutdown" },
          ],
        },
      });
    });
    await expect(iosMod.getFirstDeviceId()).rejects.toThrow(
      /No connected iOS devices or booted simulators found/
    );
  });
});

// ---------------------------------------------------------------------------
// UI interaction requires idb — simctl has no tap/swipe/type commands
// ---------------------------------------------------------------------------
describe("interaction without idb", () => {
  beforeEach(() => mockCommands({ idb: false }));

  it("tap throws a descriptive error", async () => {
    await expect(iosMod.tap(150, 300, "sim-1")).rejects.toThrow(/idb is required/);
  });

  it("swipe throws a descriptive error", async () => {
    await expect(iosMod.swipe(0, 500, 0, 100, 300, "sim-1")).rejects.toThrow(/idb is required/);
  });

  it("typeText throws a descriptive error", async () => {
    await expect(iosMod.typeText("hello", "sim-1")).rejects.toThrow(/idb is required/);
  });

  it("getUiTree throws a descriptive error", async () => {
    await expect(iosMod.getUiTree("sim-1")).rejects.toThrow(/idb is required/);
  });
});

describe("interaction with idb", () => {
  beforeEach(() => mockCommands({ idb: true }));

  it("tap uses idb ui tap", async () => {
    await iosMod.tap(150, 300, "sim-1");
    expect(mockRun).toHaveBeenCalledWith(
      "idb",
      ["ui", "tap", "--udid", "sim-1", "150", "300"],
    );
  });

  it("swipe uses idb ui swipe with duration in seconds", async () => {
    await iosMod.swipe(0, 500, 0, 100, 300, "sim-1");
    expect(mockRun).toHaveBeenCalledWith(
      "idb",
      ["ui", "swipe", "--udid", "sim-1", "--duration", "0.3", "0", "500", "0", "100"],
    );
  });

  it("longPress uses idb ui tap with duration", async () => {
    await iosMod.longPress(200, 400, 2000, "sim-1");
    expect(mockRun).toHaveBeenCalledWith(
      "idb",
      ["ui", "tap", "--udid", "sim-1", "--duration", "2", "200", "400"],
    );
  });

  it("typeText passes the text as a single verbatim argument", async () => {
    const method = await iosMod.typeText("it's fine & good", "sim-1");
    expect(method).toBe("keyboard");
    expect(mockRun).toHaveBeenCalledWith(
      "idb",
      ["ui", "text", "--udid", "sim-1", "it's fine & good"],
    );
  });

  it("getUiTree parses idb describe-all JSON lines", async () => {
    mockRun.mockImplementation(async (file, args) => {
      if (file === "which") return "/usr/local/bin/idb";
      if (file === "idb" && (args as string[]).includes("describe-all")) {
        return [
          JSON.stringify({
            AXLabel: "Login",
            type: "Button",
            frame: { x: 10, y: 20, width: 100, height: 40 },
            enabled: true,
            AXIdentifier: "login_button",
          }),
        ].join("\n");
      }
      return SIMCTL_LIST;
    });

    const elements = await iosMod.getUiTree("sim-1");
    expect(elements).toHaveLength(1);
    expect(elements[0].text).toBe("Login");
    expect(elements[0].resource_id).toBe("login_button");
    expect(elements[0].center_x).toBe(60);
    expect(elements[0].center_y).toBe(40);
  });
});

// ---------------------------------------------------------------------------
// Clipboard — simctl pbcopy/pbpaste target the simulator, not the host Mac
// ---------------------------------------------------------------------------
describe("setClipboard", () => {
  it("uses simctl pbcopy with the text piped via stdin", async () => {
    mockCommands({ idb: false });
    await iosMod.setClipboard("sim-1", "hello clipboard");
    expect(mockRun).toHaveBeenCalledWith(
      "xcrun",
      ["simctl", "pbcopy", "sim-1"],
      { stdin: "hello clipboard" },
    );
  });

  it("throws for physical devices", async () => {
    mockCommands({ idb: true });
    await expect(iosMod.setClipboard("physical-1", "text")).rejects.toThrow(
      /not supported via CLI/
    );
  });
});

describe("getClipboard", () => {
  it("uses simctl pbpaste for simulators", async () => {
    mockRun.mockImplementation(async (file, args) => {
      const cmd = (args as string[]).join(" ");
      if (cmd.includes("list devices")) return SIMCTL_LIST;
      if (cmd.includes("pbpaste")) return "copied text";
      return "";
    });
    const text = await iosMod.getClipboard("sim-1");
    expect(text).toBe("copied text");
  });
});

// ---------------------------------------------------------------------------
// getLogs — simulators only
// ---------------------------------------------------------------------------
describe("getLogs", () => {
  it("builds log show via simctl spawn and tails in JS", async () => {
    const logLines = Array.from({ length: 60 }, (_, i) => `log ${i}`).join("\n");
    mockRun.mockImplementation(async (file, args) => {
      const cmd = (args as string[]).join(" ");
      if (cmd.includes("list devices")) return SIMCTL_LIST;
      if (cmd.includes("log show")) return logLines;
      return "";
    });

    const output = await iosMod.getLogs("sim-1", { lines: 30 });
    expect(output.split("\n")).toHaveLength(30);
    expect(output).toContain("log 59");

    const logCall = mockRun.mock.calls.find((c) =>
      (c[1] as string[]).includes("show"),
    );
    expect((logCall![1] as string[]).join(" ")).toContain(
      "simctl spawn sim-1 log show --last 1m --style compact",
    );
  });

  it("adds subsystem predicate when tag is provided", async () => {
    mockRun.mockImplementation(async (file, args) => {
      const cmd = (args as string[]).join(" ");
      if (cmd.includes("list devices")) return SIMCTL_LIST;
      return "line";
    });
    await iosMod.getLogs("sim-1", { tag: "com.apple.UIKit", lines: 10 });
    const logCall = mockRun.mock.calls.find((c) =>
      (c[1] as string[]).includes("--predicate"),
    );
    expect((logCall![1] as string[]).join(" ")).toContain(
      'subsystem == "com.apple.UIKit"',
    );
  });

  it("throws for physical devices", async () => {
    mockCommands({ idb: true });
    await expect(iosMod.getLogs("physical-1", { lines: 10 })).rejects.toThrow(
      /not supported/
    );
  });
});

// ---------------------------------------------------------------------------
// App lifecycle via simctl
// ---------------------------------------------------------------------------
describe("clearAppData", () => {
  it("uses xcrun simctl uninstall for simulators", async () => {
    mockCommands({ idb: false });
    await iosMod.clearAppData("sim-1", "com.example.app");
    expect(mockRun).toHaveBeenCalledWith(
      "xcrun",
      ["simctl", "uninstall", "sim-1", "com.example.app"],
    );
  });

  it("throws for physical devices", async () => {
    mockCommands({ idb: false });
    await expect(
      iosMod.clearAppData("physical-1", "com.example.app")
    ).rejects.toThrow(/not possible via CLI/);
  });
});

describe("killApp", () => {
  it("uses xcrun simctl terminate for simulators", async () => {
    mockCommands({ idb: false });
    await iosMod.killApp("sim-1", "com.apple.mobilesafari");
    expect(mockRun).toHaveBeenCalledWith(
      "xcrun",
      ["simctl", "terminate", "sim-1", "com.apple.mobilesafari"],
    );
  });
});

describe("installApp / uninstallApp", () => {
  it("installs via simctl on simulators", async () => {
    mockCommands({ idb: false });
    await iosMod.installApp("sim-1", "/tmp/MyApp.app");
    expect(mockRun).toHaveBeenCalledWith(
      "xcrun",
      ["simctl", "install", "sim-1", "/tmp/MyApp.app"],
      { timeout: 120_000 },
    );
  });

  it("uninstalls via simctl on simulators", async () => {
    mockCommands({ idb: false });
    await iosMod.uninstallApp("sim-1", "com.example.app");
    expect(mockRun).toHaveBeenCalledWith(
      "xcrun",
      ["simctl", "uninstall", "sim-1", "com.example.app"],
      { timeout: 60_000 },
    );
  });
});

describe("getAppInfo", () => {
  it("parses CFBundle versions from simctl listapps", async () => {
    mockRun.mockImplementation(async (file, args) => {
      const cmd = (args as string[]).join(" ");
      if (cmd.includes("list devices")) return SIMCTL_LIST;
      if (cmd.includes("listapps")) {
        return `{
    "com.example.app" = {
        ApplicationType = User;
        CFBundleShortVersionString = "2.5.0";
        CFBundleVersion = "250";
    };
}`;
      }
      return "";
    });
    const info = await iosMod.getAppInfo("sim-1", "com.example.app");
    expect(info).toEqual({
      installed: true,
      version_name: "2.5.0",
      version_code: "250",
    });
  });

  it("reports not installed when the bundle is absent", async () => {
    mockRun.mockImplementation(async (file, args) => {
      const cmd = (args as string[]).join(" ");
      if (cmd.includes("list devices")) return SIMCTL_LIST;
      return "{}";
    });
    const info = await iosMod.getAppInfo("sim-1", "com.example.app");
    expect(info).toEqual({ installed: false });
  });
});

// ---------------------------------------------------------------------------
// location / appearance / foreground app
// ---------------------------------------------------------------------------
describe("setLocation", () => {
  it("uses simctl location set with lat,lng", async () => {
    mockCommands({ idb: false });
    await iosMod.setLocation("sim-1", -34.6037, -58.3816);
    expect(mockRun).toHaveBeenCalledWith(
      "xcrun",
      ["simctl", "location", "sim-1", "set", "-34.6037,-58.3816"],
    );
  });
});

describe("setAppearance", () => {
  it("uses simctl ui appearance for simulators", async () => {
    mockCommands({ idb: false });
    await iosMod.setAppearance("sim-1", "dark");
    expect(mockRun).toHaveBeenCalledWith(
      "xcrun",
      ["simctl", "ui", "sim-1", "appearance", "dark"],
    );
  });

  it("throws for physical devices", async () => {
    mockCommands({ idb: false });
    await expect(iosMod.setAppearance("physical-1", "dark")).rejects.toThrow(
      /not supported via CLI/
    );
  });
});

describe("getForegroundApp", () => {
  it("is not supported on iOS", async () => {
    await expect(iosMod.getForegroundApp("sim-1")).rejects.toThrow(
      /not supported on iOS/
    );
  });
});

// ---------------------------------------------------------------------------
// pressKey
// ---------------------------------------------------------------------------
describe("pressKey", () => {
  it("throws for unknown keys", async () => {
    mockCommands({ idb: true });
    await expect(iosMod.pressKey("nonexistent", "sim-1")).rejects.toThrow(
      /Unknown key: nonexistent/
    );
  });

  it("throws when numeric keycode is used without a named key on iOS", async () => {
    mockCommands({ idb: true });
    await expect(iosMod.pressKey(undefined, "sim-1", 120)).rejects.toThrow(
      /Numeric keycode is not supported on iOS/
    );
  });

  it("presses a key N times when repeat is given", async () => {
    mockCommands({ idb: true });
    await iosMod.pressKey("delete", "sim-1", undefined, 3);
    const keyCalls = mockRun.mock.calls.filter((c) => c[0] === "idb");
    expect(keyCalls).toHaveLength(3);
    expect(keyCalls[0][1]).toEqual(["ui", "key", "--udid", "sim-1", "42"]);
  });
});
