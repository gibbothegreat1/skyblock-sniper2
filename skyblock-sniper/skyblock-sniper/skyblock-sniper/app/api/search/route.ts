import { NextResponse } from "next/server";
import { db } from "../../../lib/db";
import {
  CRYSTAL_HEXES,
  FAIRY_HEXES,
  getNonExoticHexType,
  normalizeHexForLookup,
} from "../../../lib/nonExoticHexes";

export const runtime = "nodejs";
export const maxDuration = 60;

const IS_PROD = process.env.NODE_ENV === "production";
const IS_VERCEL = !!process.env.VERCEL;
const CAN_WRITE = !(IS_PROD && IS_VERCEL);

function titleCase(s?: string | null) {
  if (!s) return "Clean";
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function avatarUrl(uuidMaybeDashed?: string | null, size = 20) {
  if (!uuidMaybeDashed) return null;
  return `https://crafatar.com/avatars/${uuidMaybeDashed.replace(/-/g, "")}?size=${size}&overlay`;
}

type Row = {
  id: number;
  uuid: string;
  name: string;
  color?: string | null;
  rarity?: string | null;
  price?: number | null;
  extra?: string | null;
};

type Out = {
  id: number;
  uuid: string;
  name: string;
  color?: string | null;
  rarity?: string | null;
  price?: number | null;
  reforge: string;
  ownerUuid: string | null;
  ownerUsername: string | null;
  ownerAvatarUrl: string | null;
  ownerMcuuidUrl: string | null;
  ownerPlanckeUrl: string | null;
  ownerSkyCryptUrl: string | null;
  hexType: "fairy" | "crystal" | null;
  isExotic: boolean;
};

async function resolveUsername(uuidMaybeDashed?: string | null): Promise<string | null> {
  if (!uuidMaybeDashed) return null;
  const uuid = uuidMaybeDashed.replace(/-/g, "").toLowerCase();

  try {
    if (CAN_WRITE) {
      const cached = db
        .prepare(`SELECT username, fetched_at FROM username_cache WHERE uuid = ?`)
        .get(uuid) as { username?: string | null; fetched_at?: number } | undefined;
      const now = Date.now();
      if (cached?.fetched_at && now - cached.fetched_at < 24 * 60 * 60 * 1000) {
        return cached.username ?? null;
      }

      const r = await fetch(`https://api.ashcon.app/mojang/v2/user/${uuid}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(2500),
      });
      if (!r.ok) return null;
      const j = (await r.json()) as { username?: string; name?: string };
      const name = j.username || j.name || null;
      db.prepare(
        `INSERT INTO username_cache(uuid, username, fetched_at)
         VALUES(?,?,?)
         ON CONFLICT(uuid) DO UPDATE SET username=excluded.username, fetched_at=excluded.fetched_at`
      ).run(uuid, name, now);
      return name;
    }

    const r = await fetch(`https://api.ashcon.app/mojang/v2/user/${uuid}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2500),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { username?: string; name?: string };
    return j.username || j.name || null;
  } catch {
    return null;
  }
}

function addNonExoticFilters(
  where: string[],
  args: unknown[],
  includeFairy: boolean,
  includeCrystal: boolean
) {
  if (!includeFairy) {
    where.push(`UPPER(COALESCE(color,'')) NOT IN (${FAIRY_HEXES.map(() => "?").join(",")})`);
    args.push(...FAIRY_HEXES);
  }
  if (!includeCrystal) {
    where.push(`UPPER(COALESCE(color,'')) NOT IN (${CRYSTAL_HEXES.map(() => "?").join(",")})`);
    args.push(...CRYSTAL_HEXES);
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const qRaw = (searchParams.get("q") || "").trim();
    const colorRaw = (searchParams.get("color") || "").trim();
    const uuidQ = (searchParams.get("uuid") || "").trim();
    const uuidsParam = (searchParams.get("uuids") || "").trim();
    const piece = (searchParams.get("piece") || "all").toLowerCase();
    const includeFairy = searchParams.get("includeFairy") === "1";
    const includeCrystal = searchParams.get("includeCrystal") === "1";

    const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "24", 10) || 24, 1), 100);
    const page = Math.max(parseInt(searchParams.get("page") || "1", 10) || 1, 1);
    const offset = (page - 1) * limit;
    const tolerance = Math.max(0, Math.min(405, parseInt(searchParams.get("tolerance") || "0", 10) || 0));
    const hex = normalizeHexForLookup(colorRaw);

    if (colorRaw && !hex) {
      return NextResponse.json(
        { ok: false, error: "Enter a valid 6-digit hex colour, for example 191919 or #191919." },
        { status: 400 }
      );
    }

    const where: string[] = [];
    const args: unknown[] = [];

    if (uuidsParam) {
      const list = uuidsParam.split(",").map((s) => s.trim()).filter(Boolean);
      if (list.length) {
        where.push(`uuid IN (${list.map(() => "?").join(",")})`);
        args.push(...list);
      } else {
        where.push("1=0");
      }
    } else {
      if (uuidQ) {
        where.push("uuid = ?");
        args.push(uuidQ);
      }
      if (qRaw) {
        where.push("LOWER(name) LIKE LOWER(?)");
        args.push(`%${qRaw.replace(/\*/g, "%")}%`);
      }
      if (["helmet", "chestplate", "leggings", "boots"].includes(piece)) {
        const map: Record<string, string[]> = {
          helmet: ["helmet", "helm"],
          chestplate: ["chestplate", "chest", "tunic"],
          leggings: ["leggings", "legging", "pants"],
          boots: ["boots", "boot", "shoe"],
        };
        const terms = map[piece];
        where.push(`(${terms.map(() => "LOWER(name) LIKE ?").join(" OR ")})`);
        args.push(...terms.map((t) => `%${t}%`));
      }
    }

    addNonExoticFilters(where, args, includeFairy, includeCrystal);

    if (hex) {
      if (tolerance === 0) {
        where.push("UPPER(color) = ?");
        args.push(hex);
      } else {
        where.push("nibble_distance(color, ?) <= ?");
        args.push(hex, tolerance);
      }
    }

    const whereSQL = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const countRow = db
      .prepare(`SELECT COUNT(*) AS c FROM items ${whereSQL}`)
      .get(...args) as { c: number };

    const orderSQL = hex && tolerance > 0
      ? "ORDER BY nibble_distance(color, ?) ASC, name COLLATE NOCASE ASC"
      : "ORDER BY name COLLATE NOCASE ASC";
    const orderArgs = hex && tolerance > 0 ? [hex] : [];

    const rows = db
      .prepare(
        `SELECT id, uuid, name, color, rarity, price, extra
         FROM items
         ${whereSQL}
         ${orderSQL}
         LIMIT ? OFFSET ?`
      )
      .all(...args, ...orderArgs, limit, offset) as Row[];

    const out = await decorate(rows);
    const total = countRow?.c ?? 0;
    const totalPages = total ? Math.ceil(total / limit) : 0;

    return NextResponse.json({
      ok: true,
      page,
      limit,
      total,
      totalPages,
      items: out,
      targetHex: hex,
      tolerance,
      filters: { includeFairy, includeCrystal },
    });
  } catch (err) {
    console.error("/api/search failed:", err);
    const message = process.env.NODE_ENV === "development" && err instanceof Error
      ? err.message
      : "The search service could not read the database. Check the deployment logs if this persists.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

async function decorate(rows: Row[]): Promise<Out[]> {
  const owners = new Set<string>();
  const out: Out[] = rows.map((r) => {
    let ownerUuid: string | null = null;
    let reforge: string | null = null;
    try {
      const extra = r.extra ? JSON.parse(r.extra) : null;
      ownerUuid = extra?.owner_playerUuid || extra?.owner?.playerUuid || null;
      reforge = extra?.reforge || null;
    } catch {
      // Keep the item even when legacy metadata is malformed.
    }

    if (ownerUuid) owners.add(ownerUuid);
    const ownerUuidFlat = ownerUuid ? ownerUuid.replace(/-/g, "") : null;
    const hexType = getNonExoticHexType(r.color);

    return {
      id: r.id,
      uuid: r.uuid,
      name: r.name,
      color: r.color,
      rarity: r.rarity ?? null,
      price: r.price ?? null,
      reforge: titleCase(reforge),
      ownerUuid,
      ownerUsername: null,
      ownerAvatarUrl: ownerUuid ? avatarUrl(ownerUuid, 20) : null,
      ownerMcuuidUrl: ownerUuid ? `https://mcuuid.net/?q=${ownerUuidFlat}` : null,
      ownerPlanckeUrl: null,
      ownerSkyCryptUrl: ownerUuid ? `https://sky.shiiyu.moe/stats/${ownerUuidFlat}` : null,
      hexType,
      isExotic: hexType === null,
    };
  });

  // Username lookup is decorative. Keep it bounded so a slow third-party API
  // can never block the whole search result set for long.
  const toResolve = Array.from(owners).slice(0, 12);
  const nameMap = new Map<string, string | null>();
  await Promise.all(toResolve.map(async (u) => nameMap.set(u, await resolveUsername(u))));

  for (const it of out) {
    if (it.ownerUuid && nameMap.has(it.ownerUuid)) {
      it.ownerUsername = nameMap.get(it.ownerUuid) || null;
      if (it.ownerUsername) {
        it.ownerPlanckeUrl = `https://plancke.io/hypixel/player/stats/${it.ownerUsername}`;
      }
    }
  }

  return out;
}
