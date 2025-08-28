import fs from "fs";
import Database from "better-sqlite3";

const dbPath = process.env.DATABASE_URL || "./skyblock.db";
const db = new Database(dbPath);

/* --- Ensure schema exists (creates tables, FTS, triggers, indexes) --- */
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
`);

/* --- your data file --- */
const DATA_FILE = process.env.DATA_FILE || "./data/filter_Ha3l_tem-1.txt";

function humanizeItemId(id = "") {
  return id.toLowerCase().split("_").map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(" ");
}

function toJsonLine(line) {
  const trimmed = line.trim()
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .replace(/},\s*$/, "}")
    .replace(/}],?$/, "}");
  if (!trimmed) return null;
  const jsonish = trimmed
    .replace(/'([^']*)':/g, "\"$1\":")
    .replace(/: '([^']*)'/g, ": \"$1\"");
  try { return JSON.parse(jsonish); } catch { return null; }
}

function readItems() {
  const raw = fs.readFileSync(DATA_FILE, "utf8");
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const rows = [];
  for (const line of lines) {
    const obj = toJsonLine(line);
    if (!obj) continue;
    const color = obj.hexCode ? (obj.hexCode.startsWith("#") ? obj.hexCode : `#${obj.hexCode}`) : null;
    rows.push({
      uuid: obj.uuid,
      name: humanizeItemId(obj.itemId || ""),
      color,
      rarity: obj.rarity || null,
      price: null,
      extra: {
        itemId: obj.itemId,
        hexCode: obj.hexCode,
        reforge: obj.reforge || null,
        owner_playerUuid: obj.owner?.playerUuid || null,
        owner_profileUuid: obj.owner?.profileUuid || null,
        creationTime: obj.creationTime || null,
        lastChecked: obj.lastChecked || null,
      }
    });
  }
  return rows;
}

function main() {
  const insert = db.prepare(`
    INSERT INTO items (uuid, name, color, rarity, price, extra)
    VALUES (@uuid, @name, @color, @rarity, @price, @extra)
    ON CONFLICT(uuid) DO UPDATE SET
      name=excluded.name,
      color=excluded.color,
      rarity=excluded.rarity,
      price=excluded.price,
      extra=excluded.extra;
  `);

  const data = readItems();
  const txn = db.transaction((rows) => {
    for (const row of rows) insert.run({ ...row, extra: JSON.stringify(row.extra) });
  });
  txn(data);

  const count = db.prepare("SELECT COUNT(*) AS n FROM items").get().n;
  console.log(`Imported ${data.length} rows from ${DATA_FILE}. Total rows: ${count}`);
}

main();
