import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

/* =========================
   Types
   ========================= */
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

/* =========================
   CSV utils
   ========================= */
function parseCSV(raw: string): RawRow[] {
  const clean = raw.replace(/^\uFEFF/, "").replace(/\r/g, "");
  const lines = clean.split("\n").filter(Boolean);
  if (!lines.length) return [];
  const header = splitCsvLine(lines[0]).map((h) => h.trim());
  const rows: RawRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const row: RawRow = {};
    for (let j = 0; j < header.length; j++) row[header[j]] = (cols[j] ?? "").trim();
    rows.push(row);
  }
  return rows;
}

// quoted field–aware split
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

/* =========================
   Helpers
   ========================= */
function normalizeHex(h: string | null) {
  if (!h) return null;
  const x = h.replace(/^#/, "").toLowerCase();
  return /^[0-9a-f]{6}$/.test(x) ? `#${x}` : null;
}
function hexToRgb(hex: string) {
  const x = hex.replace("#", "");
  return [parseInt(x.slice(0,2),16), parseInt(x.slice(2,4),16), parseInt(x.slice(4,6),16)] as [number,number,number];
}
function rgbDist(a:[number,number,number], b:[number,number,number]) {
  // Manhattan distance 0..765
  return Math.abs(a[0]-b[0]) + Math.abs(a[1]-b[1]) + Math.abs(a[2]-b[2]);
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

/** map arbitrary CSV row → our item schema (+ keep __raw for flexible search) */
function mapRowToItem(row: RawRow): ItemWithRaw {
  const get = (...keys: string[]) => {
    for (const k of keys) {
      if (k in row && String(row[k]).trim() !== "") return String(row[k]).trim();
    }
    return null;
  };

  const uuid = get("uuid","id","item_id") ?? cryptoRandomId();
  const name = get("name","item_name","piece_name","title") ?? "Old Dragon Piece";
  const color = normalizeHex(get("color","hex","dye_hex","rgb_hex"));
  const rarity = get("rarity","tier");

  const ownerUuid = get("owner_uuid","ownerUuid","player_uuid");
  const ownerUsername = get("owner_username","owner","player_name","username");
  const ownerAvatarUrl = get("owner_avatar","avatar_url");
  const ownerMcuuidUrl = get("mcuuid_url","ownerMcuuidUrl");
  const ownerPlanckeUrl = get("plancke_url","ownerPlanckeUrl");
  const ownerSkyCryptUrl = get("skycrypt_url","ownerSkyCryptUrl");

  return {
    uuid,
    name,
    color,
    rarity,
    ownerUuid,
    ownerUsername,
    ownerAvatarUrl,
    ownerMcuuidUrl,
    ownerPlanckeUrl,
    ownerSkyCryptUrl,
    __raw: row,
  };
}

/* =========================
   Handler
   ========================= */
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
      return NextResponse.json({ ok:false, error:"Dataset not found at /data/old_dragon_pieces_clean.csv" }, { status:500 });
    }

    const raw = await fs.promises.readFile(csvPath, "utf8");
    let items: ItemWithRaw[] = parseCSV(raw).map(mapRowToItem);

    // 🔎 text search across ALL columns
    if (q) {
      items = items.filter(it => {
        if (it.name?.toLowerCase().includes(q)) return true;
        const joined = Object.values(it.__raw).join(" ").toLowerCase();
        return joined.includes(q);
      });
    }

    // 🎯 optional color+tolerance filter (only when color provided)
    if (color) {
      const target = hexToRgb(color);
      items = items.filter(it => it.color && rgbDist(hexToRgb(it.color), target) <= tol);
    }

    // Now drop the helper field for output/pagination
    const itemsOut: ItemOut[] = items.map(({ __raw, ...rest }) => rest);

    const total = itemsOut.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const start = (page - 1) * limit;
    const paged = itemsOut.slice(start, start + limit);

    return NextResponse.json({ ok:true, page, limit, total, totalPages, items: paged });
  } catch (e:any) {
    return NextResponse.json({ ok:false, error: e?.message || String(e) }, { status:500 });
  }
}
