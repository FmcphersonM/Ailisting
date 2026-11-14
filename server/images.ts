import sharp from "sharp";

// Keep memory use low on a small server.
sharp.cache(false);
sharp.concurrency(1);

/** Longest side we keep. Matches what Claude reads well without paying for more. */
export const MAX_EDGE = 1568;
/** Smaller copy used only for the "which photo shows which item" step. */
const GROUPING_EDGE = 1024;
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

export async function forGrouping(input: Buffer): Promise<Picture> {
  const { data, info } = await sharp(input)
    .resize({ width: GROUPING_EDGE, height: GROUPING_EDGE, fit: "inside", withoutEnlargement: true })
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
 * Returns null when the box is unusable or covers nearly the whole photo.
 */
export function scaleBox(
  aiBox: number[] | null | undefined,
  seen: { width: number; height: number },
  full: { width: number; height: number },
): Box | null {
  if (!aiBox || aiBox.length !== 4 || aiBox.some((v) => !Number.isFinite(v))) return null;
  const sx = full.width / seen.width;
  const sy = full.height / seen.height;
  let [x1, y1, x2, y2] = aiBox;
  if (x2 < x1) [x1, x2] = [x2, x1];
  if (y2 < y1) [y1, y2] = [y2, y1];
  const padX = (x2 - x1) * 0.07;
  const padY = (y2 - y1) * 0.07;
  const left = Math.max(0, Math.floor((x1 - padX) * sx));
  const top = Math.max(0, Math.floor((y1 - padY) * sy));
  const right = Math.min(full.width, Math.ceil((x2 + padX) * sx));
  const bottom = Math.min(full.height, Math.ceil((y2 + padY) * sy));
  const w = right - left;
  const h = bottom - top;
  if (w < 24 || h < 24) return null;
  const share = (w * h) / (full.width * full.height);
  if (share > 0.82) return null; // basically the whole photo: no need to cut
  return { x: left, y: top, w, h };
}
