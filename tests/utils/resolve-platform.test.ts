import { jest } from "@jest/globals";

const mockAndroidList = jest.fn<() => Promise<Array<{ id: string; status: string }>>>();
const mockIosList = jest.fn<() => Promise<Array<{ id: string; status: string }>>>();

jest.unstable_mockModule("../../src/platforms/android.js", () => ({
  listDevices: mockAndroidList,
}));
jest.unstable_mockModule("../../src/platforms/ios.js", () => ({
  listDevices: mockIosList,
}));

const { resolvePlatform, resetPlatformCache } = await import(
  "../../src/utils/resolve-platform.js"
);

beforeEach(() => {
  jest.clearAllMocks();
  resetPlatformCache();
  mockAndroidList.mockResolvedValue([]);
  mockIosList.mockResolvedValue([]);
});

describe("resolvePlatform", () => {
  it("respects an explicit platform without probing anything", async () => {
    expect(await resolvePlatform("ios")).toBe("ios");
    expect(mockAndroidList).not.toHaveBeenCalled();
    expect(mockIosList).not.toHaveBeenCalled();
  });

  it("infers android from a connected device", async () => {
    mockAndroidList.mockResolvedValue([{ id: "emulator-5554", status: "device" }]);
    expect(await resolvePlatform()).toBe("android");
  });

  it("infers ios when only a simulator is booted", async () => {
    mockIosList.mockResolvedValue([{ id: "UDID", status: "booted" }]);
    expect(await resolvePlatform()).toBe("ios");
  });

  it("ignores simulators that are merely available, not booted", async () => {
    mockAndroidList.mockResolvedValue([{ id: "emulator-5554", status: "device" }]);
    mockIosList.mockResolvedValue([{ id: "UDID", status: "shutdown" }]);
    expect(await resolvePlatform()).toBe("android");
  });

  it("asks for an explicit platform when both are live", async () => {
    mockAndroidList.mockResolvedValue([{ id: "emulator-5554", status: "device" }]);
    mockIosList.mockResolvedValue([{ id: "UDID", status: "booted" }]);
    await expect(resolvePlatform()).rejects.toThrow(/Pass platform explicitly/);
  });

  it("reports having found nothing at all", async () => {
    await expect(resolvePlatform()).rejects.toThrow(/No devices found/);
  });

  it("caches the inference so repeated calls stay cheap", async () => {
    mockAndroidList.mockResolvedValue([{ id: "emulator-5554", status: "device" }]);
    await resolvePlatform();
    await resolvePlatform();
    expect(mockAndroidList).toHaveBeenCalledTimes(1);
  });

  it("survives a platform whose device listing throws", async () => {
    mockAndroidList.mockRejectedValue(new Error("adb not installed"));
    mockIosList.mockResolvedValue([{ id: "UDID", status: "booted" }]);
    expect(await resolvePlatform()).toBe("ios");
  });
});
