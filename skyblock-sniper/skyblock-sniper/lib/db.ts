import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

// Always point inside the deployed bundle
export const dbPath = path.join(process.cwd(), "data", "skyblock.db");

// Detect serverless prod (Vercel)
const IS_PROD = process.env.NODE_ENV === "production";
const IS_VERCEL = !!process.env.VERCEL; // present on Vercel runtime
const READONLY = IS_PROD && IS_VERCEL;

// Open read-only on Vercel so SQLite never tries to write -wal/-shm
export const db = new Database(dbPath, {
  readonly: READONLY,
  fileMustExist: true,
});

// In production on Vercel, do NOT run PRAGMAs or CREATEs that write.
// Locally (dev) or during your import step, it's fine to ensure schema.
if (!READONLY) {
  try {
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;

      CREATE TABLE IF NOT EXISTS items (
        id INTEGER PRIMARY KEY,
        uuid TEXT UNIQUE,
        name TEXT NOT NULL,
        color TEXT,
        rarity TEXT,
        price INTEGER,
        extra JSON
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
        name, color, content='items', content_rowid='id'
      );

      CREATE TRIGGER IF NOT EXISTS items_ai AFTER INSERT ON items BEGIN
        INSERT INTO items_fts(rowid, name, color) VALUES (new.id, new.name, new.color);
      END;
      CREATE TRIGGER IF NOT EXISTS items_ad AFTER DELETE ON items BEGIN
        INSERT INTO items_fts(items_fts, rowid, name, color) VALUES ('delete', old.id, old.name, old.color);
      END;
      CREATE TRIGGER IF NOT EXISTS items_au AFTER UPDATE ON items BEGIN
        INSERT INTO items_fts(items_fts, rowid, name, color) VALUES ('delete', old.id, old.name, old.color);
        INSERT INTO items_fts(rowid, name, color) VALUES (new.id, new.name, new.color);
      END;

      CREATE INDEX IF NOT EXISTS idx_items_uuid ON items(uuid);
      CREATE INDEX IF NOT EXISTS idx_items_color ON items(color);
      CREATE INDEX IF NOT EXISTS idx_items_name ON items(name);

      CREATE TABLE IF NOT EXISTS username_cache(
        uuid TEXT PRIMARY KEY,
        username TEXT,
        fetched_at INTEGER
      );
    `);
  } catch (e) {
    // If anything goes wrong locally, surface it:
    console.error("DB init error:", e);
    throw e;
  }
} else {
  // In prod, set safe read-only PRAGMAs that don't require writes
  try {
    db.exec(`
      PRAGMA query_only = ON;
      PRAGMA journal_mode = OFF;
      PRAGMA synchronous = NORMAL;
    `);
  } catch {
    // ignore – read-only pragmas are best-effort
  }
}

export function fileExists(p = dbPath) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}
