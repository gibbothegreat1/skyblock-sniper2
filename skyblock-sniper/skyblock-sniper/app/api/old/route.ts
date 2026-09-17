import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { deltaE2000 } from "../../../lib/colorDistance";
import { getNonExoticHexType } from "../../../lib/nonExoticHexes";

/* ---------- Types ---------- */
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
  hexType: "fairy" | "crystal" | null;
  isExotic: boolean;
  deltaE: number | null;
};

type ItemWithRaw = ItemOut & { __raw: RawRow };

/* ---------- Small utils ---------- */
const normalizeHex = (h?: string | null) => {
  if (!h) return null;
  const x = h.replace(/^#/, "").trim().toLowerCase();
  return /^[0-9a-f]{6}$/.test(x) ? `#${x}` : null;
};
const cryptoRandomId = () => "old_" + Math.random().toString(36).slice(2) + Date.now().toString(36);

function getCsvPath(): string | null {
  const prefer = path.join(process.cwd(), "data", "old_dragon_pieces_clean.csv");
  if (fs.existsSync(prefer)) return prefer;
  const alt = "/mnt/data/old_dragon_pieces_clean.csv";
  if (fs.existsSync(alt)) return alt;
  return null;
}

/* ---------- Table parsing (CSV or TSV) ---------- */
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
  const header = (delim === "\t" ? lines[0].split("\t") : splitCsvLine(lines[0])).map((h) => h.trim());
  const rows: RawRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = delim === "\t" ? lines[i].split("\t") : splitCsvLine(lines[i]);
    const row: RawRow = {};
    for (let j = 0; j < header.length; j++) row[header[j]] = (cols[j] ?? "").trim();
    rows.push(row);
  }
  return rows;
}

/* ---------- Name mapping ---------- */
const toTitleCaseWords = (s: string) =>
  s.toLowerCase().replace(/_/g, " ").replace(/\b([a-z])/g, (m) => m.toUpperCase());

const nameFromPiece = (itemId?: string | null, pieceType?: string | null) => {
  const raw = pieceType || itemId || "";
  if (!raw) return "Old Dragon Piece";
  return toTitleCaseWords(raw.replace(/^OLD_DRAGON_/, "Old Dragon "));
};

/* ---------- Username resolver (with cache) ---------- */
const usernameCache = new Map<string, string>(); // uuid -> username

async function fetchUsernameFromMojang(uuid: string): Promise<string | null> {
  // Mojang "names" history → last entry is current username
  // uuid must be without hyphens
  const bare = uuid.replace(/-/g, "");
  const res = await fetch(`https://api.mojang.com/user/profiles/${bare}/names`, { cache: "force-cache" });
  if (!res.ok) return null;
  const arr = (await res.json()) as Array<{ name: string }>;
  if (!Array.isArray(arr) || !arr.length) return null;
  return arr[arr.length - 1].name || null;
}
async function fetchUsernameFromPlayerDB(uuid: string): Promise<string | null> {
  const res = await fetch(`https://playerdb.co/api/player/minecraft/${uuid}`, { cache: "force-cache" });
  if (!res.ok) return null;
  const json = await res.json();
  return json?.data?.player?.username ?? null;
}
async function resolveUsername(uuid: string): Promise<string | null> {
  if (!uuid) return null;
  const cached = usernameCache.get(uuid);
  if (cached) return cached;

  let name: string | null = null;
  try { name = await fetchUsernameFromMojang(uuid); } catch {/* ignore */}
  if (!name) {
    try { name = await fetchUsernameFromPlayerDB(uuid); } catch {/* ignore */}
  }
  if (name) usernameCache.set(uuid, name);
  return name;
}

/* ---------- Row → Item ---------- */
function mapRow(row: RawRow): ItemWithRaw {
  const ownerUuid = row["currentOwner.playerUuid"] || null;
  const ownerProfile = row["currentOwner.profileUuid"] || null;

  const out: ItemWithRaw = {
    uuid: row["_id"] || row["id"] || cryptoRandomId(),
    name: nameFromPiece(row["itemId"], row["piece_type"]),
    color: normalizeHex(row["color_hex"]) ?? normalizeHex(row["colour"]),
    rarity: row["rarity"] || null,
    ownerUuid,
    ownerUsername: null, // filled later by resolver
    ownerAvatarUrl: ownerUuid ? `https://crafatar.com/avatars/${ownerUuid}?size=20&overlay` : null,
    ownerMcuuidUrl: ownerUuid ? `https://mcuuid.net/?q=${ownerUuid}` : null,
    ownerPlanckeUrl: ownerUuid ? `https://plancke.io/hypixel/player/stats/${ownerUuid}` : null,
    ownerSkyCryptUrl: ownerUuid
      ? `https://sky.shiiyu.moe/stats/${ownerUuid}${ownerProfile ? `/${ownerProfile}` : ""}`
      : null,
    hexType: getNonExoticHexType(normalizeHex(row["color_hex"]) ?? normalizeHex(row["colour"])),
    isExotic: getNonExoticHexType(normalizeHex(row["color_hex"]) ?? normalizeHex(row["colour"])) === null,
    deltaE: null,
    __raw: row,
  };
  return out;
}

/* ---------- Handler ---------- */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") || "").trim().toLowerCase();
    const color = normalizeHex(url.searchParams.get("color"));
    const tol = Math.max(0, Math.min(100, parseFloat(url.searchParams.get("tolerance") || "0") || 0));
    const includeFairy = url.searchParams.get("includeFairy") === "1";
    const includeCrystal = url.searchParams.get("includeCrystal") === "1";
    const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
    const limit = Math.max(1, Math.min(200, parseInt(url.searchParams.get("limit") || "24", 10)));

    const csvPath = getCsvPath();
    if (!csvPath) {
      return NextResponse.json({ ok: false, error: "Dataset not found at /data/old_dragon_pieces_clean.csv" }, { status: 500 });
    }

    const raw = await fs.promises.readFile(csvPath, "utf8");
    let items: ItemWithRaw[] = parseTable(raw).map(mapRow);

    // 🔎 text search
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

    // Hide known non-exotic colours unless explicitly included.
    items = items.filter((it) => {
      if (it.hexType === "fairy" && !includeFairy) return false;
      if (it.hexType === "crystal" && !includeCrystal) return false;
      return true;
    });

    // 🎯 optional color filter
    if (color) {
      items = items
        .map((it) => ({ ...it, deltaE: it.color ? Math.round(deltaE2000(it.color, color) * 100) / 100 : null }))
        .filter((it) => it.deltaE !== null && it.deltaE <= tol)
        .sort((a, b) => (a.deltaE ?? 999999) - (b.deltaE ?? 999999));
    }

    // Paginate before external username lookups so one request never fans out
    // across the whole legacy dataset.
    const total = items.length;
    const totalPages = total ? Math.max(1, Math.ceil(total / limit)) : 0;
    const start = (page - 1) * limit;
    const pageItems = items.slice(start, start + limit);

    const uuids = Array.from(new Set(pageItems.map((it) => it.ownerUuid).filter(Boolean) as string[]));
    const nameMap = new Map<string, string | null>();
    await Promise.all(uuids.map(async (u) => nameMap.set(u, await resolveUsername(u))));
    pageItems.forEach((it) => {
      if (it.ownerUuid && !it.ownerUsername) {
        const n = nameMap.get(it.ownerUuid) || null;
        if (n) it.ownerUsername = n;
      }
    });

    const paged: ItemOut[] = pageItems.map(({ __raw, ...rest }) => rest);
    return NextResponse.json({ ok: true, page, limit, total, totalPages, items: paged, distanceMetric: "CIEDE2000", filters: { includeFairy, includeCrystal } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
