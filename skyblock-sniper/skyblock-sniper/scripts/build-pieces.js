// Usage:
// 1) put this file at project root as scripts/build-pieces.js
// 2) put the 3 CSVs in ./data/
//    - OLD_DRAGON_BOOTS_*.csv
//    - OLD_DRAGON_LEGGINGS_*.csv
//    - OLD_DRAGON_CHESTPLATE_*.csv
// 3) run:  node scripts/build-pieces.js
//
// Output: data/old_dragon_pieces_clean.csv

import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

/////////////////////////////
// CONFIG: tweak if needed //
/////////////////////////////

const CONFIG = {
  dataDir: path.join(process.cwd(), 'data'),
  outputCsv: path.join(process.cwd(), 'data', 'old_dragon_pieces_clean.csv'),

  // Try these header names in order to find the right column.
  headers: {
    color: ['color', 'colour', 'hex', 'color_hex', 'colorhex', 'colour_hex', 'dye', 'item_color', 'colorDecimal', 'color_decimal'],
    playerUuid: ['player_uuid', 'uuid', 'playerUuid', 'playerId', 'owner_uuid', 'owner', 'profile_id'],
    museumFlag: ['museum_donated', 'is_museum_donated', 'donated_to_museum', 'museum', 'isMuseumDonated', 'museumDonated']
  }
};

// Your banned colours (normalized to lowercase, no '#'):
const BANNED_SINGLE = new Set([
  'f0e6aa',
  // 'ao6540' looks like a typo; normalize 'o'->'0' below so this catches 'a06540'
  'a06540'
]);

// 0..15 gradient list:
const BANNED_GRADIENT = [
  '#1F0030', '#46085E', '#54146E', '#5D1C78', '#63237D',
  '#6A2C82', '#7E4196', '#8E51A6', '#9C64B3', '#A875BD',
  '#B88BC9', '#C6A3D4', '#D9C1E3', '#E5D1ED', '#EFE1F5', '#FCF3FF'
];

// FAIRY COLORS (deduped; list repeats):
const BANNED_FAIRY = [
  '#660033','#99004C','#CC0066','#FF007F','#FF3399','#FF66B2','#FF99CC','#FFCCE5',
  '#660066','#990099','#CC00CC','#FF00FF','#FF33FF','#FF66FF','#FF99FF','#FFCCFF',
  '#E5CCFF','#CC99FF','#B266FF','#9933FF','#7F00FF','#6600CC','#4C0099','#330066'
];

// Normalize: lower-case, strip '#'
function normHex(h) {
  if (h == null) return null;
  let s = String(h).trim();
  // common typos: use '0' instead of 'o' in hex-ish strings
  s = s.replace(/o/gi, '0');
  if (s.startsWith('#')) s = s.slice(1);
  return s.toLowerCase();
}

const BANNED_SET = new Set([
  ...BANNED_SINGLE,
  ...BANNED_GRADIENT.map(h => normHex(h)),
  ...BANNED_FAIRY.map(h => normHex(h))
]);

// Heuristics: is the value a base-10 integer (decimal) that likely represents an RGB?
function looksDecimalColor(value) {
  if (value === null || value === undefined) return false;
  const s = String(value).trim();
  if (!/^\d+$/.test(s)) return false;
  // accept in 0..16777215 range
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 && n <= 16777215;
}

// Convert decimal (0..16777215) → "#rrggbb"
function decToHex(dec) {
  const n = Number(dec);
  const hex = n.toString(16).padStart(6, '0');
  return `#${hex}`;
}

// Normalize any colour-ish input to "#rrggbb"
function toCanonicalHex(v) {
  if (v == null) return null;

  let s = String(v).trim();
  // replace common typo o -> 0 in hex-like strings
  s = s.replace(/o/gi, '0');

  // Already a hex like "#aabbcc" or "aabbcc"
  if (/^#?[0-9a-fA-F]{6}$/.test(s)) {
    const noHash = s.startsWith('#') ? s.slice(1) : s;
    return `#${noHash.toLowerCase()}`;
  }

  // Decimal
  if (looksDecimalColor(s)) {
    return decToHex(s);
  }

  // Not recognized
  return null;
}

function detectColumn(row, candidates) {
  for (const c of candidates) {
    if (Object.prototype.hasOwnProperty.call(row, c)) return c;
  }
  // try case-insensitive match
  const lcMap = new Map(Object.keys(row).map(k => [k.toLowerCase(), k]));
  for (const c of candidates) {
    if (lcMap.has(c.toLowerCase())) return lcMap.get(c.toLowerCase());
  }
  return null;
}

function truthyFlag(v) {
  if (v == null) return false;
  const s = String(v).trim().toLowerCase();
  return ['true','1','yes','y','t'].includes(s);
}

function inferPieceTypeFromFile(filename) {
  const upper = filename.toUpperCase();
  if (upper.includes('BOOTS')) return 'boots';
  if (upper.includes('LEGGINGS')) return 'leggings';
  if (upper.includes('CHESTPLATE')) return 'chestplate';
  return 'unknown';
}

function readCsv(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  return parse(text, { columns: true, skip_empty_lines: true });
}

function toOutRow(row, cols, pieceType) {
  // normalize color
  const colorHex = toCanonicalHex(row[cols.color]);
  const colorNorm = colorHex ? normHex(colorHex) : null;

  return {
    ...row,
    piece_type: pieceType,          // boots | leggings | chestplate
    color_hex: colorHex || '',      // canonical "#rrggbb" (or empty if missing)
    _color_norm: colorNorm || ''    // internal for filtering; dropped on write
  };
}

function isBannedColor(hexOrNull) {
  if (!hexOrNull) return false;
  return BANNED_SET.has(normHex(hexOrNull));
}

function main() {
  // Collect all matching CSVs
  const files = fs.readdirSync(CONFIG.dataDir)
    .filter(f => /^OLD_DRAGON_(BOOTS|LEGGINGS|CHESTPLATE)_.*\.csv$/i.test(f))
    .map(f => path.join(CONFIG.dataDir, f));

  if (files.length === 0) {
    console.error(`No input CSVs found in ${CONFIG.dataDir}.`);
    process.exit(1);
  }

  const merged = [];

  for (const file of files) {
    const rows = readCsv(file);
    if (rows.length === 0) continue;

    // Detect columns on the first row of this file
    const sample = rows[0];
    const colorCol = detectColumn(sample, CONFIG.headers.color);
    const uuidCol  = detectColumn(sample, CONFIG.headers.playerUuid);
    const museumCol = detectColumn(sample, CONFIG.headers.museumFlag);

    if (!uuidCol) {
      console.warn(`[WARN] Could not detect player UUID column in ${path.basename(file)}. Looked for: ${CONFIG.headers.playerUuid.join(', ')}`);
    }
    if (!colorCol) {
      console.warn(`[WARN] Could not detect color column in ${path.basename(file)}. Looked for: ${CONFIG.headers.color.join(', ')}`);
    }
    if (!museumCol) {
      console.warn(`[WARN] Could not detect museum flag column in ${path.basename(file)}. Looked for: ${CONFIG.headers.museumFlag.join(', ')}`);
    }

    const pieceType = inferPieceTypeFromFile(path.basename(file));

    for (const r of rows) {
      // normalize missing columns to undefined so our helpers don't choke
      if (colorCol && !(colorCol in r)) r[colorCol] = undefined;
      if (uuidCol && !(uuidCol in r)) r[uuidCol] = undefined;
      if (museumCol && !(museumCol in r)) r[museumCol] = undefined;

      const out = toOutRow(r, { color: colorCol, uuid: uuidCol, museum: museumCol }, pieceType);

      // FILTER 1: museum donated
      const museum = museumCol ? r[museumCol] : null;
      if (truthyFlag(museum)) continue;

      // FILTER 2: banned colours
      if (isBannedColor(out.color_hex)) continue;

      merged.push(out);
    }
  }

  // sort by player uuid (stable). If missing, it falls back to empty string.
  merged.sort((a, b) => {
    const uuidA = String(a[detectColumn(a, CONFIG.headers.playerUuid)] ?? '').toLowerCase();
    const uuidB = String(b[detectColumn(b, CONFIG.headers.playerUuid)] ?? '').toLowerCase();
    if (uuidA < uuidB) return -1;
    if (uuidA > uuidB) return 1;
    return 0;
  });

  // Write CSV (drop the internal helper column)
  const cleaned = merged.map(({ _color_norm, ...rest }) => rest);

  const csv = stringify(cleaned, {
    header: true
  });

  fs.mkdirSync(path.dirname(CONFIG.outputCsv), { recursive: true });
  fs.writeFileSync(CONFIG.outputCsv, csv, 'utf8');

  console.log(`Wrote ${cleaned.length} rows → ${CONFIG.outputCsv}`);
}

main();
