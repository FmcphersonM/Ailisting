// Keeps track of photos while they are being shrunk and uploaded. It lives
// outside the screens so uploads continue when you move around the app.

import { useSyncExternalStore } from "react";
import { api } from "../api";
import { kindOf, shrinkPhoto } from "./images";
import { extractSharpFrames } from "./video";

export interface UploadEntry {
  key: string;
  previewUrl: string;
  source: "photo" | "video";
  state: "uploading" | "done" | "error";
  photoId?: string;
  error?: string;
}

export interface PendingFile {
  key: string;
  name: string;
  kind: "image" | "video";
  progress: number; // 0..1, used for videos
}

export interface UploadState {
  entries: UploadEntry[];
  pending: PendingFile[]; // files still being prepared on the phone
  problems: string[];
  busy: boolean;
}

const EMPTY: UploadState = { entries: [], pending: [], problems: [], busy: false };
const UPLOADS_AT_ONCE = 3;

class BatchUploads {
  state: UploadState = EMPTY;
  private listeners = new Set<() => void>();
  private blobs = new Map<string, Blob>();
  private queue: string[] = [];
  private active = 0;
  private nextPosition = 0;
  private counter = 0;
  private preparing: Promise<void> = Promise.resolve();

  constructor(
    private batchId: string,
    private maxPhotos: number,
  ) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getState = () => this.state;

  private set(change: Partial<UploadState>) {
    const next = { ...this.state, ...change };
    next.busy = next.pending.length > 0 || next.entries.some((e) => e.state === "uploading");
    this.state = next;
    this.listeners.forEach((l) => l());
  }

  private serverCount = 0;

  /** Tell the uploader how many photos the server already has for this batch. */
  setServerCount(count: number) {
    this.serverCount = count;
    this.nextPosition = Math.max(this.nextPosition, count);
  }

  private roomLeft(): number {
    const notYetOnServer = this.state.entries.filter((e) => e.state === "uploading").length;
    const justUploaded = this.state.entries.filter((e) => e.state === "done").length;
    // Photos uploaded a moment ago may not be counted by the server number yet.
    return this.maxPhotos - Math.max(this.serverCount, justUploaded) - notYetOnServer;
  }

  /** Files are prepared one after another to keep the phone's memory use low. */
  addFiles(files: File[]) {
    const accepted: { file: File; pending: PendingFile }[] = [];
    const problems: string[] = [];
    for (const file of files) {
      const kind = kindOf(file);
      if (kind === "unknown") {
        problems.push(`"${file.name}" is not a photo or video.`);
        continue;
      }
      accepted.push({ file, pending: { key: `f${++this.counter}`, name: file.name, kind, progress: 0 } });
    }
    this.set({
      pending: [...this.state.pending, ...accepted.map((a) => a.pending)],
      problems: [...this.state.problems, ...problems],
    });

    for (const { file, pending } of accepted) {
      this.preparing = this.preparing.then(async () => {
        try {
          if (this.roomLeft() <= 0) {
            this.addProblem(`Only ${this.maxPhotos} photos fit in one go. The rest were left out.`);
            return;
          }
          if (pending.kind === "image") {
            let blob: Blob;
            try {
              blob = (await shrinkPhoto(file)).blob;
            } catch {
              blob = file; // let the server try; it will say so if it cannot read it
            }
            this.enqueue(blob, "photo");
          } else {
            const frames = await extractSharpFrames(file, (done, total) => {
              this.set({
                pending: this.state.pending.map((p) => (p.key === pending.key ? { ...p, progress: done / total } : p)),
              });
            });
            for (const frame of frames) {
              if (this.roomLeft() <= 0) {
                this.addProblem(`Only ${this.maxPhotos} photos fit in one go. The rest were left out.`);
                break;
              }
              this.enqueue(frame.blob, "video");
            }
          }
        } catch (err) {
          this.addProblem(`${file.name}: ${err instanceof Error ? err.message : "could not be read."}`);
        } finally {
          this.set({ pending: this.state.pending.filter((p) => p.key !== pending.key) });
        }
      });
    }
  }

  private addProblem(text: string) {
    if (!this.state.problems.includes(text)) this.set({ problems: [...this.state.problems, text] });
  }

  private enqueue(blob: Blob, source: "photo" | "video") {
    const key = `u${++this.counter}`;
    this.blobs.set(key, blob);
    this.set({
      entries: [...this.state.entries, { key, previewUrl: URL.createObjectURL(blob), source, state: "uploading" }],
    });
    this.queue.push(key);
    this.pump();
  }

  private patch(key: string, change: Partial<UploadEntry>) {
    this.set({ entries: this.state.entries.map((e) => (e.key === key ? { ...e, ...change } : e)) });
  }

  private pump() {
    while (this.active < UPLOADS_AT_ONCE && this.queue.length > 0) {
      const key = this.queue.shift() as string;
      const entry = this.state.entries.find((e) => e.key === key);
      const blob = this.blobs.get(key);
      if (!entry || !blob) continue;
      this.active++;
      const position = this.nextPosition++;
      this.upload(key, blob, position, entry.source).finally(() => {
        this.active--;
        this.pump();
      });
    }
  }

  private async upload(key: string, blob: Blob, position: number, source: "photo" | "video") {
    let lastError = "Upload failed.";
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const result = await api.uploadPhoto(this.batchId, blob, position, source);
        this.blobs.delete(key);
        this.patch(key, { state: "done", photoId: result.id, error: undefined });
        return;
      } catch (err) {
        lastError = err instanceof Error ? err.message : lastError;
        const status = (err as { status?: number }).status ?? 0;
        if (status >= 400 && status < 500) break; // trying again will not help
        await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
      }
    }
    this.patch(key, { state: "error", error: lastError });
  }

  retry(key: string) {
    if (!this.blobs.has(key)) return;
    this.patch(key, { state: "uploading", error: undefined });
    this.queue.push(key);
    this.pump();
  }

  remove(key: string) {
    const entry = this.state.entries.find((e) => e.key === key);
    if (entry) URL.revokeObjectURL(entry.previewUrl);
    this.blobs.delete(key);
    this.queue = this.queue.filter((k) => k !== key);
    this.set({ entries: this.state.entries.filter((e) => e.key !== key) });
  }

  clearProblems() {
    this.set({ problems: [] });
  }
}

const all = new Map<string, BatchUploads>();

export function uploadsFor(batchId: string, maxPhotos = 40): BatchUploads {
  let uploads = all.get(batchId);
  if (!uploads) {
    uploads = new BatchUploads(batchId, maxPhotos);
    all.set(batchId, uploads);
  }
  return uploads;
}

export function useUploads(batchId: string, maxPhotos = 40): [UploadState, BatchUploads] {
  const uploads = uploadsFor(batchId, maxPhotos);
  const state = useSyncExternalStore(uploads.subscribe, uploads.getState);
  return [state, uploads];
}
