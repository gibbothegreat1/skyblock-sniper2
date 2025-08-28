import { NextResponse } from "next/server";
import { db } from "../../../lib/db";

export const runtime = "nodejs";

const IS_PROD = process.env.NODE_ENV === "production";
const IS_VERCEL = !!process.env.VERCEL;
const CAN_WRITE = !(IS_PROD && IS_VERCEL);

/* ----------------- helpers ----------------- */
function normalizeHex(input?: string | null): string | null {
  if (!input) return null;
  let s = String(input).trim();
  if (s.startsWith("#")) s = s.slice(1);
  if (/^[0-9A-Fa-f]{3}$/.test(s)) s = s.split("").map((c) => c + c).join("");
  if (!/^[0-9A-Fa-f]{6}$/.test(s)) return null;
  return `#${s.toUpperCase()}`;
}
function titleCase(s?: string | null) {
  if (!s) return "";
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}
function avatarUrl(uuidMaybeDashed?: string | null, size = 24) {
  if (!uuidMaybeDashed) return null;
  return `https://crafatar.com/avatars/${uuidMaybeDashed.replace(/-/g, "")}?size=${size}&overlay`;
}

type Row = {
  id: number;
  uuid: string;
  name: string;
  color?: string | null;
  rarity?: string | null;
  extra?: string | null;
};

type PieceKind = "helmet" | "chestplate" | "leggings" | "boots";
const PIECE_MATCHERS: Record<PieceKind, RegExp[]> = {
  helmet:    [/helmet/i, /\bhelm\b/i, /\bcap\b/i],
  chestplate:[/chest/i, /chestplate/i, /\bchest\b/i],
  leggings:  [/legging/i, /pants/i, /\blegs?\b/i],
  boots:     [/boot/i, /shoe/i],
};

function detectPiece(name: string): PieceKind | null {
  for (const kind of Object.keys(PIECE_MATCHERS) as PieceKind[]) {
    if (PIECE_MATCHERS[kind].some((re) => re.test(name))) return kind;
  }
  return null;
}

// If user searches something containing "dragon", treat as 3-piece (no helmet). Otherwise 4-piece.
function requiresHelmet(setQuery: string): boolean {
  return !/dragon/i.test(setQuery || "");
}

async function resolveUsername(uuidMaybeDashed?: string | null): Promise<string | null> {
  if (!uuidMaybeDashed) return null;
  const uuid = uuidMaybeDashed.replace(/-/g, "").toLowerCase();

  try {
    if (CAN_WRITE) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS username_cache(
          uuid TEXT PRIMARY KEY,
          username TEXT,
          fetched_at INTEGER
        )
      `);
      const cached = db
        .prepare(`SELECT username, fetched_at FROM username_cache WHERE uuid = ?`)
        .get(uuid) as { username?: string | null; fetched_at?: number } | undefined;
      const now = Date.now();
      if (cached?.fetched_at && now - cached.fetched_at < 24 * 60 * 60 * 1000) {
        return cached.username ?? null;
      }
      const r = await fetch(`https://api.ashcon.app/mojang/v2/user/${uuid}`, { cache: "no-store" });
      if (r.ok) {
        const j = (await r.json()) as { username?: string; name?: string };
        const name = j.username || j.name || null;
        db.prepare(
          `INSERT INTO username_cache(uuid, username, fetched_at)
           VALUES(?,?,?)
           ON CONFLICT(uuid) DO UPDATE SET username=excluded.username, fetched_at=excluded.fetched_at`
        ).run(uuid, name, now);
        return name;
      }
      return null;
    } else {
      const r = await fetch(`https://api.ashcon.app/mojang/v2/user/${uuid}`, { cache: "no-store" });
      if (!r.ok) return null;
      const j = (await r.json()) as { username?: string; name?: string };
      return j.username || j.name || null;
    }
  } catch {
    return null;
  }
}

/* ----------------- handler ----------------- */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const qRaw = (searchParams.get("q") || "").trim();          // set name keyword(s), e.g. "wise dragon" or "farm suit"
    const color = (searchParams.get("color") || "").trim();     // hex, required
    const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "24", 10) || 24, 1), 100);
    const page = Math.max(parseInt(searchParams.get("page") || "1", 10) || 1, 1);
    const offset = (page - 1) * limit;

    const hex = normalizeHex(color);
    if (!hex) {
      return NextResponse.json({ ok: false, error: "Provide exact hex in `color` (e.g. 191919 or #191919)." }, { status: 400 });
    }
    if (!qRaw) {
      return NextResponse.json({ ok: false, error: "Provide a set keyword in `q` (e.g. 'wise dragon' or 'farm suit')." }, { status: 400 });
    }

    const hexNoHash = hex.slice(1).toUpperCase();

    // Base query: exact color + name LIKE set terms
    const like = `%${qRaw.replace(/\s+/g, " ").trim()}%`;
    const rows = db.prepare(
      `SELECT id, uuid, name, color, rarity, extra
       FROM items
       WHERE UPPER(REPLACE(COALESCE(color,''), '#','')) = ?
         AND LOWER(name) LIKE LOWER(?)
       ORDER BY name`
    ).all(hexNoHash, like) as Row[];

    // Build groups: by owner + normalized set label (from qRaw for stability) + hex
    const wantHelmet = requiresHelmet(qRaw);
    const groups = new Map<string, {
      ownerUuid: string | null;
      ownerUsername: string | null;
      ownerAvatarUrl: string | null;
      ownerMcuuidUrl: string | null;
      ownerPlanckeUrl: string | null;
      ownerSkyCryptUrl: string | null;
      setLabel: string;  // e.g. "Wise Dragon Set" or "Farm Suit Set"
      color: string;
      pieces: Partial<Record<PieceKind, Row>>;
      rarity?: string | null;
    }>();

    // First pass: bucket rows
    for (const r of rows) {
      let ownerUuid: string | null = null;
      let rarity: string | null = r.rarity ?? null;
      try {
        const extra = r.extra ? JSON.parse(r.extra) : null;
        ownerUuid = extra?.owner_playerUuid || extra?.owner?.playerUuid || null;
      } catch {}

      if (!ownerUuid) continue; // we can only form sets when all owned by same player

      const piece = detectPiece(r.name || "");
      if (!piece) continue; // skip items that don't map to a known piece

      const ownerKey = ownerUuid.toLowerCase();
      const setLabel = `${titleCase(qRaw)} Set`;
      const key = `${ownerKey}::${setLabel}::${hexNoHash}`;

      if (!groups.has(key)) {
        const ownerUuidFlat = ownerUuid.replace(/-/g, "");
        groups.set(key, {
          ownerUuid,
          ownerUsername: null,
          ownerAvatarUrl: avatarUrl(ownerUuid, 24),
          ownerMcuuidUrl: `https://mcuuid.net/?q=${ownerUuidFlat}`,
          ownerPlanckeUrl: null, // filled after username
          ownerSkyCryptUrl: `https://sky.shiiyu.moe/stats/${ownerUuidFlat}`,
          setLabel,
          color: hex,
          pieces: {},
          rarity,
        });
      }
      const g = groups.get(key)!;
      // prefer keeping first encountered; avoid overwriting if multiple matches exist
      if (!g.pieces[piece]) g.pieces[piece] = r;
      if (!g.rarity && r.rarity) g.rarity = r.rarity;
    }

    // Filter only complete sets per the rule
    const completed = Array.from(groups.values()).filter(g => {
      const hasChest = !!g.pieces.chestplate;
      const hasLegs  = !!g.pieces.leggings;
      const hasBoots = !!g.pieces.boots;
      const hasHelm  = !!g.pieces.helmet;
      return wantHelmet ? (hasHelm && hasChest && hasLegs && hasBoots)
                        : (hasChest && hasLegs && hasBoots);
    });

    // Resolve usernames (cap to 50 to keep response fast)
    const owners = Array.from(new Set(completed.map(g => g.ownerUuid!).filter(Boolean))).slice(0, 50);
    const nameMap = new Map<string, string | null>();
    await Promise.all(owners.map(async (u) => nameMap.set(u, await resolveUsername(u))));
    for (const g of completed) {
      if (g.ownerUuid && nameMap.has(g.ownerUuid)) {
        g.ownerUsername = nameMap.get(g.ownerUuid) || null;
        if (g.ownerUsername) g.ownerPlanckeUrl = `https://plancke.io/hypixel/player/stats/${g.ownerUsername}`;
      }
    }

    // Sort: by setLabel, then ownerUsername (or uuid), then rarity
    completed.sort((a, b) => {
      const s = a.setLabel.localeCompare(b.setLabel);
      if (s) return s;
      const au = a.ownerUsername || a.ownerUuid || "";
      const bu = b.ownerUsername || b.ownerUuid || "";
      const u = au.localeCompare(bu);
      if (u) return u;
      return String(a.rarity || "").localeCompare(String(b.rarity || ""));
    });

    const total = completed.length;
    const totalPages = total ? Math.max(1, Math.ceil(total / limit)) : 0;
    const pageItems = completed.slice(offset, offset + limit).map(g => ({
      setLabel: g.setLabel,
      color: g.color,
      rarity: g.rarity || null,
      ownerUuid: g.ownerUuid,
      ownerUsername: g.ownerUsername,
      ownerAvatarUrl: g.ownerAvatarUrl,
      ownerMcuuidUrl: g.ownerMcuuidUrl,
      ownerPlanckeUrl: g.ownerPlanckeUrl,
      ownerSkyCryptUrl: g.ownerSkyCryptUrl,
      pieces: {
        helmet: g.pieces.helmet ? { uuid: g.pieces.helmet.uuid, name: g.pieces.helmet.name } : null,
        chestplate: g.pieces.chestplate ? { uuid: g.pieces.chestplate.uuid, name: g.pieces.chestplate.name } : null,
        leggings: g.pieces.leggings ? { uuid: g.pieces.leggings.uuid, name: g.pieces.leggings.name } : null,
        boots: g.pieces.boots ? { uuid: g.pieces.boots.uuid, name: g.pieces.boots.name } : null,
      },
    }));

    return NextResponse.json({
      ok: true,
      page,
      limit,
      total,
      totalPages,
      items: pageItems,
      targetHex: hex,
      requiresHelmet: wantHelmet,
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: "Internal Server Error" }, { status: 500 });
  }
}
