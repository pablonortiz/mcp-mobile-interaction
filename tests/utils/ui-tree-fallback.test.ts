import { jest } from "@jest/globals";
import sharp from "sharp";

const mockScreenshot = jest.fn<() => Promise<Buffer>>();
const mockGetForegroundApp = jest.fn<() => Promise<{ package: string }>>();

jest.unstable_mockModule("../../src/platforms/driver.js", () => ({
  getDriver: () => ({
    screenshot: mockScreenshot,
    getForegroundApp: mockGetForegroundApp,
    getFirstDeviceId: async () => "emulator-5554",
  }),
}));

const { UiTreeUnavailableError } = await import(
  "../../src/platforms/android.js"
);
const { degradedUiTreeResponse, isUiTreeFailure, uiTreeSafe } = await import(
  "../../src/utils/ui-tree-fallback.js"
);

async function realPng(): Promise<Buffer> {
  return sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 0, g: 0, b: 0 } },
  })
    .composite([
      {
        input: {
          create: { width: 4, height: 8, channels: 3, background: { r: 255, g: 255, b: 255 } },
        },
        left: 0,
        top: 0,
      },
    ])
    .png()
    .toBuffer();
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetForegroundApp.mockResolvedValue({ package: "com.example.stock.beta" });
});

describe("degradedUiTreeResponse", () => {
  it("returns the reason, the foreground app and a usable screenshot", async () => {
    mockScreenshot.mockResolvedValue(await realPng());
    const response = await degradedUiTreeResponse(
      "android",
      "emulator-5554",
      new UiTreeUnavailableError("no-idle", 6),
      "tap the element",
    );

    const text = response.content.find((part) => part.type === "text");
    expect(text?.text).toContain("never went idle");
    expect(text?.text).toContain("com.example.stock.beta");
    expect(response.content.some((part) => part.type === "image")).toBe(true);
    expect(response.isError).toBe(true);
  });

  it("says so when not even a screenshot can be captured", async () => {
    mockScreenshot.mockRejectedValue(new Error("device offline"));
    const response = await degradedUiTreeResponse(
      "android",
      undefined,
      new UiTreeUnavailableError("device-gone", 2),
      "read the UI tree",
    );
    const text = response.content.find((part) => part.type === "text");
    expect(text?.text).toContain("No screenshot could be captured");
  });

  it("drops a dead frame instead of attaching a black image", async () => {
    mockScreenshot.mockResolvedValue(
      await sharp({
        create: { width: 8, height: 8, channels: 3, background: { r: 0, g: 0, b: 0 } },
      })
        .png()
        .toBuffer(),
    );
    const response = await degradedUiTreeResponse(
      "android",
      "emulator-5554",
      new UiTreeUnavailableError("no-idle", 6),
      "read the UI tree",
    );
    expect(response.content.some((part) => part.type === "image")).toBe(false);
  });
});

describe("uiTreeSafe", () => {
  it("passes successful results through untouched", async () => {
    const handler = uiTreeSafe("read the UI tree", async () => ({ ok: true }));
    expect(await handler({ platform: "android" })).toEqual({ ok: true });
  });

  it("degrades a dump failure to a screenshot response", async () => {
    mockScreenshot.mockResolvedValue(await realPng());
    const handler = uiTreeSafe("read the UI tree", async () => {
      throw new UiTreeUnavailableError("no-idle", 6);
    });
    const response = (await handler({ platform: "android" })) as {
      isError?: boolean;
    };
    expect(response.isError).toBe(true);
  });

  it("lets unrelated errors surface as themselves", async () => {
    const handler = uiTreeSafe("read the UI tree", async () => {
      throw new Error("app not installed");
    });
    await expect(handler({ platform: "android" })).rejects.toThrow(
      "app not installed",
    );
  });
});

describe("isUiTreeFailure", () => {
  it("recognizes the typed dump error", () => {
    expect(isUiTreeFailure(new UiTreeUnavailableError("no-idle", 6))).toBe(true);
  });

  it("does not claim unrelated errors", () => {
    expect(isUiTreeFailure(new Error("device not found"))).toBe(false);
  });
});
