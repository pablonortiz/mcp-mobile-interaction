import sharp from "sharp";
import { isUniformImage } from "../../src/utils/image.js";

async function solidPng(r: number, g: number, b: number): Promise<Buffer> {
  return sharp({ create: { width: 8, height: 8, channels: 3, background: { r, g, b } } })
    .png()
    .toBuffer();
}

describe("isUniformImage", () => {
  it("detects a dead (solid black) frame", async () => {
    expect(await isUniformImage(await solidPng(0, 0, 0))).toBe(true);
  });

  it("detects any solid color as uniform", async () => {
    expect(await isUniformImage(await solidPng(120, 30, 200))).toBe(true);
  });

  it("accepts an image with real content", async () => {
    const half = await sharp({
      create: { width: 8, height: 8, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .composite([
        {
          input: { create: { width: 4, height: 8, channels: 3, background: { r: 255, g: 255, b: 255 } } },
          left: 0,
          top: 0,
        },
      ])
      .png()
      .toBuffer();

    expect(await isUniformImage(half)).toBe(false);
  });
});

describe("screencap noise", () => {
  it("finds the PNG start after a leading warning", () => {
    // A Galaxy Z Flip 7 prints 347 bytes about its two displays before the
    // image, which leaves the PNG unreadable if taken at face value.
    const warning = Buffer.from(
      "[Warning] Multiple displays were found, but no display id was specified!\n",
    );
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const noisy = Buffer.concat([warning, png]);

    const start = noisy.indexOf(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(start).toBe(warning.length);
    expect(noisy.subarray(start)).toEqual(png);
  });
});
