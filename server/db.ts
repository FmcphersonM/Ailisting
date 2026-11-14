import pg from "pg";
import { config } from "./config.js";
import { DEFAULT_USER_ID } from "./users.js";

const { Pool } = pg;

function sslFor(connectionString: string): pg.PoolConfig["ssl"] {
  // Render's internal database address needs no TLS. Connecting from outside
  // Render (its "external" address) does.
  try {
    const host = new URL(connectionString).hostname;
    const local = host === "localhost" || host === "127.0.0.1" || !host.includes(".");
    return local ? undefined : { rejectUnauthorized: false };
  } catch {
    return undefined;
  }
}

export const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: sslFor(config.databaseUrl),
  max: 5,
});

export async function q<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await pool.query<T>(text, params);
  return result.rows;
}

export async function one<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | undefined> {
  const rows = await q<T>(text, params);
  return rows[0];
}

/**
 * Database structure. Each entry runs once, in order. To change the structure
 * later, add a new entry at the end; never edit one that has already run.
 *
 * Every table carries a user_id so the app can support several users later.
 */
const migrations: { id: string; sql: string }[] = [
  {
    id: "001_initial",
    sql: `
      CREATE TABLE users (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      -- One upload session: the photos added in one go.
      CREATE TABLE batches (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        status TEXT NOT NULL DEFAULT 'uploading',   -- uploading | analyzing | done | failed
        stage TEXT,                                  -- progress text shown to the user
        error TEXT,
        cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      -- Photos exactly as uploaded (already shrunk on the phone).
      CREATE TABLE photos (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        batch_id TEXT NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
        position INTEGER NOT NULL DEFAULT 0,
        source TEXT NOT NULL DEFAULT 'photo',        -- photo | video
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        data BYTEA NOT NULL,
        thumb BYTEA NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX photos_batch ON photos(batch_id, position);

      -- One thing for sale.
      CREATE TABLE items (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        batch_id TEXT REFERENCES batches(id) ON DELETE SET NULL,
        position INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'draft',        -- draft | approved | listed | sold
        ai_state TEXT NOT NULL DEFAULT 'pending',    -- pending | working | ready | failed
        ai_error TEXT,
        label TEXT NOT NULL DEFAULT '',
        title_no TEXT NOT NULL DEFAULT '',
        description_no TEXT NOT NULL DEFAULT '',
        title_en TEXT NOT NULL DEFAULT '',
        description_en TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT '',
        category_finn TEXT NOT NULL DEFAULT '',
        category_ebay TEXT NOT NULL DEFAULT '',
        condition TEXT NOT NULL DEFAULT 'good',      -- new | like_new | good | fair | needs_repair
        brand TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT '',
        price_nok INTEGER,
        price_low_nok INTEGER,
        price_high_nok INTEGER,
        price_reason TEXT NOT NULL DEFAULT '',
        questions JSONB NOT NULL DEFAULT '[]',
        photos_changed BOOLEAN NOT NULL DEFAULT false, -- photos added since the listing was written
        cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX items_user ON items(user_id, created_at DESC);
      CREATE INDEX items_batch ON items(batch_id, position);

      -- Which photos show which item. One photo of a pile can belong to
      -- several items; "crop" then marks the part that shows this item, and
      -- data/thumb hold that cut-out.
      CREATE TABLE item_photos (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        photo_id TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
        position INTEGER NOT NULL DEFAULT 0,
        crop JSONB,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        data BYTEA,
        thumb BYTEA
      );
      CREATE INDEX item_photos_item ON item_photos(item_id, position);

      -- Photos the AI could not place with confidence. The user decides.
      CREATE TABLE batch_questions (
        id TEXT PRIMARY KEY,
        batch_id TEXT NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
        photo_id TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
        question TEXT NOT NULL,
        suggested_item_id TEXT REFERENCES items(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'open',         -- open | answered
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      -- Where an item has been posted (used by the overview in Phase 2).
      CREATE TABLE item_listings (
        id SERIAL PRIMARY KEY,
        item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        platform TEXT NOT NULL,                      -- finn | tise | facebook | ebay
        status TEXT NOT NULL DEFAULT 'posted',       -- posted | removed
        url TEXT,
        external_id TEXT,
        posted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (item_id, platform)
      );

      -- Every Claude call, so API fees can be shown per listing.
      CREATE TABLE api_usage (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        batch_id TEXT,
        item_id TEXT,
        step TEXT NOT NULL,                          -- group | draft | refine
        model TEXT NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `,
  },
];

export async function migrate(): Promise<void> {
  const client = await pool.connect();
  try {
    // Only one server instance may change the structure at a time.
    await client.query("SELECT pg_advisory_lock(727272)");
    await client.query(
      "CREATE TABLE IF NOT EXISTS migrations (id TEXT PRIMARY KEY, ran_at TIMESTAMPTZ NOT NULL DEFAULT now())",
    );
    const done = new Set((await client.query<{ id: string }>("SELECT id FROM migrations")).rows.map((r) => r.id));
    for (const m of migrations) {
      if (done.has(m.id)) continue;
      await client.query("BEGIN");
      try {
        await client.query(m.sql);
        await client.query("INSERT INTO migrations (id) VALUES ($1)", [m.id]);
        await client.query("COMMIT");
        console.log(`[db] applied ${m.id}`);
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    }
    await client.query(
      "INSERT INTO users (id, name) VALUES ($1, 'Me') ON CONFLICT (id) DO NOTHING",
      [DEFAULT_USER_ID],
    );
    await client.query("SELECT pg_advisory_unlock(727272)");
  } finally {
    client.release();
  }
}

/**
 * If the server restarted in the middle of writing listings, nothing is still
 * working on them. Mark them as stopped so the app can offer "Try again".
 */
export async function recoverInterruptedWork(): Promise<void> {
  const message = "This was interrupted. Tap Try again.";
  await q(
    "UPDATE items SET ai_state = 'failed', ai_error = $1 WHERE ai_state IN ('pending', 'working')",
    [message],
  );
  await q(
    "UPDATE batches SET status = 'failed', error = $1, stage = NULL WHERE status = 'analyzing' AND NOT EXISTS (SELECT 1 FROM items WHERE items.batch_id = batches.id)",
    [message],
  );
  await q("UPDATE batches SET status = 'done', stage = NULL WHERE status = 'analyzing'");
}
