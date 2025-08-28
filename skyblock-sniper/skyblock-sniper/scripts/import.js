import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

const dbPath = process.env.DATABASE_URL || "./skyblock.db";
const db = new Database(dbPath);

const DATA_FILE = process.env.DATA_FILE || "./data/skyblock_items.json";

function parseCSV(text) {
  const [header, ...rows] = text.trim().split(/\r?\n/);
  const cols = header.split(",").map(s => s.trim());
  return rows.map(r => {
    const vals = r.split(",").map(s => s.trim());
    const obj = {};
    cols.forEach((c, i) => (obj[c] = vals[i] ?? ""));
    return obj;
  });
}

function readData() {
  const ext = path.extname(DATA_FILE).toLowerCase();
  const raw = fs.readFileSync(DATA_FILE, "utf8");
  if (ext === ".json") return JSON.parse(raw);
  if (ext === ".csv") return parseCSV(raw);
  throw new Error("Unsupported data file (use .json or .csv)");
}

function main() {
  const data = readData();
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
  const txn = db.transaction((rows) => {
    for (const row of rows) {
      insert.run({
        uuid: row.uuid,
        name: row.name,
        color: row.color ?? null,
        rarity: row.rarity ?? null,
        price: row.price ?? null,
        extra: row.extra ? JSON.stringify(row.extra) : null,
      });
    }
  });

  txn(data);
  const count = db.prepare("SELECT COUNT(*) as n FROM items").get().n;
  console.log(`Imported ${data.length} rows. Total rows: ${count}`);
}

main();
