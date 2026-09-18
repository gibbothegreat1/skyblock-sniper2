import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import zlib from "node:zlib";
import { deltaE2000 } from "./colorDistance";

const IS_PROD = process.env.NODE_ENV === "production";
const IS_VERCEL = !!process.env.VERCEL;

export const sourceDbPath = path.join(process.cwd(), "data", "skyblock.db");
export const sourceGzPath = path.join(process.cwd(), "data", "skyblock.db.gz");
export const runtimeDbPath = IS_VERCEL ? path.join("/tmp", "skyblock.db") : sourceDbPath;

function isSqliteFile(file: string) {
  try {
    if (!fs.existsSync(file)) return false;
    const fd = fs.openSync(file, "r");
    const header = Buffer.alloc(16);
    fs.readSync(fd, header, 0, 16, 0);
    fs.closeSync(fd);
    return header.toString("utf8") === "SQLite format 3\u0000";
  } catch {
    return false;
  }
}

function expandDatabase(target: string) {
  if (isSqliteFile(target)) return;
  if (!fs.existsSync(sourceGzPath)) {
    throw new Error(`Compressed SkyBlock database not found at ${sourceGzPath}`);
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}`;
  const compressed = fs.readFileSync(sourceGzPath);
  const decompressed = zlib.gunzipSync(compressed);
  fs.writeFileSync(tmp, decompressed);
  fs.renameSync(tmp, target);

  if (!isSqliteFile(target)) {
    throw new Error(`Expanded database at ${target} is not a valid SQLite database.`);
  }
}

function prepareRuntimePath() {
  if (IS_VERCEL) {
    // Vercel's deployed function bundle is read-only. The source DB is in WAL
    // mode, so opening it directly can make SQLite attempt to create -shm/-wal
    // sidecars and fail. Expand the small gzip into writable /tmp instead.
    expandDatabase(runtimeDbPath);
    return runtimeDbPath;
  }

  if (!isSqliteFile(sourceDbPath)) expandDatabase(sourceDbPath);
  return sourceDbPath;
}

type GlobalDb = typeof globalThis & { __skyblockDb?: InstanceType<typeof Database> };
const globalDb = globalThis as GlobalDb;

export function getDb() {
  if (globalDb.__skyblockDb) return globalDb.__skyblockDb;

  const dbPath = prepareRuntimePath();
  // /tmp is writable on Vercel, which lets SQLite safely normalize an old WAL
  // database before switching the connection to query-only mode.
  const db = new Database(dbPath, { fileMustExist: true });

  db.function("delta_e", { deterministic: true }, (a: unknown, b: unknown) => {
    return deltaE2000(typeof a === "string" ? a : null, typeof b === "string" ? b : null);
  });

  if (IS_VERCEL) {
    try { db.pragma("wal_checkpoint(TRUNCATE)"); } catch {}
    try { db.pragma("journal_mode = DELETE"); } catch {}
    try { db.pragma("query_only = ON"); } catch {}
  } else {
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
  }

  globalDb.__skyblockDb = db;
  return db;
}

export function fileExists(p = runtimeDbPath) {
  try { return fs.existsSync(p); } catch { return false; }
}

export function databaseDiagnostics() {
  return {
    isVercel: IS_VERCEL,
    isProd: IS_PROD,
    sourceDbPath,
    sourceGzPath,
    runtimeDbPath,
    sourceDbExists: fs.existsSync(sourceDbPath),
    sourceGzExists: fs.existsSync(sourceGzPath),
    runtimeDbExists: fs.existsSync(runtimeDbPath),
    sourceGzSize: fs.existsSync(sourceGzPath) ? fs.statSync(sourceGzPath).size : null,
    runtimeDbSize: fs.existsSync(runtimeDbPath) ? fs.statSync(runtimeDbPath).size : null,
  };
}
