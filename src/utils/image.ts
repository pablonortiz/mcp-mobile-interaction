import sharp from "sharp";

export interface CropRegion {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface CompressOptions {
  quality?: number; // 1-100, default 50
  scale?: number; // 0.1-1.0, default 0.5
  region?: CropRegion; // crop (in native pixels) applied before scaling
}

export interface CompressResult {
  base64: string;
  width: number;
  height: number;
  nativeWidth: number;
  nativeHeight: number;
  scale: number;
}

export async function compressScreenshot(
  input: Buffer,
  options?: CompressOptions,
): Promise<CompressResult> {
  const quality = options?.quality ?? 50;
  const scale = options?.scale ?? 0.5;

  let image = sharp(input);
  const metadata = await image.metadata();

  const origWidth = metadata.width ?? 1080;
  const origHeight = metadata.height ?? 1920;

  let sourceWidth = origWidth;
  let sourceHeight = origHeight;

  if (options?.region) {
    const region = clampRegion(options.region, origWidth, origHeight);
    image = image.extract(region);
    sourceWidth = region.width;
    sourceHeight = region.height;
  }

  const newWidth = Math.max(1, Math.round(sourceWidth * scale));
  const newHeight = Math.max(1, Math.round(sourceHeight * scale));

  const buffer = await image
    .resize(newWidth, newHeight)
    .jpeg({ quality })
    .toBuffer();

  return {
    base64: buffer.toString("base64"),
    width: newWidth,
    height: newHeight,
    nativeWidth: origWidth,
    nativeHeight: origHeight,
    scale,
  };
}

function clampRegion(
  region: CropRegion,
  maxWidth: number,
  maxHeight: number,
): CropRegion {
  const left = Math.max(0, Math.min(Math.round(region.left), maxWidth - 1));
  const top = Math.max(0, Math.min(Math.round(region.top), maxHeight - 1));
  return {
    left,
    top,
    width: Math.max(1, Math.min(Math.round(region.width), maxWidth - left)),
    height: Math.max(1, Math.min(Math.round(region.height), maxHeight - top)),
  };
}
