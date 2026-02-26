/**
 * Tests for src/utils/image.ts — compressScreenshot
 *
 * We mock the sharp library so we don't need a real image.
 * The test verifies that compressScreenshot:
 *   - reads metadata to get original dimensions
 *   - applies scale factor to compute new dimensions
 *   - passes the correct JPEG quality
 *   - returns base64 encoded output with correct width/height
 */

import { jest } from "@jest/globals";

const mockToBuffer = jest.fn<() => Promise<Buffer>>();
const mockJpeg = jest.fn().mockReturnValue({ toBuffer: mockToBuffer });
const mockResize = jest.fn().mockReturnValue({ jpeg: mockJpeg });
const mockMetadata = jest.fn<() => Promise<{ width?: number; height?: number }>>();

const mockSharp = jest.fn().mockReturnValue({
  metadata: mockMetadata,
  resize: mockResize,
});

jest.unstable_mockModule("sharp", () => ({
  default: mockSharp,
}));

const { compressScreenshot } = await import("../../src/utils/image.js");

beforeEach(() => {
  jest.clearAllMocks();
  // Reset the chain
  mockSharp.mockReturnValue({
    metadata: mockMetadata,
    resize: mockResize,
  });
  mockResize.mockReturnValue({ jpeg: mockJpeg });
  mockJpeg.mockReturnValue({ toBuffer: mockToBuffer });
});

describe("compressScreenshot", () => {
  it("returns scaled dimensions and base64 with default options", async () => {
    mockMetadata.mockResolvedValueOnce({ width: 1080, height: 1920 });
    mockToBuffer.mockResolvedValueOnce(Buffer.from("compressed-image"));

    const result = await compressScreenshot(Buffer.from("raw-png"));

    // Default scale=0.5 => 540x960
    expect(mockResize).toHaveBeenCalledWith(540, 960);
    // Default quality=50
    expect(mockJpeg).toHaveBeenCalledWith({ quality: 50 });
    expect(result.width).toBe(540);
    expect(result.height).toBe(960);
    expect(result.base64).toBe(Buffer.from("compressed-image").toString("base64"));
  });

  it("respects custom quality and scale", async () => {
    mockMetadata.mockResolvedValueOnce({ width: 2000, height: 3000 });
    mockToBuffer.mockResolvedValueOnce(Buffer.from("img"));

    const result = await compressScreenshot(Buffer.from("input"), {
      quality: 80,
      scale: 0.25,
    });

    expect(mockResize).toHaveBeenCalledWith(500, 750);
    expect(mockJpeg).toHaveBeenCalledWith({ quality: 80 });
    expect(result.width).toBe(500);
    expect(result.height).toBe(750);
  });

  it("falls back to 1080x1920 when metadata has no dimensions", async () => {
    mockMetadata.mockResolvedValueOnce({}); // no width/height
    mockToBuffer.mockResolvedValueOnce(Buffer.from("data"));

    const result = await compressScreenshot(Buffer.from("input"));

    // Defaults: 1080*0.5=540, 1920*0.5=960
    expect(mockResize).toHaveBeenCalledWith(540, 960);
    expect(result.width).toBe(540);
    expect(result.height).toBe(960);
  });

  it("rounds dimensions correctly for odd sizes", async () => {
    mockMetadata.mockResolvedValueOnce({ width: 1081, height: 1921 });
    mockToBuffer.mockResolvedValueOnce(Buffer.from("data"));

    const result = await compressScreenshot(Buffer.from("input"), { scale: 0.5 });

    // Math.round(1081*0.5) = 541, Math.round(1921*0.5) = 961
    expect(result.width).toBe(541);
    expect(result.height).toBe(961);
  });

  it("handles scale of 1.0 (no scaling)", async () => {
    mockMetadata.mockResolvedValueOnce({ width: 500, height: 800 });
    mockToBuffer.mockResolvedValueOnce(Buffer.from("full"));

    const result = await compressScreenshot(Buffer.from("input"), { scale: 1.0 });

    expect(mockResize).toHaveBeenCalledWith(500, 800);
    expect(result.width).toBe(500);
    expect(result.height).toBe(800);
  });
});
