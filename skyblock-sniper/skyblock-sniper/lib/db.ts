import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { deltaE2000 } from "./colorDistance";

export const dbPath = path.join(process.cwd(), "data", "skyblock.db");

if (!fs.existsSync(dbPath)) {
  throw new Error(
    `SkyBlock database not found at ${dbPath}. Run \"npm run prepare-db\" (or \"npm run build\") so data/skyblock.db.gz is expanded first.`
  );
}

// Give a useful error if a Git LFS pointer somehow reaches the runtime.
try {
  const fd = fs.openSync(dbPath, "r");
  const probe = Buffer.alloc(64);
  fs.readSync(fd, probe, 0, probe.length, 0);
  fs.closeSync(fd);
  if (probe.toString("utf8").startsWith("version https://git-lfs.github.com/spec/v1")) {
    throw new Error(
      "data/skyblock.db is a Git LFS pointer, not a SQLite database. Deploy the compressed data/skyblock.db.gz workflow included in this project."
    );
  }
} catch (error) {
  if (error instanceof Error && error.message.includes("Git LFS pointer")) throw error;
}

const IS_PROD = process.env.NODE_ENV === "production";
const IS_VERCEL = !!process.env.VERCEL;
const READONLY = IS_PROD && IS_VERCEL;

export const db = new Database(dbPath, {
  readonly: READONLY,
  fileMustExist: true,
});

// Custom SQLite scalar function used by nearby-colour search. CIEDE2000 is a
// perceptual metric: lower ΔE means the colours look more similar to a human.
db.function("delta_e", { deterministic: true }, (a: unknown, b: unknown) => {
  return deltaE2000(typeof a === "string" ? a : null, typeof b === "string" ? b : null);
});

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
    console.error("DB init error:", e);
    throw e;
  }
} else {
  try {
    db.pragma("query_only = ON");
  } catch {
    // Best effort only.
  }
}

export function fileExists(p = dbPath) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}
