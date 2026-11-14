import { draftListing, groupPhotos, MAX_PHOTOS_PER_DRAFT, refineListing } from "./ai.js";
import { AiError, type AiResult } from "./claude.js";
import { one, q } from "./db.js";
import { newId } from "./ids.js";
import { cropRegion, forGrouping, makeThumb, scaleBox } from "./images.js";
import type { Refined } from "./prompts.js";
import type { StoredQuestion } from "./store.js";

/**
 * The work that happens after "Create listings":
 *   1. one Claude call sorts the photos into separate items
 *   2. one Claude call per item writes its listing (a few at a time)
 * Results are saved as they arrive, so the app can show each item as soon as
 * it is ready.
 */

const DRAFTS_AT_ONCE = 3;

function friendly(err: unknown): string {
  if (err instanceof AiError) return err.message;
  console.error("[pipeline]", err);
  return "Something went wrong. Tap Try again.";
}

async function recordUsage(
  userId: number,
  step: string,
  result: AiResult<unknown>,
  where: { batchId?: string | null; itemId?: string | null },
): Promise<void> {
  await q(
    `INSERT INTO api_usage (user_id, batch_id, item_id, step, model, input_tokens, output_tokens, cost_usd)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [userId, where.batchId ?? null, where.itemId ?? null, step, result.model, result.inputTokens, result.outputTokens, result.costUsd],
  );
  if (where.batchId) {
    await q("UPDATE batches SET cost_usd = cost_usd + $1 WHERE id = $2", [result.costUsd, where.batchId]);
  }
  if (where.itemId) {
    await q("UPDATE items SET cost_usd = cost_usd + $1 WHERE id = $2", [result.costUsd, where.itemId]);
  }
}

async function runLimited<T>(inputs: T[], limit: number, work: (input: T) => Promise<void>): Promise<void> {
  const queue = [...inputs];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
      await work(next);
    }
  });
  await Promise.all(workers);
}

async function setStage(batchId: string, stage: string | null): Promise<void> {
  await q("UPDATE batches SET stage = $1, updated_at = now() WHERE id = $2", [stage, batchId]);
}

// ---------------------------------------------------------------------------
// Step 1 + 2 for a whole batch
// ---------------------------------------------------------------------------

/** Starts the work and returns immediately; progress is saved to the database. */
export function startBatchAnalysis(userId: number, batchId: string): void {
  analyzeBatch(userId, batchId).catch(async (err) => {
    await q("UPDATE batches SET status = 'failed', stage = NULL, error = $1, updated_at = now() WHERE id = $2", [
      friendly(err),
      batchId,
    ]).catch((e) => console.error("[pipeline] could not save failure", e));
  });
}

interface PhotoRow {
  id: string;
  source: string;
  width: number;
  height: number;
  data: Buffer;
}

async function analyzeBatch(userId: number, batchId: string): Promise<void> {
  await q("UPDATE batches SET status = 'analyzing', error = NULL, stage = $1, updated_at = now() WHERE id = $2", [
    "Looking at your photos",
    batchId,
  ]);

  const photos = await q<PhotoRow>(
    "SELECT id, source, width, height, data FROM photos WHERE batch_id = $1 ORDER BY position, created_at",
    [batchId],
  );
  if (photos.length === 0) throw new AiError("There are no photos to look at.");

  // Smaller copies are enough to tell items apart, and cost less.
  const seen: { jpeg: Buffer; width: number; height: number; source: string }[] = [];
  for (const p of photos) {
    const small = await forGrouping(p.data);
    seen.push({ jpeg: small.data, width: small.width, height: small.height, source: p.source });
  }

  const grouping = await groupPhotos(seen);
  await recordUsage(userId, "group", grouping, { batchId });

  const itemIds: string[] = [];
  const itemIdByIndex = new Map<number, string>();
  const placed = new Set<number>();

  for (const [index, group] of grouping.data.items.entries()) {
    const used = new Set<number>();
    const members = group.photos.filter((m) => {
      const ok = Number.isInteger(m.photo) && m.photo >= 1 && m.photo <= photos.length && !used.has(m.photo);
      used.add(m.photo);
      return ok;
    });
    if (members.length === 0) continue;

    const itemId = newId();
    await q(
      "INSERT INTO items (id, user_id, batch_id, position, label, ai_state) VALUES ($1, $2, $3, $4, $5, 'pending')",
      [itemId, userId, batchId, index, group.name.slice(0, 200)],
    );
    for (const [position, member] of members.entries()) {
      const photo = photos[member.photo - 1];
      const box = member.whole_photo ? null : scaleBox(member.box, seen[member.photo - 1], photo);
      if (box) {
        const cut = await cropRegion(photo.data, box);
        await q(
          `INSERT INTO item_photos (id, item_id, photo_id, position, crop, width, height, data, thumb)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [newId(), itemId, photo.id, position, JSON.stringify(box), cut.width, cut.height, cut.data, await makeThumb(cut.data)],
        );
      } else {
        await q(
          "INSERT INTO item_photos (id, item_id, photo_id, position, width, height) VALUES ($1, $2, $3, $4, $5, $6)",
          [newId(), itemId, photo.id, position, photo.width, photo.height],
        );
      }
      placed.add(member.photo);
    }
    itemIds.push(itemId);
    itemIdByIndex.set(index + 1, itemId);
  }

  // Photos Claude was unsure about become questions for the seller.
  const asked = new Set<number>();
  for (const unsure of grouping.data.unsure_photos) {
    if (!Number.isInteger(unsure.photo) || unsure.photo < 1 || unsure.photo > photos.length) continue;
    if (placed.has(unsure.photo) || asked.has(unsure.photo)) continue;
    asked.add(unsure.photo);
    await q(
      "INSERT INTO batch_questions (id, batch_id, photo_id, question, suggested_item_id) VALUES ($1, $2, $3, $4, $5)",
      [
        newId(),
        batchId,
        photos[unsure.photo - 1].id,
        unsure.question.slice(0, 300),
        unsure.likely_item ? (itemIdByIndex.get(unsure.likely_item) ?? null) : null,
      ],
    );
  }
  // A photo Claude did not mention at all is also worth asking about.
  const skipped = new Set(grouping.data.skipped_photos.map((s) => s.photo));
  for (let n = 1; n <= photos.length; n++) {
    if (placed.has(n) || asked.has(n) || skipped.has(n)) continue;
    await q("INSERT INTO batch_questions (id, batch_id, photo_id, question) VALUES ($1, $2, $3, $4)", [
      newId(),
      batchId,
      photos[n - 1].id,
      "Where does this photo belong?",
    ]);
  }

  if (itemIds.length === 0) {
    await q(
      "UPDATE batches SET status = 'failed', stage = NULL, error = $1, updated_at = now() WHERE id = $2",
      ["I could not find anything to sell in these photos.", batchId],
    );
    return;
  }

  // Share the cost of the sorting step evenly between the items it found.
  await q("UPDATE items SET cost_usd = cost_usd + $1 WHERE id = ANY($2)", [grouping.costUsd / itemIds.length, itemIds]);

  await setStage(batchId, "Writing listings");
  await runLimited(itemIds, DRAFTS_AT_ONCE, (itemId) => draftItem(userId, itemId));
  await q("UPDATE batches SET status = 'done', stage = NULL, updated_at = now() WHERE id = $1", [batchId]);
}

// ---------------------------------------------------------------------------
// Step 2 for one item
// ---------------------------------------------------------------------------

function toQuestions(raw: { question: string; kind: "choice" | "text"; options: string[] }[]): StoredQuestion[] {
  return raw.slice(0, 3).map((x) => ({
    id: newId(),
    question: x.question,
    kind: x.kind === "choice" && x.options.length >= 2 ? "choice" : "text",
    options: x.kind === "choice" ? x.options.slice(0, 5) : [],
    answer: null,
    skipped: false,
  }));
}

async function saveListing(itemId: string, d: Refined): Promise<void> {
  await q(
    `UPDATE items SET title_no = $2, description_no = $3, title_en = $4, description_en = $5,
            category = $6, category_finn = $7, category_ebay = $8, condition = $9, brand = $10, model = $11,
            price_nok = $12, price_low_nok = $13, price_high_nok = $14, price_reason = $15, updated_at = now()
      WHERE id = $1`,
    [
      itemId,
      d.title_no.trim(),
      d.description_no.trim(),
      d.title_en.trim(),
      d.description_en.trim(),
      d.category.trim(),
      d.finn_category.trim(),
      d.ebay_category.trim(),
      d.condition,
      d.brand.trim(),
      d.model.trim(),
      Math.max(0, Math.round(d.price_nok)),
      Math.max(0, Math.round(Math.min(d.price_low_nok, d.price_high_nok))),
      Math.max(0, Math.round(Math.max(d.price_low_nok, d.price_high_nok))),
      d.price_reason.trim(),
    ],
  );
}

/** Write (or rewrite) one item's listing from its photos. Never throws. */
export async function draftItem(userId: number, itemId: string): Promise<void> {
  try {
    const item = await one<{ label: string; batch_id: string | null }>(
      "UPDATE items SET ai_state = 'working', ai_error = NULL, photos_changed = false WHERE id = $1 AND user_id = $2 RETURNING label, batch_id",
      [itemId, userId],
    );
    if (!item) return;
    const photos = await q<{ data: Buffer; cut_out: boolean }>(
      `SELECT COALESCE(ip.data, p.data) AS data, (ip.crop IS NOT NULL) AS cut_out
         FROM item_photos ip JOIN photos p ON p.id = ip.photo_id
        WHERE ip.item_id = $1 ORDER BY ip.position, ip.id LIMIT $2`,
      [itemId, MAX_PHOTOS_PER_DRAFT],
    );
    if (photos.length === 0) throw new AiError("This item has no photos to write from.");

    const result = await draftListing({
      label: item.label,
      photos: photos.map((p) => p.data),
      hasCutOuts: photos.some((p) => p.cut_out),
    });
    await recordUsage(userId, "draft", result, { batchId: item.batch_id, itemId });
    await saveListing(itemId, result.data);
    await q("UPDATE items SET questions = $2, ai_state = 'ready', updated_at = now() WHERE id = $1", [
      itemId,
      JSON.stringify(toQuestions(result.data.questions)),
    ]);
  } catch (err) {
    await q("UPDATE items SET ai_state = 'failed', ai_error = $2, updated_at = now() WHERE id = $1", [
      itemId,
      friendly(err),
    ]).catch((e) => console.error("[pipeline] could not save failure", e));
  }
}

export function startDraft(userId: number, itemId: string): void {
  void draftItem(userId, itemId);
}

// ---------------------------------------------------------------------------
// Step 3: fold the seller's answers into the listing
// ---------------------------------------------------------------------------

interface RefineRow {
  batch_id: string | null;
  title_no: string;
  description_no: string;
  title_en: string;
  description_en: string;
  category: string;
  category_finn: string;
  category_ebay: string;
  condition: Refined["condition"];
  brand: string;
  model: string;
  price_nok: number | null;
  price_low_nok: number | null;
  price_high_nok: number | null;
  price_reason: string;
  questions: StoredQuestion[];
}

/** Never throws. If it fails, the listing stays as it was and the error is shown. */
export async function refineItem(userId: number, itemId: string): Promise<void> {
  try {
    const item = await one<RefineRow>(
      `UPDATE items SET ai_state = 'working', ai_error = NULL WHERE id = $1 AND user_id = $2
       RETURNING batch_id, title_no, description_no, title_en, description_en, category, category_finn,
                 category_ebay, condition, brand, model, price_nok, price_low_nok, price_high_nok,
                 price_reason, questions`,
      [itemId, userId],
    );
    if (!item) return;
    const answers = (item.questions ?? [])
      .filter((x) => x.answer && !x.skipped)
      .map((x) => ({ question: x.question, answer: x.answer as string }));
    if (answers.length === 0) {
      await q("UPDATE items SET ai_state = 'ready' WHERE id = $1", [itemId]);
      return;
    }
    const result = await refineListing({
      current: {
        title_no: item.title_no,
        description_no: item.description_no,
        title_en: item.title_en,
        description_en: item.description_en,
        category: item.category,
        finn_category: item.category_finn,
        ebay_category: item.category_ebay,
        condition: item.condition,
        brand: item.brand,
        model: item.model,
        price_nok: item.price_nok ?? 0,
        price_low_nok: item.price_low_nok ?? 0,
        price_high_nok: item.price_high_nok ?? 0,
        price_reason: item.price_reason,
      },
      answers,
    });
    await recordUsage(userId, "refine", result, { batchId: item.batch_id, itemId });
    await saveListing(itemId, result.data);
    await q("UPDATE items SET ai_state = 'ready', updated_at = now() WHERE id = $1", [itemId]);
  } catch (err) {
    // Keep the listing usable: go back to "ready" and show what went wrong.
    await q("UPDATE items SET ai_state = 'ready', ai_error = $2, updated_at = now() WHERE id = $1", [
      itemId,
      `Could not update the text with your answers. ${friendly(err)}`,
    ]).catch((e) => console.error("[pipeline] could not save failure", e));
  }
}

export function startRefine(userId: number, itemId: string): void {
  void refineItem(userId, itemId);
}
