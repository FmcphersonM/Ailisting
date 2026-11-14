// Pulling a few sharp still frames out of a short video, on the phone itself,
// so the whole video never has to be uploaded.

import { canvasToJpeg, fitInside, MAX_EDGE } from "./images";

export interface Frame {
  blob: Blob;
  time: number;
}

const MIN_FRAMES = 3;
const MAX_FRAMES = 12;
const SECONDS_PER_FRAME = 2; // aim for one kept frame per 2 seconds of video
const LOOKS_PER_FRAME = 3; // look at 3 moments, keep the sharpest
const SMALL_WIDTH = 160; // size used only for measuring sharpness

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
  const settled = new Promise<void>((resolve) => {
    if ("requestVideoFrameCallback" in video) {
      (video as HTMLVideoElement & { requestVideoFrameCallback(cb: () => void): number }).requestVideoFrameCallback(() =>
        resolve(),
      );
    }
  });
  return Promise.race([settled, pause(140)]).then(() => undefined);
}

async function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  if (Math.abs(video.currentTime - time) < 0.01 && video.readyState >= 2) return;
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

function toGray(pixels: Uint8ClampedArray): Float32Array {
  const gray = new Float32Array(pixels.length / 4);
  for (let i = 0, j = 0; i < pixels.length; i += 4, j++) {
    gray[j] = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
  }
  return gray;
}

/** Higher = sharper. Blurry frames have soft edges, so neighbouring pixels differ less. */
export function sharpness(gray: Float32Array, width: number, height: number): number {
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const edge = gray[i - width] + gray[i + width] + gray[i - 1] + gray[i + 1] - 4 * gray[i];
      sum += edge;
      sumSq += edge * edge;
      n++;
    }
  }
  if (n === 0) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

function averageDifference(a: Float32Array, b: Float32Array): number {
  let total = 0;
  for (let i = 0; i < a.length; i++) total += Math.abs(a[i] - b[i]);
  return total / a.length;
}

function brightness(gray: Float32Array): number {
  let total = 0;
  for (let i = 0; i < gray.length; i++) total += gray[i];
  return total / gray.length;
}

/**
 * Splits the video into equal parts and keeps the sharpest moment of each
 * part, skipping frames that look the same as the one before.
 */
export async function extractSharpFrames(
  file: Blob,
  onProgress?: (done: number, total: number) => void,
): Promise<Frame[]> {
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
    try {
      await Promise.race([video.play(), pause(2500)]);
    } catch {
      // Not allowed to play: seeking usually still works.
    }
    video.pause();

    const duration = await findDuration(video);
    if (!video.videoWidth || !video.videoHeight) throw new Error("This video has no picture.");

    const full = fitInside(video.videoWidth, video.videoHeight, MAX_EDGE);
    const fullCanvas = document.createElement("canvas");
    fullCanvas.width = full.width;
    fullCanvas.height = full.height;
    const fullCtx = fullCanvas.getContext("2d");

    const smallHeight = Math.max(2, Math.round((SMALL_WIDTH * video.videoHeight) / video.videoWidth));
    const smallCanvas = document.createElement("canvas");
    smallCanvas.width = SMALL_WIDTH;
    smallCanvas.height = smallHeight;
    const smallCtx = smallCanvas.getContext("2d", { willReadFrequently: true });
    if (!fullCtx || !smallCtx) throw new Error("Could not prepare the video.");

    const parts = Math.min(MAX_FRAMES, Math.max(MIN_FRAMES, Math.round(duration / SECONDS_PER_FRAME)));
    const partLength = duration / parts;
    const total = parts * LOOKS_PER_FRAME;
    let done = 0;
    let sawPicture = false;

    const frames: Frame[] = [];
    let previousGray: Float32Array | null = null;

    for (let part = 0; part < parts; part++) {
      let best: { score: number; blob: Blob; gray: Float32Array; time: number } | null = null;
      for (let look = 0; look < LOOKS_PER_FRAME; look++) {
        const time = Math.min(duration - 0.05, part * partLength + (partLength * (look + 0.5)) / LOOKS_PER_FRAME);
        try {
          await seekTo(video, Math.max(0, time));
          smallCtx.drawImage(video, 0, 0, SMALL_WIDTH, smallHeight);
          const gray = toGray(smallCtx.getImageData(0, 0, SMALL_WIDTH, smallHeight).data);
          if (brightness(gray) > 4) sawPicture = true;
          const score = sharpness(gray, SMALL_WIDTH, smallHeight);
          if (!best || score > best.score) {
            fullCtx.drawImage(video, 0, 0, full.width, full.height);
            best = { score, blob: await canvasToJpeg(fullCanvas, 0.86), gray, time };
          }
        } catch {
          // Skip a moment that cannot be read; the other looks may work.
        }
        done++;
        onProgress?.(done, total);
      }
      if (!best) continue;
      const sameAsBefore = previousGray !== null && averageDifference(previousGray, best.gray) < 5;
      if (sameAsBefore) continue;
      frames.push({ blob: best.blob, time: best.time });
      previousGray = best.gray;
    }

    fullCanvas.width = 0;
    smallCanvas.width = 0;
    if (frames.length === 0 || !sawPicture) {
      throw new Error("Could not read pictures from this video. Try photos instead.");
    }
    return frames;
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
    video.remove();
    URL.revokeObjectURL(url);
  }
}
