// Shrinking photos on the phone before upload: faster on mobile data, cheaper
// for Claude to read, and it drops hidden details such as GPS position.

export const MAX_EDGE = 1568;
const JPEG_QUALITY = 0.84;

export interface Shrunk {
  blob: Blob;
  width: number;
  height: number;
}

function loadImage(file: Blob): Promise<{ image: HTMLImageElement; release: () => void }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve({ image, release: () => URL.revokeObjectURL(url) });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("This picture could not be opened."));
    };
    image.src = url;
  });
}

export function canvasToJpeg(canvas: HTMLCanvasElement, quality = JPEG_QUALITY): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not save the picture."))), "image/jpeg", quality);
  });
}

export function fitInside(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * Returns a JPEG no larger than MAX_EDGE on its longest side. The browser
 * applies the camera's rotation when it draws the image, so photos come out
 * the right way up.
 */
export async function shrinkPhoto(file: Blob): Promise<Shrunk> {
  const { image, release } = await loadImage(file);
  try {
    const size = fitInside(image.naturalWidth, image.naturalHeight, MAX_EDGE);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not prepare the picture.");
    ctx.fillStyle = "#ffffff"; // see-through pictures get a white background
    ctx.fillRect(0, 0, size.width, size.height);
    ctx.drawImage(image, 0, 0, size.width, size.height);
    const blob = await canvasToJpeg(canvas);
    canvas.width = 0; // hand the memory back straight away
    canvas.height = 0;
    return { blob, ...size };
  } finally {
    release();
  }
}

const IMAGE_EXT = /\.(jpe?g|png|heic|heif|webp|gif|avif|bmp|tiff?)$/i;
const VIDEO_EXT = /\.(mov|mp4|m4v|webm|3gp|avi|mkv)$/i;

export function kindOf(file: File): "image" | "video" | "unknown" {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (IMAGE_EXT.test(file.name)) return "image";
  if (VIDEO_EXT.test(file.name)) return "video";
  return "unknown";
}
