import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const root = process.cwd();
const dbPath = path.join(root, "data", "skyblock.db");
const gzPath = path.join(root, "data", "skyblock.db.gz");

function isSqlite(file) {
  if (!fs.existsSync(file)) return false;
  const fd = fs.openSync(file, "r");
  const header = Buffer.alloc(16);
  fs.readSync(fd, header, 0, 16, 0);
  fs.closeSync(fd);
  return header.toString("utf8") === "SQLite format 3\u0000";
}

if (isSqlite(dbPath)) {
  console.log("Database already prepared:", dbPath);
  process.exit(0);
}

if (!fs.existsSync(gzPath)) {
  console.error(`Missing ${gzPath}`);
  process.exit(1);
}

console.log("Expanding compressed SkyBlock database for the build...");
const compressed = fs.readFileSync(gzPath);
const decompressed = zlib.gunzipSync(compressed);
fs.writeFileSync(dbPath, decompressed);

if (!isSqlite(dbPath)) {
  console.error("Expanded database is not a valid SQLite file.");
  process.exit(1);
}

console.log(`Prepared ${(decompressed.length / 1024 / 1024).toFixed(1)} MiB database.`);
