import { one, q } from "./db.js";

/** Reading items and batches from the database in the shape the app shows. */

export interface StoredQuestion {
  id: string;
  question: string;
  kind: "choice" | "text";
  options: string[];
  answer: string | null;
  skipped: boolean;
}

export interface ItemPhotoDTO {
  id: string;
  url: string;
  thumbUrl: string;
  width: number;
  height: number;
  cutOut: boolean;
}

export interface ItemDTO {
  id: string;
  batchId: string | null;
  status: string;
  aiState: string;
  aiError: string | null;
  label: string;
  titleNo: string;
  descriptionNo: string;
  titleEn: string;
  descriptionEn: string;
  category: string;
  categoryFinn: string;
  categoryEbay: string;
  condition: string;
  brand: string;
  model: string;
  priceNok: number | null;
  priceLowNok: number | null;
  priceHighNok: number | null;
  priceReason: string;
  questions: StoredQuestion[];
  photosChanged: boolean;
  costUsd: number;
  photos: ItemPhotoDTO[];
  postedOn: string[];
  createdAt: string;
  updatedAt: string;
}

interface ItemRow {
  id: string;
  batch_id: string | null;
  status: string;
  ai_state: string;
  ai_error: string | null;
  label: string;
  title_no: string;
  description_no: string;
  title_en: string;
  description_en: string;
  category: string;
  category_finn: string;
  category_ebay: string;
  condition: string;
  brand: string;
  model: string;
  price_nok: number | null;
  price_low_nok: number | null;
  price_high_nok: number | null;
  price_reason: string;
  questions: StoredQuestion[];
  photos_changed: boolean;
  cost_usd: number;
  created_at: Date;
  updated_at: Date;
}

const ITEM_COLUMNS = `id, batch_id, status, ai_state, ai_error, label, title_no, description_no, title_en,
  description_en, category, category_finn, category_ebay, condition, brand, model, price_nok,
  price_low_nok, price_high_nok, price_reason, questions, photos_changed, cost_usd, created_at, updated_at`;

async function attach(rows: ItemRow[]): Promise<ItemDTO[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const photoRows = await q<{ id: string; item_id: string; width: number; height: number; cut_out: boolean }>(
    `SELECT id, item_id, width, height, (crop IS NOT NULL) AS cut_out
       FROM item_photos WHERE item_id = ANY($1) ORDER BY position, id`,
    [ids],
  );
  const listingRows = await q<{ item_id: string; platform: string }>(
    "SELECT item_id, platform FROM item_listings WHERE item_id = ANY($1) AND status = 'posted' ORDER BY platform",
    [ids],
  );
  return rows.map((r) => ({
    id: r.id,
    batchId: r.batch_id,
    status: r.status,
    aiState: r.ai_state,
    aiError: r.ai_error,
    label: r.label,
    titleNo: r.title_no,
    descriptionNo: r.description_no,
    titleEn: r.title_en,
    descriptionEn: r.description_en,
    category: r.category,
    categoryFinn: r.category_finn,
    categoryEbay: r.category_ebay,
    condition: r.condition,
    brand: r.brand,
    model: r.model,
    priceNok: r.price_nok,
    priceLowNok: r.price_low_nok,
    priceHighNok: r.price_high_nok,
    priceReason: r.price_reason,
    questions: r.questions ?? [],
    photosChanged: r.photos_changed,
    costUsd: r.cost_usd,
    photos: photoRows
      .filter((p) => p.item_id === r.id)
      .map((p) => ({
        id: p.id,
        url: `/api/item-photos/${p.id}`,
        thumbUrl: `/api/item-photos/${p.id}/thumb`,
        width: p.width,
        height: p.height,
        cutOut: p.cut_out,
      })),
    postedOn: listingRows.filter((l) => l.item_id === r.id).map((l) => l.platform),
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  }));
}

export async function loadItem(userId: number, itemId: string): Promise<ItemDTO | undefined> {
  const rows = await q<ItemRow>(`SELECT ${ITEM_COLUMNS} FROM items WHERE id = $1 AND user_id = $2`, [itemId, userId]);
  return (await attach(rows))[0];
}

export async function loadItems(userId: number): Promise<ItemDTO[]> {
  const rows = await q<ItemRow>(
    `SELECT ${ITEM_COLUMNS} FROM items WHERE user_id = $1 ORDER BY created_at DESC, position`,
    [userId],
  );
  return attach(rows);
}

export interface BatchDTO {
  id: string;
  status: string;
  stage: string | null;
  error: string | null;
  costUsd: number;
  createdAt: string;
  photos: { id: string; thumbUrl: string; source: string }[];
  items: ItemDTO[];
  questions: { id: string; photoId: string; thumbUrl: string; question: string; suggestedItemId: string | null }[];
}

interface BatchRow {
  id: string;
  status: string;
  stage: string | null;
  error: string | null;
  cost_usd: number;
  created_at: Date;
}

export async function loadBatch(userId: number, batchId: string): Promise<BatchDTO | undefined> {
  const batch = await one<BatchRow>(
    "SELECT id, status, stage, error, cost_usd, created_at FROM batches WHERE id = $1 AND user_id = $2",
    [batchId, userId],
  );
  if (!batch) return undefined;
  const photos = await q<{ id: string; source: string }>(
    "SELECT id, source FROM photos WHERE batch_id = $1 ORDER BY position, created_at",
    [batchId],
  );
  const itemRows = await q<ItemRow>(
    `SELECT ${ITEM_COLUMNS} FROM items WHERE batch_id = $1 AND user_id = $2 ORDER BY position, created_at`,
    [batchId, userId],
  );
  const questions = await q<{ id: string; photo_id: string; question: string; suggested_item_id: string | null }>(
    "SELECT id, photo_id, question, suggested_item_id FROM batch_questions WHERE batch_id = $1 AND status = 'open' ORDER BY created_at",
    [batchId],
  );
  return {
    id: batch.id,
    status: batch.status,
    stage: batch.stage,
    error: batch.error,
    costUsd: batch.cost_usd,
    createdAt: batch.created_at.toISOString(),
    photos: photos.map((p) => ({ id: p.id, thumbUrl: `/api/photos/${p.id}/thumb`, source: p.source })),
    items: await attach(itemRows),
    questions: questions.map((x) => ({
      id: x.id,
      photoId: x.photo_id,
      thumbUrl: `/api/photos/${x.photo_id}/thumb`,
      question: x.question,
      suggestedItemId: x.suggested_item_id,
    })),
  };
}

/** Uploads that were started but never turned into listings. */
export async function loadOpenBatches(userId: number) {
  const rows = await q<{ id: string; status: string; photo_count: string; created_at: Date; cover: string | null }>(
    `SELECT b.id, b.status, b.created_at,
            (SELECT count(*) FROM photos p WHERE p.batch_id = b.id) AS photo_count,
            (SELECT p.id FROM photos p WHERE p.batch_id = b.id ORDER BY p.position, p.created_at LIMIT 1) AS cover
       FROM batches b
      WHERE b.user_id = $1
        AND (b.status IN ('uploading', 'analyzing') OR (b.status = 'failed' AND NOT EXISTS (SELECT 1 FROM items i WHERE i.batch_id = b.id)))
      ORDER BY b.created_at DESC`,
    [userId],
  );
  return rows
    .filter((r) => Number(r.photo_count) > 0)
    .map((r) => ({
      id: r.id,
      status: r.status,
      photoCount: Number(r.photo_count),
      coverThumbUrl: r.cover ? `/api/photos/${r.cover}/thumb` : null,
      createdAt: r.created_at.toISOString(),
    }));
}
