// Talking to the server. Types here mirror what the server sends.

export interface Me {
  signedIn: boolean;
  access: "open" | "passcode" | "not_configured";
  aiReady: boolean;
  demoMode: boolean;
  model: string;
  usdToNok: number;
  maxPhotosPerBatch: number;
}

export interface Question {
  id: string;
  question: string;
  kind: "choice" | "text";
  options: string[];
  answer: string | null;
  skipped: boolean;
}

export interface ItemPhoto {
  id: string;
  url: string;
  thumbUrl: string;
  width: number;
  height: number;
  cutOut: boolean; // cut out of a photo that shows several things
  edited: boolean; // trimmed or sharpened by the app; the original is kept
  blurry: boolean;
}

export type Condition = "new" | "like_new" | "good" | "fair" | "needs_repair";
export type Platform = "finn" | "tise" | "facebook" | "ebay";

export interface Item {
  id: string;
  batchId: string | null;
  status: "draft" | "approved" | "listed" | "sold";
  aiState: "pending" | "working" | "ready" | "failed";
  aiError: string | null;
  label: string;
  titleNo: string;
  descriptionNo: string;
  titleEn: string;
  descriptionEn: string;
  category: string;
  categoryFinn: string;
  categoryEbay: string;
  condition: Condition;
  brand: string;
  model: string;
  priceNok: number | null;
  priceLowNok: number | null;
  priceHighNok: number | null;
  priceReason: string;
  questions: Question[];
  photosChanged: boolean;
  costUsd: number;
  photos: ItemPhoto[];
  postedOn: Platform[];
  createdAt: string;
  updatedAt: string;
}

export interface Batch {
  id: string;
  status: "uploading" | "analyzing" | "done" | "failed";
  stage: string | null;
  error: string | null;
  costUsd: number;
  createdAt: string;
  photos: { id: string; thumbUrl: string; source: string }[];
  items: Item[];
  questions: { id: string; photoId: string; thumbUrl: string; question: string; suggestedItemId: string | null }[];
}

export interface OpenBatch {
  id: string;
  status: string;
  photoCount: number;
  coverThumbUrl: string | null;
  createdAt: string;
}

export type ItemEdit = Partial<
  Pick<
    Item,
    | "titleNo"
    | "descriptionNo"
    | "titleEn"
    | "descriptionEn"
    | "category"
    | "categoryFinn"
    | "categoryEbay"
    | "condition"
    | "brand"
    | "model"
    | "priceNok"
  >
> & { status?: "draft" | "approved" };

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

let onSignedOut: (() => void) | null = null;
export function setSignedOutHandler(handler: () => void): void {
  onSignedOut = handler;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: "same-origin",
      headers: body === undefined || body instanceof FormData ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "No connection to the server. Check your internet and try again.");
  }
  if (response.ok) return (await response.json()) as T;

  let message = "Something went wrong. Try again.";
  let code: string | undefined;
  try {
    const data = (await response.json()) as { message?: string; error?: string };
    if (data.message) message = data.message;
    code = data.error;
  } catch {
    // The server sent something that is not JSON (for example while waking up).
    if (response.status >= 502 && response.status <= 504) message = "The server is waking up. Try again in a moment.";
  }
  if (response.status === 401 && code === "login_required") onSignedOut?.();
  throw new ApiError(response.status, message, code);
}

export const api = {
  me: () => request<Me>("GET", "/me"),
  login: (passcode: string) => request<{ ok: true }>("POST", "/login", { passcode }),

  home: () => request<{ items: Item[]; openBatches: OpenBatch[] }>("GET", "/home"),

  createBatch: () => request<{ id: string }>("POST", "/batches"),
  batch: (id: string) => request<Batch>("GET", `/batches/${id}`),
  deleteBatch: (id: string) => request<{ ok: true }>("DELETE", `/batches/${id}`),
  uploadPhoto: (batchId: string, blob: Blob, position: number, source: "photo" | "video") => {
    const form = new FormData();
    form.append("position", String(position));
    form.append("source", source);
    form.append("file", blob, "photo.jpg");
    return request<{ id: string; thumbUrl: string }>("POST", `/batches/${batchId}/photos`, form);
  },
  deletePhoto: (photoId: string) => request<{ ok: true }>("DELETE", `/photos/${photoId}`),
  videoReport: (batchId: string, report: object) => request<{ ok: true }>("POST", `/batches/${batchId}/video-report`, report),
  analyze: (batchId: string) => request<Batch>("POST", `/batches/${batchId}/analyze`),
  asOneItem: (batchId: string) => request<Batch>("POST", `/batches/${batchId}/as-one-item`),
  answerBatchQuestion: (questionId: string, choice: string) =>
    request<Batch>("POST", `/batch-questions/${questionId}/answer`, { choice }),

  item: (id: string) => request<Item>("GET", `/items/${id}`),
  editItem: (id: string, edit: ItemEdit) => request<Item>("PATCH", `/items/${id}`, edit),
  deleteItem: (id: string) => request<{ ok: true }>("DELETE", `/items/${id}`),
  redraft: (id: string) => request<Item>("POST", `/items/${id}/redraft`),
  answer: (id: string, answers: { id: string; answer: string | null }[]) =>
    request<Item>("POST", `/items/${id}/answers`, { answers }),
  merge: (fromId: string, intoId: string) => request<Item>("POST", `/items/${fromId}/merge`, { into: intoId }),
  removeItemPhoto: (photoId: string) => request<{ ok: true }>("DELETE", `/item-photos/${photoId}`),
  useOriginalPhoto: (photoId: string) => request<{ ok: true }>("POST", `/item-photos/${photoId}/original`),
  moveItemPhoto: (photoId: string, to: string) =>
    request<{ ok: true; itemId: string }>("POST", `/item-photos/${photoId}/move`, { to }),
  setPosted: (id: string, platform: Platform, posted: boolean) =>
    request<Item>("PUT", `/items/${id}/posted/${platform}`, { posted }),
};
