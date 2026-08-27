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
