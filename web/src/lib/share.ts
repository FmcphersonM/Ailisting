// Getting an item's photos into the phone's camera roll.
//
// On iPhone and Android the share menu offers "Save Images". The photos are
// downloaded ahead of time, because the share menu may only be opened
// directly from a tap.

import type { Item } from "../api";

function slug(text: string): string {
  const s = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
  return s || "item";
}

export async function loadPhotoFiles(item: Item): Promise<File[]> {
  const name = slug(item.titleNo || item.label);
  const files: File[] = [];
  for (const [index, photo] of item.photos.entries()) {
    const response = await fetch(photo.url, { credentials: "same-origin" });
    if (!response.ok) throw new Error("Could not load the photos.");
    const blob = await response.blob();
    files.push(new File([blob], `${name}-${index + 1}.jpg`, { type: "image/jpeg" }));
  }
  return files;
}

export function canShareFiles(files: File[]): boolean {
  return files.length > 0 && typeof navigator.share === "function" && !!navigator.canShare?.({ files });
}

/** Returns "shared", "cancelled" or "downloaded". */
export async function savePhotos(files: File[]): Promise<"shared" | "cancelled" | "downloaded"> {
  if (canShareFiles(files)) {
    try {
      await navigator.share({ files });
      return "shared";
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return "cancelled";
      // Sharing failed for another reason: fall back to plain downloads.
    }
  }
  for (const file of files) {
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return "downloaded";
}
