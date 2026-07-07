/**
 * Tests for src/platforms/android.ts
 *
 * We mock the exec utilities so no real ADB commands run. This lets us test
 * command construction (file + args arrays), XML parsing, unicode handling,
 * keycode mapping, device-list parsing, and screen-info parsing.
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

const androidMod = await import("../../src/platforms/android.js");

beforeEach(() => {
  jest.clearAllMocks();
  androidMod.resetCaches();
});

function argsOfCall(call: number): string {
  return (mockRun.mock.calls[call]?.[1] as string[]).join(" ");
}

// ---------------------------------------------------------------------------
// listDevices / getFirstDeviceId
// ---------------------------------------------------------------------------
describe("listDevices", () => {
  it("parses a standard adb devices -l output with one device", async () => {
    mockRun.mockResolvedValueOnce(
      "List of devices attached\nemulator-5554          device product:sdk_gphone64_arm64 model:sdk_gphone64_arm64 transport_id:1\n\n"
    );
    const devices = await androidMod.listDevices();
    expect(mockRun).toHaveBeenCalledWith("adb", ["devices", "-l"]);
    expect(devices).toHaveLength(1);
    expect(devices[0]).toEqual({
      id: "emulator-5554",
      name: "sdk_gphone64_arm64",
      platform: "android",
      status: "device",
    });
  });

  it("parses multiple devices including an unauthorized one", async () => {
    mockRun.mockResolvedValueOnce(
      "List of devices attached\nemulator-5554          device model:Pixel_6\nABC123               unauthorized transport_id:2\n"
    );
    const devices = await androidMod.listDevices();
    expect(devices).toHaveLength(2);
    expect(devices[0].status).toBe("device");
    expect(devices[1].status).toBe("unauthorized");
    expect(devices[1].name).toBe("ABC123"); // no model token, falls back to id
  });

  it("skips lines starting with *", async () => {
    mockRun.mockResolvedValueOnce(
      "List of devices attached\n* daemon not running; starting now at tcp:5037\nemulator-5554  device model:Pixel\n"
    );
    const devices = await androidMod.listDevices();
    expect(devices).toHaveLength(1);
  });
});

describe("getFirstDeviceId", () => {
  it("returns the first connected device id", async () => {
    mockRun.mockResolvedValueOnce(
      "List of devices attached\nemulator-5554          device model:Pixel\n"
    );
    const id = await androidMod.getFirstDeviceId();
    expect(id).toBe("emulator-5554");
  });

  it("caches the result for subsequent calls", async () => {
    mockRun.mockResolvedValueOnce(
      "List of devices attached\nemulator-5554          device model:Pixel\n"
    );
    await androidMod.getFirstDeviceId();
    await androidMod.getFirstDeviceId();
    expect(mockRun).toHaveBeenCalledTimes(1);
  });

  it("throws when no devices with status 'device' exist", async () => {
    mockRun.mockResolvedValueOnce(
      "List of devices attached\nABC123  unauthorized\n"
    );
    await expect(androidMod.getFirstDeviceId()).rejects.toThrow(
      /No connected Android devices found/
    );
  });
});

// ---------------------------------------------------------------------------
// tap / doubleTap / longPress / swipe — command construction
// ---------------------------------------------------------------------------
describe("tap", () => {
  it("builds the correct adb shell input tap command", async () => {
    mockRun.mockResolvedValueOnce(""); // tap command
    await androidMod.tap(50, 75, "my-device");
    expect(mockRun).toHaveBeenCalledWith(
      "adb",
      ["-s", "my-device", "shell", "input", "tap", "50", "75"],
      undefined,
    );
  });

  it("resolves the first device when no device id is given", async () => {
    mockRun.mockResolvedValueOnce(
      "List of devices attached\nemu-1  device model:P\n"
    );
    mockRun.mockResolvedValueOnce("");
    await androidMod.tap(100, 200);
    expect(argsOfCall(1)).toBe("-s emu-1 shell input tap 100 200");
  });
});

describe("doubleTap", () => {
  it("sends two rapid taps in a single remote shell command", async () => {
    mockRun.mockResolvedValueOnce("");
    await androidMod.doubleTap(300, 400, "dev1");
    expect(mockRun).toHaveBeenCalledWith(
      "adb",
      ["-s", "dev1", "shell", "input tap 300 400 && sleep 0.05 && input tap 300 400"],
      undefined,
    );
  });
});

describe("longPress", () => {
  it("uses swipe-to-same-point with default 1000ms duration", async () => {
    mockRun.mockResolvedValueOnce("");
    await androidMod.longPress(10, 20, undefined, "dev1");
    expect(argsOfCall(0)).toBe("-s dev1 shell input swipe 10 20 10 20 1000");
  });

  it("respects custom duration", async () => {
    mockRun.mockResolvedValueOnce("");
    await androidMod.longPress(10, 20, 2500, "dev1");
    expect(argsOfCall(0)).toBe("-s dev1 shell input swipe 10 20 10 20 2500");
  });
});

describe("swipe", () => {
  it("builds correct swipe command with default duration", async () => {
    mockRun.mockResolvedValueOnce("");
    await androidMod.swipe(0, 100, 0, 500, undefined, "dev1");
    expect(argsOfCall(0)).toBe("-s dev1 shell input swipe 0 100 0 500 300");
  });
});

// ---------------------------------------------------------------------------
// typeText — escaping + unicode fallback
// ---------------------------------------------------------------------------
describe("typeText", () => {
  it("escapes spaces as %s and quotes for the remote shell", async () => {
    mockRun.mockResolvedValueOnce("");
    const method = await androidMod.typeText("hello world", "dev1");
    expect(method).toBe("keyboard");
    expect(argsOfCall(0)).toBe("-s dev1 shell input text 'hello%sworld'");
  });

  it("wraps shell metacharacters in remote single quotes", async () => {
    mockRun.mockResolvedValueOnce("");
    await androidMod.typeText("$(cmd)&x|y;z", "dev1");
    const args = mockRun.mock.calls[0][1] as string[];
    expect(args[args.length - 1]).toBe("'$(cmd)&x|y;z'");
  });

  it("falls back to clipboard + paste for non-ASCII text", async () => {
    mockRun.mockResolvedValueOnce(""); // cmd clipboard set-text
    mockRun.mockResolvedValueOnce(""); // keyevent 279
    const method = await androidMod.typeText("más añejo", "dev1");
    expect(method).toBe("clipboard_paste");
    expect(argsOfCall(0)).toContain("cmd clipboard set-text");
    expect(argsOfCall(0)).toContain("más añejo");
    expect(argsOfCall(1)).toBe("-s dev1 shell input keyevent 279");
  });

  it("falls back to clipboard + paste for emoji", async () => {
    mockRun.mockResolvedValueOnce("");
    mockRun.mockResolvedValueOnce("");
    const method = await androidMod.typeText("done ✅", "dev1");
    expect(method).toBe("clipboard_paste");
  });
});

// ---------------------------------------------------------------------------
// pressKey — keycode mapping and repeat
// ---------------------------------------------------------------------------
describe("pressKey", () => {
  it.each([
    ["home", 3],
    ["back", 4],
    ["enter", 66],
    ["recent_apps", 187],
    ["menu", 82],
    ["escape", 111],
    ["search", 84],
    ["camera", 27],
    ["media_play_pause", 85],
    ["paste", 279],
  ])("maps '%s' to keyevent %i", async (key, code) => {
    mockRun.mockResolvedValueOnce("");
    await androidMod.pressKey(key, "dev1");
    expect(argsOfCall(0)).toBe(`-s dev1 shell input keyevent ${code}`);
  });

  it("uses numeric keycode directly when provided", async () => {
    mockRun.mockResolvedValueOnce("");
    await androidMod.pressKey(undefined, "dev1", 120);
    expect(argsOfCall(0)).toBe("-s dev1 shell input keyevent 120");
  });

  it("repeats the keycode in a single command", async () => {
    mockRun.mockResolvedValueOnce("");
    await androidMod.pressKey("delete", "dev1", undefined, 3);
    expect(argsOfCall(0)).toBe("-s dev1 shell input keyevent 67 67 67");
  });

  it("throws for unknown keys", async () => {
    await expect(androidMod.pressKey("unknown_key", "dev1")).rejects.toThrow(
      /Unknown key: unknown_key/
    );
  });
});

// ---------------------------------------------------------------------------
// setClipboard / getClipboard
// ---------------------------------------------------------------------------
describe("setClipboard", () => {
  it("uses cmd clipboard set-text with remote quoting", async () => {
    mockRun.mockResolvedValueOnce("");
    await androidMod.setClipboard("dev1", "hello world");
    expect(argsOfCall(0)).toBe("-s dev1 shell cmd clipboard set-text 'hello world'");
  });

  it("falls back to am broadcast when cmd clipboard fails", async () => {
    mockRun.mockRejectedValueOnce(new Error("cmd not found"));
    mockRun.mockResolvedValueOnce("");
    await androidMod.setClipboard("dev1", "fallback text");
    expect(argsOfCall(1)).toContain("am broadcast -a clipper.set");
  });
});

describe("getClipboard", () => {
  it("returns cmd clipboard get-text output when available", async () => {
    mockRun.mockResolvedValueOnce("copied value\n");
    const text = await androidMod.getClipboard("dev1");
    expect(text).toBe("copied value");
  });

  it("falls back to dumpsys clipboard parsing", async () => {
    mockRun.mockRejectedValueOnce(new Error("unknown command"));
    mockRun.mockResolvedValueOnce("data=ClipData { text/plain {T:from dumpsys} }");
    const text = await androidMod.getClipboard("dev1");
    expect(text).toBe("from dumpsys");
  });

  it("throws a descriptive error when nothing works", async () => {
    mockRun.mockRejectedValueOnce(new Error("unknown command"));
    mockRun.mockResolvedValueOnce("no clip data here");
    await expect(androidMod.getClipboard("dev1")).rejects.toThrow(
      /Could not read the clipboard/
    );
  });
});

// ---------------------------------------------------------------------------
// getLogs / clearLogs — tail handled in JS, no shell pipes
// ---------------------------------------------------------------------------
describe("getLogs", () => {
  it("returns only the last N lines", async () => {
    const logLines = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n");
    mockRun.mockResolvedValueOnce(logLines);
    const output = await androidMod.getLogs("dev1", { lines: 10 });
    expect(argsOfCall(0)).toBe("-s dev1 logcat -d -v time");
    expect(output.split("\n")).toHaveLength(10);
    expect(output).toContain("line 99");
    expect(output).not.toContain("line 89\n");
  });

  it("combines tag and level into a single filterspec", async () => {
    mockRun.mockResolvedValueOnce("tagged log");
    await androidMod.getLogs("dev1", { tag: "ReactNativeJS", level: "error", lines: 50 });
    expect(argsOfCall(0)).toBe("-s dev1 logcat -d -v time -s ReactNativeJS:E");
  });

  it("uses global level filter when only level is provided", async () => {
    mockRun.mockResolvedValueOnce("error log");
    await androidMod.getLogs("dev1", { level: "error", lines: 20 });
    expect(argsOfCall(0)).toBe("-s dev1 logcat -d -v time *:E");
  });
});

describe("clearLogs", () => {
  it("sends logcat -c command", async () => {
    mockRun.mockResolvedValueOnce("");
    await androidMod.clearLogs("dev1");
    expect(argsOfCall(0)).toBe("-s dev1 logcat -c");
  });
});

// ---------------------------------------------------------------------------
// clearAppData / clearAppCache / killApp
// ---------------------------------------------------------------------------
describe("clearAppData", () => {
  it("sends pm clear command", async () => {
    mockRun.mockResolvedValueOnce("");
    await androidMod.clearAppData("dev1", "com.example.app");
    expect(argsOfCall(0)).toBe("-s dev1 shell pm clear com.example.app");
  });
});

describe("clearAppCache", () => {
  it("uses run-as to delete cache dirs", async () => {
    mockRun.mockResolvedValueOnce("");
    mockRun.mockResolvedValueOnce("");
    await androidMod.clearAppCache("dev1", "com.example.app");
    expect(argsOfCall(0)).toBe("-s dev1 shell run-as com.example.app rm -rf cache/");
    expect(argsOfCall(1)).toBe("-s dev1 shell run-as com.example.app rm -rf code_cache/");
  });

  it("falls back to pm clear --cache-only when run-as fails", async () => {
    mockRun.mockRejectedValueOnce(new Error("run-as failed"));
    mockRun.mockResolvedValueOnce("");
    await androidMod.clearAppCache("dev1", "com.example.app");
    expect(argsOfCall(1)).toBe("-s dev1 shell pm clear --cache-only com.example.app");
  });

  it("throws descriptive error when both methods fail", async () => {
    mockRun.mockRejectedValueOnce(new Error("run-as failed"));
    mockRun.mockRejectedValueOnce(new Error("pm clear failed"));
    await expect(
      androidMod.clearAppCache("dev1", "com.example.app")
    ).rejects.toThrow(/Cannot clear cache/);
  });
});

describe("killApp", () => {
  it("sends am force-stop command", async () => {
    mockRun.mockResolvedValueOnce("");
    await androidMod.killApp("dev1", "com.example.app");
    expect(argsOfCall(0)).toBe("-s dev1 shell am force-stop com.example.app");
  });
});

// ---------------------------------------------------------------------------
// install / uninstall / app info / foreground app
// ---------------------------------------------------------------------------
describe("installApp", () => {
  it("installs with -r to replace existing", async () => {
    mockRun.mockResolvedValueOnce("Success");
    const output = await androidMod.installApp("dev1", "/tmp/app.apk");
    expect(argsOfCall(0)).toBe("-s dev1 install -r /tmp/app.apk");
    expect(output).toBe("Success");
  });
});

describe("uninstallApp", () => {
  it("sends adb uninstall", async () => {
    mockRun.mockResolvedValueOnce("Success");
    await androidMod.uninstallApp("dev1", "com.example.app");
    expect(argsOfCall(0)).toBe("-s dev1 uninstall com.example.app");
  });
});

describe("getAppInfo", () => {
  it("parses versionName and versionCode from dumpsys", async () => {
    mockRun.mockResolvedValueOnce(
      "Package [com.example.app] (abc123):\n    versionCode=42 minSdk=24\n    versionName=1.2.3\n"
    );
    const info = await androidMod.getAppInfo("dev1", "com.example.app");
    expect(info).toEqual({
      installed: true,
      version_name: "1.2.3",
      version_code: "42",
    });
  });

  it("reports not installed when the package block is missing", async () => {
    mockRun.mockResolvedValueOnce("Unable to find package: com.example.app");
    const info = await androidMod.getAppInfo("dev1", "com.example.app");
    expect(info).toEqual({ installed: false });
  });
});

describe("getForegroundApp", () => {
  it("parses mResumedActivity", async () => {
    mockRun.mockResolvedValueOnce(
      "  mResumedActivity: ActivityRecord{abc123 u0 com.example.app/.MainActivity t42}"
    );
    const app = await androidMod.getForegroundApp("dev1");
    expect(app.package).toBe("com.example.app");
    expect(app.activity).toBe(".MainActivity");
  });

  it("falls back to mCurrentFocus when no resumed activity is found", async () => {
    mockRun.mockResolvedValueOnce("no matches here");
    mockRun.mockResolvedValueOnce(
      "  mCurrentFocus=Window{def456 u0 com.other.app/com.other.app.HomeActivity}"
    );
    const app = await androidMod.getForegroundApp("dev1");
    expect(app.package).toBe("com.other.app");
  });
});

// ---------------------------------------------------------------------------
// network / location / appearance / rotation
// ---------------------------------------------------------------------------
describe("setWifi / setMobileData", () => {
  it("sends svc wifi enable command", async () => {
    mockRun.mockResolvedValueOnce("");
    await androidMod.setWifi("dev1", true);
    expect(argsOfCall(0)).toBe("-s dev1 shell svc wifi enable");
  });

  it("sends svc data disable command", async () => {
    mockRun.mockResolvedValueOnce("");
    await androidMod.setMobileData("dev1", false);
    expect(argsOfCall(0)).toBe("-s dev1 shell svc data disable");
  });
});

describe("setAirplaneMode", () => {
  it("uses cmd connectivity airplane-mode enable", async () => {
    mockRun.mockResolvedValueOnce("");
    await androidMod.setAirplaneMode("dev1", true);
    expect(argsOfCall(0)).toBe("-s dev1 shell cmd connectivity airplane-mode enable");
  });

  it("falls back to settings + broadcast when cmd fails", async () => {
    mockRun.mockRejectedValueOnce(new Error("cmd not found"));
    mockRun.mockResolvedValueOnce("");
    mockRun.mockResolvedValueOnce("");
    await androidMod.setAirplaneMode("dev1", true);
    expect(argsOfCall(1)).toBe("-s dev1 shell settings put global airplane_mode_on 1");
    expect(argsOfCall(2)).toContain("android.intent.action.AIRPLANE_MODE");
  });
});

describe("setLocation", () => {
  it("sends geo fix with longitude before latitude", async () => {
    mockRun.mockResolvedValueOnce("");
    await androidMod.setLocation("emulator-5554", -34.6037, -58.3816);
    expect(argsOfCall(0)).toBe("-s emulator-5554 emu geo fix -58.3816 -34.6037");
  });

  it("throws for physical devices", async () => {
    await expect(
      androidMod.setLocation("R58M12ABC", -34.6, -58.38)
    ).rejects.toThrow(/not an emulator/);
    expect(mockRun).not.toHaveBeenCalled();
  });
});

describe("setNetworkThrottle", () => {
  it("sends emulator console delay and speed commands", async () => {
    mockRun.mockResolvedValueOnce("");
    mockRun.mockResolvedValueOnce("");
    await androidMod.setNetworkThrottle("emulator-5554", { delay: "edge", speed: "gprs" });
    expect(argsOfCall(0)).toBe("-s emulator-5554 emu network delay edge");
    expect(argsOfCall(1)).toBe("-s emulator-5554 emu network speed gprs");
  });

  it("throws for physical devices", async () => {
    await expect(
      androidMod.setNetworkThrottle("R58M12ABC", { delay: "edge" })
    ).rejects.toThrow(/not an emulator/);
  });
});

describe("setAppearance", () => {
  it("sends cmd uimode night yes for dark mode", async () => {
    mockRun.mockResolvedValueOnce("");
    await androidMod.setAppearance("dev1", "dark");
    expect(argsOfCall(0)).toBe("-s dev1 shell cmd uimode night yes");
  });
});

describe("rotate", () => {
  it("disables auto-rotate and sets user_rotation", async () => {
    mockRun.mockResolvedValueOnce("");
    mockRun.mockResolvedValueOnce("");
    await androidMod.rotate("dev1", "landscape");
    expect(argsOfCall(0)).toBe("-s dev1 shell settings put system accelerometer_rotation 0");
    expect(argsOfCall(1)).toBe("-s dev1 shell settings put system user_rotation 1");
  });
});

// ---------------------------------------------------------------------------
// screenshot / getScreenInfo
// ---------------------------------------------------------------------------
describe("screenshot", () => {
  it("calls exec-out screencap -p with 30s timeout", async () => {
    mockRunBuffer.mockResolvedValueOnce(Buffer.from("PNG"));
    await androidMod.screenshot("dev1");
    expect(mockRunBuffer).toHaveBeenCalledWith(
      "adb",
      ["-s", "dev1", "exec-out", "screencap", "-p"],
      { timeout: 30_000 },
    );
  });
});

describe("getScreenInfo", () => {
  function mockScreenCommands(rotationOutput: string) {
    mockRun.mockImplementation(async (_file, args) => {
      const cmd = (args as string[]).join(" ");
      if (cmd.includes("wm size")) return "Physical size: 1080x1920";
      if (cmd.includes("wm density")) return "Physical density: 420";
      if (cmd.includes("dumpsys window")) return rotationOutput;
      return "";
    });
  }

  it("parses portrait orientation with rotation 0", async () => {
    mockScreenCommands("mCurrentRotation=ROTATION_0");
    const info = await androidMod.getScreenInfo("dev1");
    expect(info).toEqual({
      width: 1080,
      height: 1920,
      density: 420,
      orientation: "portrait",
    });
  });

  it("swaps dimensions when the device is rotated 90 degrees", async () => {
    mockScreenCommands("mCurrentRotation=ROTATION_90");
    const info = await androidMod.getScreenInfo("dev1");
    expect(info.width).toBe(1920);
    expect(info.height).toBe(1080);
    expect(info.orientation).toBe("landscape");
  });

  it("supports plain numeric rotation values", async () => {
    mockScreenCommands("mRotation=3");
    const info = await androidMod.getScreenInfo("dev1");
    expect(info.orientation).toBe("landscape");
  });

  it("defaults to portrait when rotation cannot be read", async () => {
    mockScreenCommands("nothing useful");
    const info = await androidMod.getScreenInfo("dev1");
    expect(info.orientation).toBe("portrait");
  });
});

// ---------------------------------------------------------------------------
// launchApp / openUrl
// ---------------------------------------------------------------------------
describe("launchApp", () => {
  it("builds the correct monkey command", async () => {
    mockRun.mockResolvedValueOnce("");
    await androidMod.launchApp("com.example.app", "dev1");
    expect(argsOfCall(0)).toBe(
      "-s dev1 shell monkey -p com.example.app -c android.intent.category.LAUNCHER 1"
    );
  });
});

describe("openUrl", () => {
  it("quotes the URL for the remote shell so query params survive", async () => {
    mockRun.mockResolvedValueOnce("");
    await androidMod.openUrl("app://route?a=1&b=2", "dev1");
    const args = mockRun.mock.calls[0][1] as string[];
    expect(args[args.length - 1]).toBe("'app://route?a=1&b=2'");
  });
});

// ---------------------------------------------------------------------------
// getUiTree — XML parsing
// ---------------------------------------------------------------------------
describe("getUiTree", () => {
  const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy rotation="0">
  <node index="0" text="Ropa &amp; Accesorios" resource-id="com.android.settings:id/title" class="android.widget.TextView" content-desc="" clickable="true" enabled="true" focused="false" bounds="[0,100][540,150]" />
  <node index="1" text="" resource-id="" class="android.view.View" content-desc="Search" clickable="false" enabled="true" focused="false" bounds="[600,100][700,200]" />
</hierarchy>`;

  it("parses node elements with correct bounds, center, and decoded entities", async () => {
    mockRun.mockResolvedValueOnce(sampleXml);

    const elements = await androidMod.getUiTree("dev1");
    expect(elements).toHaveLength(2);

    expect(elements[0].type).toBe("TextView");
    expect(elements[0].text).toBe("Ropa & Accesorios"); // entities decoded
    expect(elements[0].bounds).toEqual({ x: 0, y: 100, width: 540, height: 50 });
    expect(elements[0].center_x).toBe(270);
    expect(elements[0].center_y).toBe(125);
    expect(elements[0].clickable).toBe(true);
    expect(elements[0].resource_id).toBe("title"); // package prefix stripped
  });

  it("uses content-desc as text when text attribute is empty", async () => {
    mockRun.mockResolvedValueOnce(sampleXml);
    const elements = await androidMod.getUiTree("dev1");
    expect(elements[1].text).toBe("Search");
    expect(elements[1].resource_id).toBeUndefined();
  });

  it("throws after all 4 strategies fail", async () => {
    mockRun.mockRejectedValue(new Error("dump failed"));
    await expect(androidMod.getUiTree("dev1")).rejects.toThrow(
      /Failed to parse UI tree XML/
    );
  });
});
