import sharp from "sharp";

export interface CompressOptions {
  quality?: number; // 1-100, default 50
  scale?: number; // 0.1-1.0, default 0.5
}

export async function compressScreenshot(
  input: Buffer,
  options?: CompressOptions,
): Promise<{ base64: string; width: number; height: number }> {
  const quality = options?.quality ?? 50;
  const scale = options?.scale ?? 0.5;

  const image = sharp(input);
  const metadata = await image.metadata();

  const origWidth = metadata.width ?? 1080;
  const origHeight = metadata.height ?? 1920;

  const newWidth = Math.round(origWidth * scale);
  const newHeight = Math.round(origHeight * scale);

  const buffer = await image
    .resize(newWidth, newHeight)
    .jpeg({ quality })
    .toBuffer();

  return {
    base64: buffer.toString("base64"),
    width: newWidth,
    height: newHeight,
  };
}
