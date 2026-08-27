import { jest } from "@jest/globals";

const mockRun = jest.fn<(file: string, args: string[], opts?: any) => Promise<string>>();

jest.unstable_mockModule("../../src/utils/exec.js", () => ({
  run: mockRun,
  runBuffer: jest.fn(),
  spawnProc: jest.fn(),
  shellQuote: (value: string) => `'${value}'`,
}));

const android = await import("../../src/platforms/android.js");

beforeEach(() => {
  jest.clearAllMocks();
  android.resetCaches();
});

function devicesOutput(...ids: string[]): string {
  return ["List of devices attached", ...ids.map((id) => `${id}\tdevice`)].join("\n");
}

describe("classifyDevice", () => {
  it("recognizes an emulator", () => {
    expect(android.classifyDevice("emulator-5554")).toBe("emulator");
  });

  it("recognizes a network target by its host:port form", () => {
    expect(android.classifyDevice("192.168.1.50:5555")).toBe("network");
  });

  it("treats a plain serial as a USB device", () => {
    expect(android.classifyDevice("R58M20XXXXX")).toBe("usb");
  });
});

describe("getFirstDeviceId", () => {
  it("uses the only connected device", async () => {
    mockRun.mockResolvedValue(devicesOutput("emulator-5554"));
    expect(await android.getFirstDeviceId()).toBe("emulator-5554");
  });

  it("refuses to guess between several devices", async () => {
    mockRun.mockResolvedValue(devicesOutput("emulator-5554", "192.168.1.50:5555"));
    await expect(android.getFirstDeviceId()).rejects.toThrow(
      /2 Android devices are connected/,
    );
  });

  it("names the kind of each candidate so a TV is recognizable", async () => {
    mockRun.mockResolvedValue(devicesOutput("emulator-5554", "192.168.1.50:5555"));
    await expect(android.getFirstDeviceId()).rejects.toThrow(/network/);
  });

  it("still reports when nothing is connected", async () => {
    mockRun.mockResolvedValue("List of devices attached");
    await expect(android.getFirstDeviceId()).rejects.toThrow(
      /No connected Android devices/,
    );
  });

  it("drops the cached device once it stops answering", async () => {
    mockRun.mockResolvedValue(devicesOutput("emulator-5554"));
    await android.getFirstDeviceId();

    mockRun.mockRejectedValueOnce(new Error("device 'emulator-5554' not found"));
    await expect(android.getLogs("emulator-5554", {})).rejects.toThrow();

    mockRun.mockResolvedValue(devicesOutput("emulator-5556"));
    expect(await android.getFirstDeviceId()).toBe("emulator-5556");
  });
});
