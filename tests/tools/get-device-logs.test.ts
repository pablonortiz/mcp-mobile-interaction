import { jest } from "@jest/globals";
import { captureTool, callTool, textOf } from "../helpers/tool-harness.js";

const mockGetLogs = jest.fn<(id: string, opts: any) => Promise<string>>();
const mockDumpToFile = jest.fn<(id: string, path: string) => Promise<number>>();
const mockGetFirstDeviceId = jest.fn<() => Promise<string>>();

jest.unstable_mockModule("../../src/platforms/driver.js", () => ({
  getDriver: () => ({
    getLogs: mockGetLogs,
    getFirstDeviceId: mockGetFirstDeviceId,
  }),
}));

jest.unstable_mockModule("../../src/platforms/android.js", () => ({
  clearLogs: jest.fn(),
  dumpLogsToFile: mockDumpToFile,
}));

const { registerGetDeviceLogsTool } = await import(
  "../../src/tools/get-device-logs.js"
);

const tool = captureTool(registerGetDeviceLogsTool);

beforeEach(() => {
  jest.clearAllMocks();
  mockGetFirstDeviceId.mockResolvedValue("emulator-5554");
  mockGetLogs.mockResolvedValue("line a\nline b");
});

describe("get_device_logs", () => {
  it("pushes the search filter to the Android driver instead of filtering here", async () => {
    await callTool(tool, { platform: "android", search: "Fatal" });
    expect(mockGetLogs.mock.calls[0][1]).toMatchObject({ search: "Fatal" });
  });

  it("keeps filtering in-process for iOS, which has no device-side regex", async () => {
    mockGetLogs.mockResolvedValue("keep Fatal here\ndrop this one");
    const result = await callTool(tool, { platform: "ios", search: "fatal" });
    expect(mockGetLogs.mock.calls[0][1].search).toBeUndefined();
    expect(textOf(result)).toContain("keep Fatal here");
    expect(textOf(result)).not.toContain("drop this one");
  });

  it("writes the whole buffer to a file when a windowed read is not enough", async () => {
    mockDumpToFile.mockResolvedValue(28 * 1024 * 1024);
    const result = await callTool(tool, {
      platform: "android",
      dump_to_file: true,
    });
    expect(mockDumpToFile).toHaveBeenCalled();
    expect(textOf(result)).toContain("28.0 MB");
    expect(mockGetLogs).not.toHaveBeenCalled();
  });

  it("defaults to 50 lines", async () => {
    await callTool(tool, { platform: "android" });
    expect(mockGetLogs.mock.calls[0][1]).toMatchObject({ lines: 50 });
  });
});
