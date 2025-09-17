import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

/* -------- Types -------- */
type RawRow = Record<string, string>;

type ItemOut = {
  uuid: string;
  name: string;
  color: string | null;
  rarity: string | null;
  ownerUuid: string | null;
  ownerUsername: string | null;
  ownerAvatarUrl: string | null;
  ownerMcuuidUrl: string | null;
  ownerPlanckeUrl: string | null;
  ownerSkyCryptUrl: string | null;
};

type ItemWithRaw = ItemOut & { __raw: RawRow };

/* -------- Utils -------- */
function normalizeHex(h: string | null | undefined) {
  if (!h) return null;
  const x = h.replace(/^#/, "").trim().toLowerCase();
  return /^[0-9a-f]{6}$/.test(x) ? `#${x}` : null;
}

function hexToRgb(hex: string) {
  const x = hex.replace("#", "");
  return [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2, 4), 16), parseInt(x.slice(4, 6), 16)] as [number, number, number];
}
function rgbDist(a: [number, number, number], b: [number, number, number]) {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]); // 0..765
}

function cryptoRandomId() {
  return "old_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function getCsvPath(): string | null {
  const prefer = path.join(process.cwd(), "data", "old_dragon_pieces_clean.csv");
  if (fs.existsSync(prefer)) return prefer;
  const alt = "/mnt/data/old_dragon_pieces_clean.csv";
  if (fs.existsSync(alt)) return alt;
  return null;
}

/* Detect delimiter (TSV vs CSV) and split safely for CSV */
function detectDelimiter(firstLine: string) {
  const tabs = (firstLine.match(/\t/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  return tabs > commas ? "\t" : ",";
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === "," && !inQ) { out.push(cur); cur = ""; }
    else { cur += ch; }
  }
  out.push(cur);
  return out;
}

function parseTable(raw: string): RawRow[] {
  const clean = raw.replace(/^\uFEFF/, "").replace(/\r/g, "");
  const lines = clean.split("\n").filter(Boolean);
  if (!lines.length) return [];
  const delim = detectDelimiter(lines[0]);
  const header = (delim === "\t" ? lines[0].split("\t") : splitCsvLine(lines[0])).map(h => h.trim());
  const rows: RawRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = delim === "\t" ? lines[i].split("\t") : splitCsvLine(lines[i]);
    const row: RawRow = {};
    for (let j = 0; j < header.length; j++) row[header[j]] = (cols[j] ?? "").trim();
    rows.push(row);
  }
  return rows;
}

/* Map row → item (matches your home/items schema) */
function toTitleCaseWords(s: string) {
  return s
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

function nameFromPiece(itemId?: string | null, pieceType?: string | null) {
  const raw = pieceType || itemId || "";
  if (!raw) return "Old Dragon Piece";
  return toTitleCaseWords(raw.replace(/^OLD_DRAGON_/, "Old Dragon "));
}

function mapRow(row: RawRow): ItemWithRaw {
  const uuid = row["_id"] || row["id"] || cryptoRandomId();

  const name = nameFromPiece(row["itemId"], row["piece_type"]);

  // prefer explicit hex column; fallback to "colour" (no '#')
  const color = normalizeHex(row["color_hex"]) ?? normalizeHex(row["colour"]);

  const rarity = row["rarity"] || null;

  const ownerUuid = row["currentOwner.playerUuid"] || null;
  const ownerProfile = row["currentOwner.profileUuid"] || null;

  const ownerAvatarUrl = ownerUuid ? `https://crafatar.com/avatars/${ownerUuid}?size=20&overlay` : null;
  const ownerPlanckeUrl = ownerUuid ? `https://plancke.io/hypixel/player/stats/${ownerUuid}` : null;
  const ownerMcuuidUrl = ownerUuid ? `https://mcuuid.net/?q=${ownerUuid}` : null;
  // SkyCrypt accepts UUID + optional profile UUID
  const ownerSkyCryptUrl = ownerUuid
    ? `https://sky.shiiyu.moe/stats/${ownerUuid}${ownerProfile ? `/${ownerProfile}` : ""}`
    : null;

  return {
    uuid,
    name,
    color,
    rarity,
    ownerUuid,
    ownerUsername: null, // username is not present in your dataset
    ownerAvatarUrl,
    ownerMcuuidUrl,
    ownerPlanckeUrl,
    ownerSkyCryptUrl,
    __raw: row,
  };
}

/* -------- Handler -------- */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") || "").trim().toLowerCase();
    const color = normalizeHex(url.searchParams.get("color"));
    const tol = Math.max(0, Math.min(10000, parseInt(url.searchParams.get("tolerance") || "0", 10) || 0));
    const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
    const limit = Math.max(1, Math.min(200, parseInt(url.searchParams.get("limit") || "24", 10)));

    const csvPath = getCsvPath();
    if (!csvPath) {
      return NextResponse.json({ ok: false, error: "Dataset not found at /data/old_dragon_pieces_clean.csv" }, { status: 500 });
    }

    const raw = await fs.promises.readFile(csvPath, "utf8");
    let items: ItemWithRaw[] = parseTable(raw).map(mapRow);

    // text search over common columns
    if (q) {
      items = items.filter((it) => {
        const nameHit = it.name?.toLowerCase().includes(q);
        const rawHit =
          (it.__raw["piece_type"] || "").toLowerCase().includes(q) ||
          (it.__raw["itemId"] || "").toLowerCase().includes(q) ||
          (it.__raw["reforge"] || "").toLowerCase().includes(q) ||
          (it.__raw["rarity"] || "").toLowerCase().includes(q) ||
          (it.__raw["currentOwner.playerUuid"] || "").toLowerCase().includes(q);
        return nameHit || rawHit;
      });
    }

    // optional color+tolerance filter (when color provided)
    if (color) {
      const target = hexToRgb(color);
      items = items.filter((it) => {
        const c = it.color;
        return c ? rgbDist(hexToRgb(c), target) <= tol : false;
        // (rows with no colour are excluded when filtering by colour)
      });
    }

    // strip helper
    const itemsOut: ItemOut[] = items.map(({ __raw, ...rest }) => rest);

    const total = itemsOut.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const start = (page - 1) * limit;
    const paged = itemsOut.slice(start, start + limit);

    return NextResponse.json({ ok: true, page, limit, total, totalPages, items: paged });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
