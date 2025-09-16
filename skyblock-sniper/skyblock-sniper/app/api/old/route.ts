import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

/**
 * CSV → rows
 */
function parseCSV(raw: string): Record<string, string>[] {
  const lines = raw.replace(/\r/g, "").split("\n").filter(Boolean);
  if (lines.length === 0) return [];
  const header = lines[0].split(",").map(h => h.trim());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const row: Record<string, string> = {};
    for (let j = 0; j < header.length; j++) row[header[j]] = (cols[j] ?? "").trim();
    rows.push(row);
  }
  return rows;
}

/** CSV splitter that handles quoted fields with commas */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; } else { inQ = !inQ; }
    } else if (ch === "," && !inQ) {
      out.push(cur); cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/** Try a few common column names and normalize to the UI schema */
function mapRowToItem(row: Record<string, string>) {
  const get = (...keys: string[]) => {
    for (const k of keys) if (row[k] && String(row[k]).trim() !== "") return String(row[k]).trim();
    return null;
  };

  const uuid = get("uuid", "id", "item_id") ?? cryptoRandomId();
  const name = get("name", "item_name", "piece_name", "title") ?? "Old Dragon Piece";
  const color = normalizeHex(get("color", "hex", "dye_hex", "dyeHex", "rgb_hex"));
  const rarity = get("rarity", "tier");

  const ownerUuid = get("owner_uuid", "ownerUuid", "player_uuid");
  const ownerUsername = get("owner_username", "owner", "player_name", "username");
  const ownerAvatarUrl = get("owner_avatar", "avatar_url");
  const ownerMcuuidUrl = get("mcuuid_url", "ownerMcuuidUrl");
  const ownerPlanckeUrl = get("plancke_url", "ownerPlanckeUrl");
  const ownerSkyCryptUrl = get("skycrypt_url", "ownerSkyCryptUrl");

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
  };
}

function cryptoRandomId() {
  return "old_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function normalizeHex(h: string | null) {
  if (!h) return null;
  const x = h.replace(/^#/, "").toLowerCase();
  return /^[0-9a-f]{6}$/.test(x) ? `#${x}` : null;
}

function hexToRgb(hex: string) {
  const x = hex.replace("#", "");
  return [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2, 4), 16), parseInt(x.slice(4, 6), 16)] as [number, number, number];
}

function rgbDistance(a: [number, number, number], b: [number, number, number]) {
  // simple Manhattan distance (0..765). Your UI slider max is ~405 on items — keep it consistent if you want.
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
}

function inferPiece(name: string | null) {
  if (!name) return null;
  const n = name.toLowerCase();
  if (/\b(helm|helmet|mask|cap)\b/.test(n)) return "helmet";
  if (/\b(chest|chestplate|torso|tunic|plate)\b/.test(n)) return "chestplate";
  if (/\b(leg|legging|leggings|pants|trouser)\b/.test(n)) return "leggings";
  if (/\b(boot|boots|shoe|shoes|greave)\b/.test(n)) return "boots";
  return null;
}

/** locate CSV on disk */
function getCsvPath(): string | null {
  const prefer = path.join(process.cwd(), "data", "old_dragon_pieces_clean.csv");
  if (fs.existsSync(prefer)) return prefer;
  const dev = "/mnt/data/old_dragon_pieces_clean.csv";
  if (fs.existsSync(dev)) return dev;
  return null;
}

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
      return NextResponse.json({ ok: false, error: "Dataset not found. Place old_dragon_pieces_clean.csv in /data." }, { status: 500 });
    }
    const raw = await fs.promises.readFile(csvPath, "utf8");
    const rows = parseCSV(raw);
    let items = rows.map(mapRowToItem);

    // ensure these are "Old Dragon" only (safety net if dataset has extras)
    items = items.filter((it) => /old\s+dragon/i.test(it.name || "") || /old/i.test(it.name || ""));

    // text filter
    if (q) items = items.filter((it) => (it.name || "").toLowerCase().includes(q));

    // piece inference (optional: if you only want armour pieces)
    items = items.filter((it) => !!inferPiece(it.name));

    // color tolerance filter
    if (color) {
      const target = hexToRgb(color);
      items = items.filter((it) => {
        if (!it.color) return false;
        const dist = rgbDistance(hexToRgb(it.color), target);
        return dist <= tol;
      });
    }

    const total = items.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const start = (page - 1) * limit;
    const paged = items.slice(start, start + limit);

    return NextResponse.json({ ok: true, page, limit, total, totalPages, items: paged });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
