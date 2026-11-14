import sharp from "sharp";
import { edgeSharpness } from "../shared/sharpness.js";

// Keep memory use low on a small server.
sharp.cache(false);
sharp.concurrency(1);

/** Longest side we keep. Matches what Claude reads well without paying for more. */
export const MAX_EDGE = 1568;
/** Smaller copy used only for the "which photo shows which item" step. */
const GROUPING_EDGE = 1024;
const GROUPING_EDGE_VIDEO = 768;
const THUMB_EDGE = 400;

export interface Picture {
  data: Buffer;
  width: number;
  height: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Make an uploaded picture safe and small: correct rotation, cap the size,
 * and drop hidden details such as the GPS position where it was taken.
 * The phone normally does this already; this is the safety net.
 */
export async function normalizeUpload(input: Buffer): Promise<Picture> {
  const meta = await sharp(input).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height) throw new Error("That file is not a picture I can read.");

  const alreadyClean =
    meta.format === "jpeg" &&
    Math.max(width, height) <= MAX_EDGE + 32 &&
    !meta.exif &&
    !meta.xmp &&
    (meta.orientation ?? 1) === 1;
  if (alreadyClean) return { data: input, width, height };

  const { data, info } = await sharp(input)
    .rotate() // apply the camera's rotation, then forget it
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 84, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

export async function makeThumb(input: Buffer): Promise<Buffer> {
  return sharp(input)
    .resize({ width: THUMB_EDGE, height: THUMB_EDGE, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 72, mozjpeg: true })
    .toBuffer();
}

export async function forGrouping(input: Buffer, fromVideo: boolean): Promise<Picture> {
  // A video gives many frames of the same things, so smaller copies do the job for less.
  const edge = fromVideo ? GROUPING_EDGE_VIDEO : GROUPING_EDGE;
  const { data, info } = await sharp(input)
    .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 78, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** Cut one item out of a photo that shows several. */
export async function cropRegion(input: Buffer, box: Box): Promise<Picture> {
  const { data, info } = await sharp(input)
    .extract({ left: box.x, top: box.y, width: box.w, height: box.h })
    .jpeg({ quality: 86, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/**
 * Turn a box the AI gave (in the pixels of the smaller copy it saw) into a
 * box on the full-size photo, with a little breathing room around the item.
 * Returns null when the box is unusable, or when it covers so much of the
 * photo that cutting would change nothing worth changing.
 */
export function scaleBox(
  aiBox: number[] | null | undefined,
  seen: { width: number; height: number },
  full: { width: number; height: number },
  options: { margin: number; maxShare: number; minSide: number },
): Box | null {
  if (!aiBox || aiBox.length !== 4 || aiBox.some((v) => !Number.isFinite(v))) return null;
  const sx = full.width / seen.width;
  const sy = full.height / seen.height;
  let [x1, y1, x2, y2] = aiBox;
  if (x2 < x1) [x1, x2] = [x2, x1];
  if (y2 < y1) [y1, y2] = [y2, y1];
  const padX = (x2 - x1) * options.margin;
  const padY = (y2 - y1) * options.margin;
  const left = Math.max(0, Math.floor((x1 - padX) * sx));
  const top = Math.max(0, Math.floor((y1 - padY) * sy));
  const right = Math.min(full.width, Math.ceil((x2 + padX) * sx));
  const bottom = Math.min(full.height, Math.ceil((y2 + padY) * sy));
  const w = right - left;
  const h = bottom - top;
  if (w < options.minSide || h < options.minSide) return null;
  const share = (w * h) / (full.width * full.height);
  if (share > options.maxShare) return null;
  return { x: left, y: top, w, h };
}

/** One item cut out of a photo that shows several things. */
export const CUT_OUT = { margin: 0.07, maxShare: 0.82, minSide: 24 };
/**
 * Trimming messy surroundings from a photo of a single item. Only done when
 * the item fills a modest part of the picture and the result stays large
 * enough to look good.
 */
export const TIDY_CROP = { margin: 0.12, maxShare: 0.6, minSide: 420 };

// ---------------------------------------------------------------------------
// Sharpness
// ---------------------------------------------------------------------------

/** How sharp a picture is. See shared/sharpness.ts for what the number means. */
export async function measureSharpness(input: Buffer): Promise<number> {
  const { data, info } = await sharp(input)
    .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return edgeSharpness(data, info.width, info.height);
}

/**
 * Careful sharpening: it makes soft edges crisper without inventing detail
 * that was never in the photo.
 */
export async function sharpen(input: Buffer, strong: boolean): Promise<Picture> {
  const { data, info } = await sharp(input)
    .sharpen(strong ? { sigma: 1.5, m1: 1.0, m2: 3.0 } : { sigma: 1.0, m1: 0.8, m2: 2.0 })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}
