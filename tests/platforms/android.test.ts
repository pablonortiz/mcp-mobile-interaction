/**
 * Tests for src/platforms/android.ts
 *
 * We mock the exec/execBuffer utilities so no real ADB commands run.
 * This lets us test command-string construction, XML parsing, text escaping,
 * keycode mapping, device-list parsing, and screen-info parsing.
 */

import { jest } from "@jest/globals";
import type { UiElement } from "../../src/types.js";

// ---------------------------------------------------------------------------
// Mock the exec utility — every android function calls exec() or execBuffer()
// ---------------------------------------------------------------------------
const mockExec = jest.fn<(cmd: string, opts?: any) => Promise<string>>();
const mockExecBuffer = jest.fn<(cmd: string, opts?: any) => Promise<Buffer>>();

jest.unstable_mockModule("../../src/utils/exec.js", () => ({
  exec: mockExec,
  execBuffer: mockExecBuffer,
}));

// Dynamic import so the mock is in place before the module loads
const androidMod = await import("../../src/platforms/android.js");

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// listDevices / getFirstDeviceId
// ---------------------------------------------------------------------------
describe("listDevices", () => {
  it("parses a standard adb devices -l output with one device", async () => {
    mockExec.mockResolvedValueOnce(
      "List of devices attached\nemulator-5554          device product:sdk_gphone64_arm64 model:sdk_gphone64_arm64 transport_id:1\n\n"
    );
    const devices = await androidMod.listDevices();
    expect(devices).toHaveLength(1);
    expect(devices[0]).toEqual({
      id: "emulator-5554",
      name: "sdk_gphone64_arm64",
      platform: "android",
      status: "device",
    });
  });

  it("parses multiple devices including an unauthorized one", async () => {
    mockExec.mockResolvedValueOnce(
      "List of devices attached\nemulator-5554          device model:Pixel_6\nABC123               unauthorized transport_id:2\n"
    );
    const devices = await androidMod.listDevices();
    expect(devices).toHaveLength(2);
    expect(devices[0].status).toBe("device");
    expect(devices[1].status).toBe("unauthorized");
    expect(devices[1].name).toBe("ABC123"); // no model token, falls back to id
  });

  it("returns an empty list when no devices are attached", async () => {
    mockExec.mockResolvedValueOnce("List of devices attached\n\n");
    const devices = await androidMod.listDevices();
    expect(devices).toHaveLength(0);
  });

  it("skips lines starting with *", async () => {
    mockExec.mockResolvedValueOnce(
      "List of devices attached\n* daemon not running; starting now at tcp:5037\nemulator-5554  device model:Pixel\n"
    );
    const devices = await androidMod.listDevices();
    expect(devices).toHaveLength(1);
    expect(devices[0].id).toBe("emulator-5554");
  });
});

describe("getFirstDeviceId", () => {
  it("returns the first connected device id", async () => {
    mockExec.mockResolvedValueOnce(
      "List of devices attached\nemulator-5554          device model:Pixel\n"
    );
    const id = await androidMod.getFirstDeviceId();
    expect(id).toBe("emulator-5554");
  });

  it("throws when no devices with status 'device' exist", async () => {
    mockExec.mockResolvedValueOnce(
      "List of devices attached\nABC123  unauthorized\n"
    );
    await expect(androidMod.getFirstDeviceId()).rejects.toThrow(
      /No connected Android devices found/
    );
  });
});

// ---------------------------------------------------------------------------
// tap / doubleTap / longPress / swipe — command string construction
// ---------------------------------------------------------------------------
describe("tap", () => {
  it("builds the correct adb shell input tap command", async () => {
    mockExec.mockResolvedValue(""); // resolveDevice + tap
    // First call: listDevices for resolveDevice
    mockExec.mockResolvedValueOnce(
      "List of devices attached\nemu-1  device model:P\n"
    );
    mockExec.mockResolvedValueOnce(""); // actual tap
    await androidMod.tap(100, 200);
    const tapCall = mockExec.mock.calls[1][0];
    expect(tapCall).toBe("adb -s emu-1 shell input tap 100 200");
  });

  it("uses explicit device id when provided", async () => {
    mockExec.mockResolvedValueOnce(""); // tap command
    await androidMod.tap(50, 75, "my-device");
    expect(mockExec).toHaveBeenCalledWith(
      "adb -s my-device shell input tap 50 75"
    );
  });
});

describe("doubleTap", () => {
  it("sends two rapid taps in a single shell command", async () => {
    mockExec.mockResolvedValueOnce("");
    await androidMod.doubleTap(300, 400, "dev1");
    expect(mockExec).toHaveBeenCalledWith(
      'adb -s dev1 shell "input tap 300 400 && sleep 0.05 && input tap 300 400"'
    );
  });
});

describe("longPress", () => {
  it("uses swipe-to-same-point with default 1000ms duration", async () => {
    mockExec.mockResolvedValueOnce("");
    await androidMod.longPress(10, 20, undefined, "dev1");
    expect(mockExec).toHaveBeenCalledWith(
      "adb -s dev1 shell input swipe 10 20 10 20 1000"
    );
  });

  it("respects custom duration", async () => {
    mockExec.mockResolvedValueOnce("");
    await androidMod.longPress(10, 20, 2500, "dev1");
    expect(mockExec).toHaveBeenCalledWith(
      "adb -s dev1 shell input swipe 10 20 10 20 2500"
    );
  });
});

describe("swipe", () => {
  it("builds correct swipe command with default duration", async () => {
    mockExec.mockResolvedValueOnce("");
    await androidMod.swipe(0, 100, 0, 500, undefined, "dev1");
    expect(mockExec).toHaveBeenCalledWith(
      "adb -s dev1 shell input swipe 0 100 0 500 300"
    );
  });

  it("uses custom duration", async () => {
    mockExec.mockResolvedValueOnce("");
    await androidMod.swipe(0, 0, 100, 100, 800, "dev1");
    expect(mockExec).toHaveBeenCalledWith(
      "adb -s dev1 shell input swipe 0 0 100 100 800"
    );
  });
});

// ---------------------------------------------------------------------------
// typeText — special character escaping
// ---------------------------------------------------------------------------
describe("typeText", () => {
  it("escapes spaces as %s", async () => {
    mockExec.mockResolvedValueOnce("");
    await androidMod.typeText("hello world", "dev1");
    expect(mockExec).toHaveBeenCalledWith(
      'adb -s dev1 shell input text "hello%sworld"'
    );
  });

  it("escapes ampersands, angle brackets, pipes, semicolons", async () => {
    mockExec.mockResolvedValueOnce("");
    await androidMod.typeText("a&b<c>d|e;f", "dev1");
    const cmd = mockExec.mock.calls[0][0] as string;
    expect(cmd).toContain("\\&");
    expect(cmd).toContain("\\<");
    expect(cmd).toContain("\\>");
    expect(cmd).toContain("\\|");
    expect(cmd).toContain("\\;");
  });

  it("escapes parentheses and dollar signs", async () => {
    mockExec.mockResolvedValueOnce("");
    await androidMod.typeText("$(cmd)", "dev1");
    const cmd = mockExec.mock.calls[0][0] as string;
    expect(cmd).toContain("\\$");
    expect(cmd).toContain("\\(");
    expect(cmd).toContain("\\)");
  });

  it("escapes backticks", async () => {
    mockExec.mockResolvedValueOnce("");
    await androidMod.typeText("hello`world", "dev1");
    const cmd = mockExec.mock.calls[0][0] as string;
    expect(cmd).toContain("\\`");
  });
});

// ---------------------------------------------------------------------------
// pressKey — keycode mapping
// ---------------------------------------------------------------------------
describe("pressKey", () => {
  it("maps 'home' to keyevent 3", async () => {
    mockExec.mockResolvedValueOnce("");
    await androidMod.pressKey("home", "dev1");
    expect(mockExec).toHaveBeenCalledWith(
      "adb -s dev1 shell input keyevent 3"
    );
  });

  it("maps 'back' to keyevent 4", async () => {
    mockExec.mockResolvedValueOnce("");
    await androidMod.pressKey("back", "dev1");
    expect(mockExec).toHaveBeenCalledWith(
      "adb -s dev1 shell input keyevent 4"
    );
  });

  it("maps 'enter' to keyevent 66", async () => {
    mockExec.mockResolvedValueOnce("");
    await androidMod.pressKey("enter", "dev1");
    expect(mockExec).toHaveBeenCalledWith(
      "adb -s dev1 shell input keyevent 66"
    );
  });

  it("maps 'recent_apps' to keyevent 187", async () => {
    mockExec.mockResolvedValueOnce("");
    await androidMod.pressKey("recent_apps", "dev1");
    expect(mockExec).toHaveBeenCalledWith(
      "adb -s dev1 shell input keyevent 187"
    );
  });

  it("throws for unknown keys", async () => {
    await expect(androidMod.pressKey("unknown_key", "dev1")).rejects.toThrow(
      /Unknown key: unknown_key/
    );
  });
});

// ---------------------------------------------------------------------------
// screenshot — command construction
// ---------------------------------------------------------------------------
describe("screenshot", () => {
  it("calls exec-out screencap -p with 30s timeout", async () => {
    mockExecBuffer.mockResolvedValueOnce(Buffer.from("PNG"));
    await androidMod.screenshot("dev1");
    expect(mockExecBuffer).toHaveBeenCalledWith(
      "adb -s dev1 exec-out screencap -p",
      { timeout: 30_000 }
    );
  });
});

// ---------------------------------------------------------------------------
// getScreenInfo — parsing wm size / wm density output
// ---------------------------------------------------------------------------
describe("getScreenInfo", () => {
  it("parses portrait orientation correctly", async () => {
    // resolveDevice
    mockExec.mockResolvedValueOnce("Physical size: 1080x1920");
    mockExec.mockResolvedValueOnce("Physical density: 420");

    const info = await androidMod.getScreenInfo("dev1");
    expect(info).toEqual({
      width: 1080,
      height: 1920,
      density: 420,
      orientation: "portrait",
    });
  });

  it("detects landscape when width > height", async () => {
    mockExec.mockResolvedValueOnce("Physical size: 1920x1080");
    mockExec.mockResolvedValueOnce("Physical density: 320");

    const info = await androidMod.getScreenInfo("dev1");
    expect(info.orientation).toBe("landscape");
  });

  it("defaults to zero when parsing fails", async () => {
    mockExec.mockResolvedValueOnce("No size info");
    mockExec.mockResolvedValueOnce("No density info");

    const info = await androidMod.getScreenInfo("dev1");
    expect(info.width).toBe(0);
    expect(info.height).toBe(0);
    expect(info.density).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// launchApp / openUrl — command construction
// ---------------------------------------------------------------------------
describe("launchApp", () => {
  it("builds the correct monkey command", async () => {
    mockExec.mockResolvedValueOnce("");
    await androidMod.launchApp("com.example.app", "dev1");
    expect(mockExec).toHaveBeenCalledWith(
      "adb -s dev1 shell monkey -p com.example.app -c android.intent.category.LAUNCHER 1"
    );
  });
});

describe("openUrl", () => {
  it("builds the correct am start command with the URL", async () => {
    mockExec.mockResolvedValueOnce("");
    await androidMod.openUrl("https://example.com", "dev1");
    expect(mockExec).toHaveBeenCalledWith(
      'adb -s dev1 shell am start -a android.intent.action.VIEW -d "https://example.com"'
    );
  });
});

// ---------------------------------------------------------------------------
// getUiTree — XML parsing (exercised via the internal parseUiXml)
// ---------------------------------------------------------------------------
describe("getUiTree", () => {
  const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy rotation="0">
  <node index="0" text="Settings" resource-id="com.android.settings:id/title" class="android.widget.TextView" content-desc="" clickable="true" enabled="true" focused="false" bounds="[0,100][540,150]" />
  <node index="1" text="" resource-id="" class="android.view.View" content-desc="Search" clickable="false" enabled="true" focused="false" bounds="[600,100][700,200]" />
</hierarchy>`;

  it("parses node elements from valid XML with correct bounds and center", async () => {
    // dumpUiViaTty succeeds
    mockExec.mockResolvedValueOnce(sampleXml);

    const elements = await androidMod.getUiTree("dev1");
    expect(elements).toHaveLength(2);

    // First element
    expect(elements[0].type).toBe("TextView");
    expect(elements[0].text).toBe("Settings");
    expect(elements[0].bounds).toEqual({ x: 0, y: 100, width: 540, height: 50 });
    expect(elements[0].center_x).toBe(270);
    expect(elements[0].center_y).toBe(125);
    expect(elements[0].clickable).toBe(true);
    expect(elements[0].resource_id).toBe("title"); // package prefix stripped
    expect(elements[0].enabled).toBe(true);
    expect(elements[0].focused).toBe(false);
  });

  it("uses content-desc as text when text attribute is empty", async () => {
    mockExec.mockResolvedValueOnce(sampleXml);
    const elements = await androidMod.getUiTree("dev1");
    // Second element has empty text but content-desc="Search"
    expect(elements[1].text).toBe("Search");
  });

  it("strips package prefix from resource-id", async () => {
    mockExec.mockResolvedValueOnce(sampleXml);
    const elements = await androidMod.getUiTree("dev1");
    expect(elements[0].resource_id).toBe("title");
  });

  it("sets resource_id to undefined when resource-id is empty", async () => {
    mockExec.mockResolvedValueOnce(sampleXml);
    const elements = await androidMod.getUiTree("dev1");
    expect(elements[1].resource_id).toBeUndefined();
  });

  it("throws after all 4 strategies fail", async () => {
    // All exec calls fail
    mockExec.mockRejectedValue(new Error("dump failed"));
    await expect(androidMod.getUiTree("dev1")).rejects.toThrow(
      /Failed to parse UI tree XML/
    );
  });
});
