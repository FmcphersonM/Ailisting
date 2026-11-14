// Pulling good still frames out of a short video, on the phone itself, so the
// whole video never has to be uploaded.
//
// How it works:
//   1. A quick first look at a few moments decides whether the whole video is
//      washed out or dark (iPhone HDR video can come out that way in a
//      browser). If so, every saved frame gets its brightness range corrected.
//   2. Then it looks at the video about three times a second and measures
//      each moment: how sharp it is and how much the camera was moving.
//   3. The video is split into short stretches. The best moment of each
//      stretch is saved at full size.
//   4. Stretches that are smeared compared with their neighbours (the camera
//      moving between items) and near-repeats are dropped.

import { edgeSharpness } from "../../../shared/sharpness";
import { canvasToJpeg, fitInside, MAX_EDGE } from "./images";

export interface Frame {
  blob: Blob;
  time: number;
}

/** Numbers only, no pictures. Sent to the server log to help fix problems. */
export interface VideoReport {
  name: string;
  type: string;
  megabytes: number;
  seconds: number;
  width: number;
  height: number;
  played: boolean;
  looks: number;
  tookMs: number;
  blackPoint: number;
  whitePoint: number;
  levelsFixed: boolean;
  kept: { t: number; sharp: number; motion: number }[];
  dropped: { blurry: number; repeats: number; unusable: number };
}

const LOOK_EVERY = 0.3; // seconds between looks
const MAX_LOOKS = 130;
const SECONDS_PER_FRAME = 1.5; // aim for one kept frame per 1.5 seconds
const MIN_FRAMES = 3;
const MAX_FRAMES = 16;
const ANALYSIS_EDGE = 720; // size used for measuring, not for saving
const TINY = 32; // size used for "is this the same picture?" checks
const TIME_BUDGET_MS = 75_000;
const QUICK_LOOKS = 8; // moments checked up front for a washed-out or dark video

function once(target: EventTarget, name: string, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      target.removeEventListener(name, done);
      reject(new Error(`Timed out waiting for the video (${name}).`));
    }, ms);
    function done() {
      window.clearTimeout(timer);
      resolve();
    }
    target.addEventListener(name, done, { once: true });
  });
}

const pause = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

/** Wait until the frame for the current position is actually ready to draw. */
function nextPaintedFrame(video: HTMLVideoElement): Promise<void> {
  const painted = new Promise<void>((resolve) => {
    if ("requestVideoFrameCallback" in video) {
      (video as HTMLVideoElement & { requestVideoFrameCallback(cb: () => void): number }).requestVideoFrameCallback(() =>
        resolve(),
      );
    }
  });
  return Promise.race([painted, pause(90)]).then(() => undefined);
}

async function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  if (Math.abs(video.currentTime - time) < 0.005 && video.readyState >= 2) return;
  const seeked = once(video, "seeked", 5000);
  video.currentTime = time;
  await seeked;
  await nextPaintedFrame(video);
}

/** Some recordings report an unknown length until the end has been visited. */
async function findDuration(video: HTMLVideoElement): Promise<number> {
  if (Number.isFinite(video.duration) && video.duration > 0) return video.duration;
  try {
    const changed = once(video, "durationchange", 4000);
    video.currentTime = 1e7;
    await changed;
    video.currentTime = 0;
    await once(video, "seeked", 4000).catch(() => undefined);
  } catch {
    // fall through to the check below
  }
  if (Number.isFinite(video.duration) && video.duration > 0) return video.duration;
  throw new Error("Could not work out how long this video is.");
}

interface Look {
  time: number;
  sharp: number;
  motion: number; // how much the picture changed since the previous look
  mean: number; // average brightness, 0-255
  low: number; // brightness of the darkest 1%
  high: number; // brightness of the brightest 1%
  tiny: Uint8Array;
}

function measure(pixels: Uint8ClampedArray, width: number, height: number, time: number): Look {
  const gray = new Uint8Array(width * height);
  const histogram = new Uint32Array(256);
  let sum = 0;
  for (let i = 0, j = 0; i < pixels.length; i += 4, j++) {
    const value = Math.round(0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2]);
    gray[j] = value;
    histogram[value]++;
    sum += value;
  }
  const total = width * height;
  const percentile = (share: number) => {
    let seen = 0;
    for (let level = 0; level < 256; level++) {
      seen += histogram[level];
      if (seen >= total * share) return level;
    }
    return 255;
  };

  // A tiny copy, made by averaging blocks, for quick comparisons.
  const tiny = new Uint8Array(TINY * TINY);
  for (let ty = 0; ty < TINY; ty++) {
    const y0 = Math.floor((ty * height) / TINY);
    const y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * height) / TINY));
    for (let tx = 0; tx < TINY; tx++) {
      const x0 = Math.floor((tx * width) / TINY);
      const x1 = Math.max(x0 + 1, Math.floor(((tx + 1) * width) / TINY));
      let block = 0;
      for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) block += gray[y * width + x];
      tiny[ty * TINY + tx] = block / (Math.ceil((y1 - y0) / 2) * Math.ceil((x1 - x0) / 2));
    }
  }

  return {
    time,
    // 0.45: lean towards the weaker edges, which is where camera movement shows.
    sharp: edgeSharpness(gray, width, height, 0.45),
    motion: 0,
    mean: sum / total,
    low: percentile(0.01),
    high: percentile(0.99),
    tiny,
  };
}

function difference(a: Uint8Array, b: Uint8Array): number {
  let total = 0;
  for (let i = 0; i < a.length; i++) total += Math.abs(a[i] - b[i]);
  return total / a.length;
}

/**
 * Decides whether the whole video is washed out or dark, and if so returns a
 * table that maps each brightness value to a corrected one.
 *
 * A normal video has something near black and something near white in at
 * least a few moments. If it never does, the brightness range is squeezed,
 * which is what a browser does to iPhone HDR video.
 */
export function levelsTable(blackPoint: number, whitePoint: number): Uint8ClampedArray | null {
  if (blackPoint <= 26 && whitePoint >= 215) return null;
  const from = Math.max(0, blackPoint - 3);
  const to = Math.min(255, whitePoint + 3);
  if (to - from < 20) return null; // a flat picture: stretching would only add noise
  const gain = Math.min(1.7, 246 / (to - from)); // never more than a moderate correction
  const table = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) table[v] = Math.round((v - from) * gain + 4);
  return table;
}

function applyLevels(ctx: CanvasRenderingContext2D, width: number, height: number, table: Uint8ClampedArray): void {
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = table[data[i]];
    data[i + 1] = table[data[i + 1]];
    data[i + 2] = table[data[i + 2]];
  }
  ctx.putImageData(image, 0, 0);
}

export async function extractSharpFrames(
  file: Blob,
  onProgress?: (done: number, total: number) => void,
): Promise<{ frames: Frame[]; report: VideoReport }> {
  const started = performance.now();
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");
  // iPhones only decode frames for videos that are part of the page.
  video.style.cssText = "position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:-1";
  document.body.appendChild(video);

  try {
    const ready = once(video, "loadedmetadata", 30000);
    const failed = once(video, "error", 30000).then(() => {
      throw new Error("This video format cannot be read here.");
    });
    failed.catch(() => undefined); // whichever loses the race below must not raise an alarm later
    ready.catch(() => undefined);
    video.src = url;
    video.load();
    await Promise.race([ready, failed]);

    // Playing for an instant wakes up the decoder on iPhones.
    let played = false;
    try {
      await Promise.race([video.play().then(() => (played = true)), pause(2500)]);
    } catch {
      // Not allowed to play (for example in Low Power Mode): seeking usually still works.
    }
    video.pause();

    const duration = await findDuration(video);
    if (!video.videoWidth || !video.videoHeight) throw new Error("This video has no picture.");

    const full = fitInside(video.videoWidth, video.videoHeight, MAX_EDGE);
    const fullCanvas = document.createElement("canvas");
    fullCanvas.width = full.width;
    fullCanvas.height = full.height;
    const fullCtx = fullCanvas.getContext("2d", { willReadFrequently: true });

    const small = fitInside(video.videoWidth, video.videoHeight, ANALYSIS_EDGE);
    const smallCanvas = document.createElement("canvas");
    smallCanvas.width = small.width;
    smallCanvas.height = small.height;
    const smallCtx = smallCanvas.getContext("2d", { willReadFrequently: true });
    if (!fullCtx || !smallCtx) throw new Error("Could not prepare the video.");

    const lookAt = async (time: number): Promise<Look | null> => {
      try {
        await seekTo(video, Math.min(Math.max(0, time), Math.max(0, duration - 0.04)));
        smallCtx.drawImage(video, 0, 0, small.width, small.height);
        return measure(smallCtx.getImageData(0, 0, small.width, small.height).data, small.width, small.height, time);
      } catch {
        return null; // a moment that cannot be read; the others may work
      }
    };

    const wanted = Math.min(MAX_FRAMES, Math.max(MIN_FRAMES, Math.round(duration / SECONDS_PER_FRAME)));
    const lookCount = Math.min(MAX_LOOKS, Math.max(wanted * 3, Math.floor(duration / LOOK_EVERY)));
    const totalSteps = QUICK_LOOKS + lookCount;
    let step = 0;

    // ---- 1. Is the whole video washed out or dark? ----
    const quick: Look[] = [];
    for (let i = 0; i < QUICK_LOOKS; i++) {
      const look = await lookAt(((i + 0.5) * duration) / QUICK_LOOKS);
      if (look) quick.push(look);
      onProgress?.(++step, totalSteps);
    }
    if (quick.length === 0) throw new Error("Could not read pictures from this video. Try photos instead.");
    const blackPoint = Math.min(...quick.map((l) => l.low));
    const whitePoint = Math.max(...quick.map((l) => l.high));
    const table = levelsTable(blackPoint, whitePoint);

    // ---- 2 and 3. Look through the video; save the best moment of each stretch ----
    // Sharpness matters most; a steady camera earns a small bonus.
    const score = (l: Look) => l.sharp * (1 + 0.25 * (1 - Math.min(1, l.motion / 12)));
    const stretch = duration / wanted;
    const best = new Map<number, { look: Look; blob: Blob }>();
    let looks = 0;
    let unusable = 0;
    let previous: Look | null = null;
    for (let i = 0; i < lookCount; i++) {
      if (performance.now() - started > TIME_BUDGET_MS && best.size >= MIN_FRAMES) break;
      const look = await lookAt(((i + 0.5) * duration) / lookCount);
      onProgress?.(++step, totalSteps);
      if (!look) continue;
      looks++;
      look.motion = previous ? difference(previous.tiny, look.tiny) : 0;
      previous = look;
      if (look.mean <= 16 || look.mean >= 246) {
        unusable++; // nearly black or nearly white: nothing to see
        continue;
      }
      const index = Math.min(wanted - 1, Math.floor(look.time / stretch));
      const current = best.get(index);
      if (current && score(look) <= score(current.look)) continue;
      fullCtx.drawImage(video, 0, 0, full.width, full.height); // the video is still on this moment
      if (table) applyLevels(fullCtx, full.width, full.height, table);
      best.set(index, { look, blob: await canvasToJpeg(fullCanvas, 0.9) });
    }
    onProgress?.(totalSteps, totalSteps);

    // ---- 4. Drop smeared stretches and near-repeats ----
    let picks = [...best.entries()].sort((a, b) => a[0] - b[0]).map(([, value]) => value);
    // A stretch counts as smeared when it is clearly softer than the stretches
    // next to it. Comparing with neighbours, not with the whole video, keeps
    // things that are simply smooth (a metal cup, a plain wall) from being
    // thrown out next to something with lots of texture.
    const crisp = picks.filter((pick, i) => {
      const neighbours = [picks[i - 1], picks[i + 1]].filter(Boolean).map((n) => n.look.sharp);
      return neighbours.length === 0 || pick.look.sharp >= Math.max(...neighbours) * 0.75;
    });
    const droppedBlurry = crisp.length >= MIN_FRAMES ? picks.length - crisp.length : 0;
    if (crisp.length >= MIN_FRAMES) picks = crisp;

    const distinct: typeof picks = [];
    let droppedRepeats = 0;
    for (const pick of picks) {
      const twin = distinct.findIndex((kept) => difference(kept.look.tiny, pick.look.tiny) < 6);
      if (twin === -1) distinct.push(pick);
      else {
        droppedRepeats++;
        if (score(pick.look) > score(distinct[twin].look)) distinct[twin] = pick;
      }
    }
    distinct.sort((a, b) => a.look.time - b.look.time);

    const frames: Frame[] = distinct.map((pick) => ({ blob: pick.blob, time: pick.look.time }));
    const kept: VideoReport["kept"] = distinct.map((pick) => ({
      t: Math.round(pick.look.time * 100) / 100,
      sharp: Math.round(pick.look.sharp * 1000) / 1000,
      motion: Math.round(pick.look.motion * 10) / 10,
    }));

    fullCanvas.width = 0;
    smallCanvas.width = 0;
    if (frames.length === 0) throw new Error("Could not read pictures from this video. Try photos instead.");

    const named = file as Blob & { name?: string };
    return {
      frames,
      report: {
        name: named.name ?? "",
        type: file.type,
        megabytes: Math.round(file.size / 104857.6) / 10,
        seconds: Math.round(duration * 10) / 10,
        width: video.videoWidth,
        height: video.videoHeight,
        played,
        looks,
        tookMs: Math.round(performance.now() - started),
        blackPoint,
        whitePoint,
        levelsFixed: table !== null,
        kept,
        dropped: { blurry: droppedBlurry, repeats: droppedRepeats, unusable },
      },
    };
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
    video.remove();
    URL.revokeObjectURL(url);
  }
}
