import express, { type Request, type Response } from "express";
import multer from "multer";
import { accessMode, isSignedIn, login, logout, requireAuth } from "./auth.js";
import { config } from "./config.js";
import { one, pool, q } from "./db.js";
import { newId } from "./ids.js";
import { makeThumb, normalizeUpload } from "./images.js";
import { startBatchAnalysis, startDraft, startRefine } from "./pipeline.js";
import { CONDITIONS } from "./prompts.js";
import { loadBatch, loadItem, loadItems, loadOpenBatches, type StoredQuestion } from "./store.js";
import { currentUserId } from "./users.js";

export const api = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 1 },
});

const PLATFORMS = ["finn", "tise", "facebook", "ebay"];

function fail(res: Response, status: number, message: string): void {
  res.status(status).json({ error: "request_failed", message });
}

function param(req: Request, name: string): string {
  const value = req.params[name];
  return typeof value === "string" ? value : "";
}

// ---------------------------------------------------------------------------
// Open to everyone: is the app set up, am I signed in
// ---------------------------------------------------------------------------

api.get("/me", (req, res) => {
  res.json({
    signedIn: isSignedIn(req),
    access: accessMode(),
    aiReady: config.fakeAi || config.hasAnthropicKey,
    demoMode: config.fakeAi,
    model: config.model,
    usdToNok: config.usdToNok,
    maxPhotosPerBatch: config.maxPhotosPerBatch,
  });
});
api.post("/login", login);
api.post("/logout", logout);

// Everything below needs the passcode.
api.use(requireAuth);

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------

api.get("/home", async (req, res) => {
  const userId = currentUserId(req);
  res.json({ items: await loadItems(userId), openBatches: await loadOpenBatches(userId) });
});

// ---------------------------------------------------------------------------
// Batches: one round of photos
// ---------------------------------------------------------------------------

api.post("/batches", async (req, res) => {
  const id = newId();
  await q("INSERT INTO batches (id, user_id) VALUES ($1, $2)", [id, currentUserId(req)]);
  res.json({ id });
});

api.get("/batches/:id", async (req, res) => {
  const batch = await loadBatch(currentUserId(req), param(req, "id"));
  if (!batch) return fail(res, 404, "That set of photos no longer exists.");
  res.json(batch);
});

api.delete("/batches/:id", async (req, res) => {
  const userId = currentUserId(req);
  const id = param(req, "id");
  const hasItems = await one("SELECT 1 FROM items WHERE batch_id = $1 LIMIT 1", [id]);
  if (hasItems) return fail(res, 409, "These photos already have listings. Delete the items instead.");
  await q("DELETE FROM batches WHERE id = $1 AND user_id = $2 AND status <> 'analyzing'", [id, userId]);
  res.json({ ok: true });
});

api.post("/batches/:id/photos", upload.single("file"), async (req, res) => {
  const userId = currentUserId(req);
  const batchId = param(req, "id");
  const batch = await one<{ status: string }>("SELECT status FROM batches WHERE id = $1 AND user_id = $2", [batchId, userId]);
  if (!batch) return fail(res, 404, "That set of photos no longer exists.");
  if (batch.status !== "uploading") return fail(res, 409, "These photos are already being processed.");
  if (!req.file) return fail(res, 400, "No photo was received.");

  const count = await one<{ n: string }>("SELECT count(*) AS n FROM photos WHERE batch_id = $1", [batchId]);
  if (Number(count?.n ?? 0) >= config.maxPhotosPerBatch) {
    return fail(res, 409, `That is the limit of ${config.maxPhotosPerBatch} photos in one go.`);
  }

  let picture;
  try {
    picture = await normalizeUpload(req.file.buffer);
  } catch {
    return fail(res, 415, "That file is not a picture I can read.");
  }
  const thumb = await makeThumb(picture.data);
  const id = newId();
  const position = Number.isFinite(Number(req.body?.position)) ? Math.round(Number(req.body.position)) : 0;
  const source = req.body?.source === "video" ? "video" : "photo";
  await q(
    `INSERT INTO photos (id, user_id, batch_id, position, source, width, height, data, thumb)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, userId, batchId, position, source, picture.width, picture.height, picture.data, thumb],
  );
  res.json({ id, thumbUrl: `/api/photos/${id}/thumb`, bytes: picture.data.length });
});

api.delete("/photos/:id", async (req, res) => {
  // Only while still choosing photos, before listings are made.
  await q(
    `DELETE FROM photos p USING batches b
      WHERE p.id = $1 AND p.user_id = $2 AND b.id = p.batch_id AND b.status = 'uploading'`,
    [param(req, "id"), currentUserId(req)],
  );
  res.json({ ok: true });
});

api.post("/batches/:id/analyze", async (req, res) => {
  const userId = currentUserId(req);
  const batchId = param(req, "id");
  // Claim the batch in one step so a double tap cannot start the work twice.
  const claimed = await one(
    `UPDATE batches SET status = 'analyzing', error = NULL, stage = 'Looking at your photos', updated_at = now()
      WHERE id = $1 AND user_id = $2 AND status IN ('uploading', 'failed')
        AND NOT EXISTS (SELECT 1 FROM items WHERE batch_id = $1)
        AND EXISTS (SELECT 1 FROM photos WHERE batch_id = $1)
      RETURNING id`,
    [batchId, userId],
  );
  if (claimed) startBatchAnalysis(userId, batchId);
  const batch = await loadBatch(userId, batchId);
  if (!batch) return fail(res, 404, "That set of photos no longer exists.");
  res.json(batch);
});

/** Fallback when sorting found nothing: treat every photo as the same item. */
api.post("/batches/:id/as-one-item", async (req, res) => {
  const userId = currentUserId(req);
  const batchId = param(req, "id");
  const batch = await one<{ status: string }>("SELECT status FROM batches WHERE id = $1 AND user_id = $2", [batchId, userId]);
  if (!batch) return fail(res, 404, "That set of photos no longer exists.");
  if (batch.status === "analyzing") return fail(res, 409, "Still working on these photos.");
  const photos = await q<{ id: string; width: number; height: number }>(
    "SELECT id, width, height FROM photos WHERE batch_id = $1 ORDER BY position, created_at",
    [batchId],
  );
  if (photos.length === 0) return fail(res, 409, "There are no photos here.");
  const itemId = newId();
  await q("INSERT INTO items (id, user_id, batch_id, label) VALUES ($1, $2, $3, 'Item')", [itemId, userId, batchId]);
  for (const [position, p] of photos.entries()) {
    await q("INSERT INTO item_photos (id, item_id, photo_id, position, width, height) VALUES ($1, $2, $3, $4, $5, $6)", [
      newId(),
      itemId,
      p.id,
      position,
      p.width,
      p.height,
    ]);
  }
  await q("UPDATE batches SET status = 'done', error = NULL, stage = NULL WHERE id = $1", [batchId]);
  await q("UPDATE batch_questions SET status = 'answered' WHERE batch_id = $1", [batchId]);
  startDraft(userId, itemId);
  res.json(await loadBatch(userId, batchId));
});

/** The seller says where an unclear photo belongs. */
api.post("/batch-questions/:id/answer", async (req, res) => {
  const userId = currentUserId(req);
  const question = await one<{ id: string; batch_id: string; photo_id: string; width: number; height: number }>(
    `SELECT bq.id, bq.batch_id, bq.photo_id, p.width, p.height
       FROM batch_questions bq
       JOIN batches b ON b.id = bq.batch_id
       JOIN photos p ON p.id = bq.photo_id
      WHERE bq.id = $1 AND b.user_id = $2 AND bq.status = 'open'`,
    [param(req, "id"), userId],
  );
  if (!question) return fail(res, 404, "That question is already answered.");
  const choice = typeof req.body?.choice === "string" ? req.body.choice : "";

  if (choice === "new") {
    const itemId = newId();
    const next = await one<{ n: number }>("SELECT COALESCE(max(position), -1) + 1 AS n FROM items WHERE batch_id = $1", [
      question.batch_id,
    ]);
    await q("INSERT INTO items (id, user_id, batch_id, position, label) VALUES ($1, $2, $3, $4, 'Item')", [
      itemId,
      userId,
      question.batch_id,
      next?.n ?? 0,
    ]);
    await q("INSERT INTO item_photos (id, item_id, photo_id, position, width, height) VALUES ($1, $2, $3, 0, $4, $5)", [
      newId(),
      itemId,
      question.photo_id,
      question.width,
      question.height,
    ]);
    startDraft(userId, itemId);
  } else if (choice !== "ignore") {
    const item = await one("SELECT 1 FROM items WHERE id = $1 AND user_id = $2 AND batch_id = $3", [
      choice,
      userId,
      question.batch_id,
    ]);
    if (!item) return fail(res, 404, "That item no longer exists.");
    await q(
      `INSERT INTO item_photos (id, item_id, photo_id, position, width, height)
       VALUES ($1, $2, $3, (SELECT COALESCE(max(position), -1) + 1 FROM item_photos WHERE item_id = $2), $4, $5)`,
      [newId(), choice, question.photo_id, question.width, question.height],
    );
    await q("UPDATE items SET photos_changed = true, updated_at = now() WHERE id = $1", [choice]);
  }
  await q("UPDATE batch_questions SET status = 'answered' WHERE id = $1", [question.id]);
  res.json(await loadBatch(userId, question.batch_id));
});

// ---------------------------------------------------------------------------
// Pictures
// ---------------------------------------------------------------------------

function sendJpeg(res: Response, data: Buffer | undefined | null): void {
  if (!data) {
    res.status(404).end();
    return;
  }
  res.set("Content-Type", "image/jpeg");
  res.set("Cache-Control", "private, max-age=31536000, immutable");
  res.send(data);
}

api.get("/photos/:id", async (req, res) => {
  const row = await one<{ data: Buffer }>("SELECT data FROM photos WHERE id = $1 AND user_id = $2", [
    param(req, "id"),
    currentUserId(req),
  ]);
  sendJpeg(res, row?.data);
});

api.get("/photos/:id/thumb", async (req, res) => {
  const row = await one<{ data: Buffer }>("SELECT thumb AS data FROM photos WHERE id = $1 AND user_id = $2", [
    param(req, "id"),
    currentUserId(req),
  ]);
  sendJpeg(res, row?.data);
});

api.get("/item-photos/:id", async (req, res) => {
  const row = await one<{ data: Buffer }>(
    `SELECT COALESCE(ip.data, p.data) AS data FROM item_photos ip JOIN photos p ON p.id = ip.photo_id
      WHERE ip.id = $1 AND p.user_id = $2`,
    [param(req, "id"), currentUserId(req)],
  );
  sendJpeg(res, row?.data);
});

api.get("/item-photos/:id/thumb", async (req, res) => {
  const row = await one<{ data: Buffer }>(
    `SELECT COALESCE(ip.thumb, p.thumb) AS data FROM item_photos ip JOIN photos p ON p.id = ip.photo_id
      WHERE ip.id = $1 AND p.user_id = $2`,
    [param(req, "id"), currentUserId(req)],
  );
  sendJpeg(res, row?.data);
});

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

api.get("/items/:id", async (req, res) => {
  const item = await loadItem(currentUserId(req), param(req, "id"));
  if (!item) return fail(res, 404, "That item no longer exists.");
  res.json(item);
});

const TEXT_FIELDS: Record<string, { column: string; max: number }> = {
  titleNo: { column: "title_no", max: 200 },
  descriptionNo: { column: "description_no", max: 6000 },
  titleEn: { column: "title_en", max: 200 },
  descriptionEn: { column: "description_en", max: 6000 },
  category: { column: "category", max: 200 },
  categoryFinn: { column: "category_finn", max: 300 },
  categoryEbay: { column: "category_ebay", max: 300 },
  brand: { column: "brand", max: 120 },
  model: { column: "model", max: 120 },
};

api.patch("/items/:id", async (req, res) => {
  const userId = currentUserId(req);
  const id = param(req, "id");
  const body = (req.body ?? {}) as Record<string, unknown>;
  const sets: string[] = [];
  const values: unknown[] = [];
  const set = (column: string, value: unknown) => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };

  for (const [field, rule] of Object.entries(TEXT_FIELDS)) {
    const value = body[field];
    if (typeof value === "string") set(rule.column, value.slice(0, rule.max));
  }
  if (typeof body.condition === "string") {
    if (!(CONDITIONS as readonly string[]).includes(body.condition)) return fail(res, 400, "Unknown condition.");
    set("condition", body.condition);
  }
  if (body.priceNok === null) set("price_nok", null);
  else if (typeof body.priceNok === "number" && Number.isFinite(body.priceNok)) {
    set("price_nok", Math.min(100_000_000, Math.max(0, Math.round(body.priceNok))));
  }
  if (typeof body.status === "string") {
    if (!["draft", "approved"].includes(body.status)) return fail(res, 400, "Unknown status.");
    set("status", body.status);
  }
  if (sets.length > 0) {
    values.push(id, userId);
    await q(
      `UPDATE items SET ${sets.join(", ")}, updated_at = now() WHERE id = $${values.length - 1} AND user_id = $${values.length}`,
      values,
    );
  }
  const item = await loadItem(userId, id);
  if (!item) return fail(res, 404, "That item no longer exists.");
  res.json(item);
});

api.delete("/items/:id", async (req, res) => {
  const userId = currentUserId(req);
  const id = param(req, "id");
  const item = await one<{ batch_id: string | null }>("DELETE FROM items WHERE id = $1 AND user_id = $2 RETURNING batch_id", [
    id,
    userId,
  ]);
  if (item?.batch_id) {
    // Free the space used by photos that no longer belong to anything.
    await q(
      `DELETE FROM photos p USING batches b
        WHERE p.batch_id = $1 AND b.id = p.batch_id AND b.status IN ('done', 'failed')
          AND NOT EXISTS (SELECT 1 FROM item_photos ip WHERE ip.photo_id = p.id)
          AND NOT EXISTS (SELECT 1 FROM batch_questions bq WHERE bq.photo_id = p.id AND bq.status = 'open')`,
      [item.batch_id],
    );
  }
  res.json({ ok: true });
});

/** Write the listing again from the photos. Replaces the current text. */
api.post("/items/:id/redraft", async (req, res) => {
  const userId = currentUserId(req);
  const id = param(req, "id");
  const claimed = await one(
    "UPDATE items SET ai_state = 'pending', ai_error = NULL WHERE id = $1 AND user_id = $2 AND ai_state IN ('ready', 'failed') RETURNING id",
    [id, userId],
  );
  if (claimed) startDraft(userId, id);
  const item = await loadItem(userId, id);
  if (!item) return fail(res, 404, "That item no longer exists.");
  res.json(item);
});

/** Save answers to the AI's questions, then update the text to include them. */
api.post("/items/:id/answers", async (req, res) => {
  const userId = currentUserId(req);
  const id = param(req, "id");
  const row = await one<{ questions: StoredQuestion[]; ai_state: string }>(
    "SELECT questions, ai_state FROM items WHERE id = $1 AND user_id = $2",
    [id, userId],
  );
  if (!row) return fail(res, 404, "That item no longer exists.");
  if (row.ai_state !== "ready") return fail(res, 409, "Still working on this item. Try again in a moment.");

  const given = Array.isArray(req.body?.answers) ? (req.body.answers as { id?: unknown; answer?: unknown }[]) : [];
  let anyNewAnswer = false;
  const questions = (row.questions ?? []).map((question) => {
    const match = given.find((g) => g.id === question.id);
    if (!match) return question;
    if (typeof match.answer === "string" && match.answer.trim()) {
      anyNewAnswer = true;
      return { ...question, answer: match.answer.trim().slice(0, 500), skipped: false };
    }
    return { ...question, answer: null, skipped: true };
  });
  await q("UPDATE items SET questions = $2, ai_error = NULL, updated_at = now() WHERE id = $1", [id, JSON.stringify(questions)]);
  if (anyNewAnswer) {
    await q("UPDATE items SET ai_state = 'working' WHERE id = $1", [id]);
    startRefine(userId, id);
  }
  res.json(await loadItem(userId, id));
});

/** Two cards turned out to be the same thing: move all photos into one. */
api.post("/items/:id/merge", async (req, res) => {
  const userId = currentUserId(req);
  const fromId = param(req, "id");
  const intoId = typeof req.body?.into === "string" ? req.body.into : "";
  const both = await q<{ id: string }>("SELECT id FROM items WHERE id = ANY($1) AND user_id = $2", [[fromId, intoId], userId]);
  if (both.length !== 2) return fail(res, 404, "One of those items no longer exists.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE item_photos SET item_id = $2,
              position = position + (SELECT COALESCE(max(position), -1) + 1 FROM item_photos WHERE item_id = $2)
        WHERE item_id = $1`,
      [fromId, intoId],
    );
    await client.query("DELETE FROM items WHERE id = $1", [fromId]);
    await client.query("UPDATE items SET photos_changed = true, updated_at = now() WHERE id = $1", [intoId]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  res.json(await loadItem(userId, intoId));
});

api.delete("/item-photos/:id", async (req, res) => {
  await q(
    `DELETE FROM item_photos ip USING items i
      WHERE ip.id = $1 AND i.id = ip.item_id AND i.user_id = $2`,
    [param(req, "id"), currentUserId(req)],
  );
  res.json({ ok: true });
});

/** Move a photo to another item, or make it an item of its own ("new"). */
api.post("/item-photos/:id/move", async (req, res) => {
  const userId = currentUserId(req);
  const photo = await one<{ id: string; item_id: string; batch_id: string | null }>(
    `SELECT ip.id, ip.item_id, i.batch_id FROM item_photos ip JOIN items i ON i.id = ip.item_id
      WHERE ip.id = $1 AND i.user_id = $2`,
    [param(req, "id"), userId],
  );
  if (!photo) return fail(res, 404, "That photo no longer exists.");
  const to = typeof req.body?.to === "string" ? req.body.to : "";

  let targetId = to;
  if (to === "new") {
    targetId = newId();
    const next = await one<{ n: number }>("SELECT COALESCE(max(position), -1) + 1 AS n FROM items WHERE batch_id = $1", [
      photo.batch_id,
    ]);
    await q("INSERT INTO items (id, user_id, batch_id, position, label) VALUES ($1, $2, $3, $4, 'Item')", [
      targetId,
      userId,
      photo.batch_id,
      next?.n ?? 0,
    ]);
  } else {
    const target = await one("SELECT 1 FROM items WHERE id = $1 AND user_id = $2", [to, userId]);
    if (!target) return fail(res, 404, "That item no longer exists.");
    if (to === photo.item_id) return res.json({ ok: true, itemId: to });
  }
  await q(
    `UPDATE item_photos SET item_id = $2,
            position = (SELECT COALESCE(max(position), -1) + 1 FROM item_photos WHERE item_id = $2)
      WHERE id = $1`,
    [photo.id, targetId],
  );
  if (to === "new") startDraft(userId, targetId);
  else await q("UPDATE items SET photos_changed = true, updated_at = now() WHERE id = $1", [targetId]);
  res.json({ ok: true, itemId: targetId });
});

/** Remember where an item has been posted. */
api.put("/items/:id/posted/:platform", async (req, res) => {
  const userId = currentUserId(req);
  const id = param(req, "id");
  const platform = param(req, "platform");
  if (!PLATFORMS.includes(platform)) return fail(res, 400, "Unknown marketplace.");
  const item = await one("SELECT 1 FROM items WHERE id = $1 AND user_id = $2", [id, userId]);
  if (!item) return fail(res, 404, "That item no longer exists.");
  if (req.body?.posted === false) {
    await q("DELETE FROM item_listings WHERE item_id = $1 AND platform = $2", [id, platform]);
  } else {
    await q(
      `INSERT INTO item_listings (item_id, platform) VALUES ($1, $2)
       ON CONFLICT (item_id, platform) DO UPDATE SET status = 'posted', posted_at = now()`,
      [id, platform],
    );
  }
  res.json(await loadItem(userId, id));
});
