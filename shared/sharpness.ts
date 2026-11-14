// Used by both the phone app (to choose video frames) and the server (to spot
// soft photos), so the two always agree on what "sharp" means.

/**
 * How sharp a picture is, judged by how abruptly its strongest edges go from
 * dark to light.
 *
 * The result is roughly "1 divided by the edge width in pixels":
 *   about 0.25 or more  crisp
 *   about 0.20          soft
 *   about 0.15 or less  clearly blurry
 *
 * Counting edges would not work, because a plain item on a plain floor has
 * few edges even when it is perfectly in focus. Measuring how steep the
 * edges are does not depend on how many there are.
 *
 * `gray` holds one brightness value (0-255) per pixel, row by row.
 *
 * `judgeBy` says which edges decide the result: 0.7 means "the better edges"
 * (forgiving of a background that is out of focus on purpose), 0.4 means
 * "the weaker edges" (catches the smear of a moving camera, which blurs in
 * one direction only).
 */
export function edgeSharpness(gray: ArrayLike<number>, width: number, height: number, judgeBy = 0.7): number {
  if (width < 16 || height < 16) return 0;
  const size = width * height;

  // 1. Smooth very slightly, so compression speckle and sensor noise are not
  //    mistaken for fine detail.
  const rows = new Float32Array(size);
  for (let y = 0; y < height; y++) {
    const o = y * width;
    rows[o] = gray[o];
    rows[o + width - 1] = gray[o + width - 1];
    for (let x = 1; x < width - 1; x++) rows[o + x] = (gray[o + x - 1] + 2 * gray[o + x] + gray[o + x + 1]) / 4;
  }
  const smooth = new Float32Array(size);
  for (let x = 0; x < width; x++) {
    smooth[x] = rows[x];
    smooth[size - width + x] = rows[size - width + x];
  }
  for (let y = 1; y < height - 1; y++) {
    const o = y * width;
    for (let x = 0; x < width; x++) smooth[o + x] = (rows[o + x - width] + 2 * rows[o + x] + rows[o + x + width]) / 4;
  }

  // 2. How steeply brightness changes at each point (looking at every other
  //    pixel is plenty and four times faster).
  const REACH = 6; // how far along an edge's direction we look for its full contrast
  const xs: number[] = [];
  const ys: number[] = [];
  const steepness: number[] = [];
  const histogram = new Uint32Array(256);
  for (let y = REACH + 1; y < height - REACH - 1; y += 2) {
    for (let x = REACH + 1; x < width - REACH - 1; x += 2) {
      const i = y * width + x;
      const gx = (smooth[i + 1] - smooth[i - 1]) / 2;
      const gy = (smooth[i + width] - smooth[i - width]) / 2;
      const g = Math.hypot(gx, gy);
      histogram[Math.min(255, Math.round(g))]++;
      if (g >= 4) {
        xs.push(x);
        ys.push(y);
        steepness.push(g);
      }
    }
  }
  if (steepness.length < 40) return 0.3; // nothing to judge by: assume it is fine

  // 3. Keep only the strongest edges (top 4%), where focus shows most clearly.
  let total = 0;
  for (const count of histogram) total += count;
  let seen = 0;
  let threshold = 255;
  for (let level = 255; level >= 0; level--) {
    seen += histogram[level];
    if (seen >= total * 0.04) {
      threshold = level;
      break;
    }
  }
  threshold = Math.max(4, threshold - 0.5);

  // 4. For each strong edge: how much of its full dark-to-light difference
  //    happens within one pixel? Sharp edges do it in one or two pixels.
  const ratios: number[] = [];
  for (let k = 0; k < steepness.length; k++) {
    const g = steepness[k];
    if (g < threshold) continue;
    const x = xs[k];
    const y = ys[k];
    const i = y * width + x;
    const dx = (smooth[i + 1] - smooth[i - 1]) / 2 / g;
    const dy = (smooth[i + width] - smooth[i - width]) / 2 / g;
    let low = Infinity;
    let high = -Infinity;
    for (let step = -REACH; step <= REACH; step++) {
      const value = smooth[Math.round(y + dy * step) * width + Math.round(x + dx * step)];
      if (value < low) low = value;
      if (value > high) high = value;
    }
    const contrast = high - low;
    if (contrast >= 12) ratios.push(g / contrast);
  }
  if (ratios.length < 40) return 0.3;

  // 5. Judge by the better edges: part of a photo is often out of focus on
  //    purpose (the background), and that should not count against it.
  ratios.sort((a, b) => a - b);
  return ratios[Math.min(ratios.length - 1, Math.floor(ratios.length * judgeBy))];
}

/** Below this a picture is soft and benefits from sharpening. */
export const SOFT_BELOW = 0.23;
/** Below this a picture is too blurry to rescue. */
export const BLURRY_BELOW = 0.16;
