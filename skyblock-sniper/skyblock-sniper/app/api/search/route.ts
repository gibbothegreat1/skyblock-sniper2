import { NextResponse } from "next/server";
import { db } from "../../../lib/db";

export const runtime = "nodejs";

const IS_PROD = process.env.NODE_ENV === "production";
const IS_VERCEL = !!process.env.VERCEL;
const CAN_WRITE = !(IS_PROD && IS_VERCEL);

/* ---------- helpers ---------- */
function normalizeHex(input?: string | null): string | null {
  if (!input) return null;
  let s = String(input).trim();
  if (s.startsWith("#")) s = s.slice(1);
  if (/^[0-9A-Fa-f]{3}$/.test(s)) s = s.split("").map((c) => c + c).join("");
  if (!/^[0-9A-Fa-f]{6}$/.test(s)) return null;
  return `#${s.toUpperCase()}`;
}
function titleCase(s?: string | null) {
  if (!s) return "Clean";
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}
function avatarUrl(uuidMaybeDashed?: string | null, size = 20) {
  if (!uuidMaybeDashed) return null;
  return `https://crafatar.com/avatars/${uuidMaybeDashed.replace(/-/g, "")}?size=${size}&overlay`;
}

// XxXxXx weights per nibble (RRGGBB, 6 nibbles)
const NIBBLE_WEIGHTS = [8, 1, 8, 1, 8, 1];

// distance between two #RRGGBB strings using your rule
function nibbleDistance(aHex: string, bHex: string): number {
  const a = aHex.slice(1).toUpperCase();
  const b = bHex.slice(1).toUpperCase();
  let total = 0;
  for (let i = 0; i < 6; i++) {
    const ai = parseInt(a[i], 16);
    const bi = parseInt(b[i], 16);
    total += NIBBLE_WEIGHTS[i] * Math.abs(ai - bi);
  }
  return total;
}

/* ---------- types ---------- */
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
};

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

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const qRaw = (searchParams.get("q") || "").trim();
    const color = (searchParams.get("color") || "").trim();
    const uuidQ = (searchParams.get("uuid") || "").trim();
    const uuidsParam = (searchParams.get("uuids") || "").trim();
    const piece = (searchParams.get("piece") || "all").toLowerCase();
    const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "50", 10) || 50, 1), 200);
    const page = Math.max(parseInt(searchParams.get("page") || "1", 10) || 1, 1);
    const offset = (page - 1) * limit;

    // NEW: tolerance (0..405); 0 = exact only
    const tol = Math.max(0, Math.min(405, parseInt(searchParams.get("tolerance") || "0", 10) || 0));

    const hex = normalizeHex(color);
    const hexNoHash = hex ? hex.slice(1) : null;

    // Build WHERE for *non-color* filters first
    const where: string[] = [];
    const args: any[] = [];

    if (uuidsParam) {
      const list = uuidsParam.split(",").map((s) => s.trim()).filter(Boolean);
      if (list.length) {
        const qs = list.map(() => "?").join(",");
        where.push(`uuid IN (${qs})`);
        args.push(...list);
      } else {
        where.push("1=0");
      }
    } else {
      if (uuidQ) { where.push(`uuid = ?`); args.push(uuidQ); }
      if (qRaw)   { where.push(`name LIKE ?`); args.push(`%${qRaw.replace(/\*/g, "%")}%`); }
      if (["helmet","chestplate","leggings","boots"].includes(piece)) {
        const map: Record<string,string[]> = {
          helmet:["helmet","helm"], chestplate:["chest"], leggings:["legging","pants"], boots:["boot","shoe"]
        };
        const terms = map[piece];
        where.push("(" + terms.map(()=>`LOWER(name) LIKE ?`).join(" OR ") + ")");
        args.push(...terms.map(t=>`%${t}%`));
      }
    }

    const whereSQL = where.length ? `WHERE ${where.join(" AND ")}` : "";

    // If no color provided OR tolerance = 0 → use SQL color filter for exact match
    if (hex && tol === 0) {
      const countRow = db
        .prepare(
          `SELECT COUNT(*) AS c FROM items
           ${whereSQL ? whereSQL + " AND" : "WHERE"} UPPER(REPLACE(COALESCE(color,''), '#','')) = ?`
        )
        .get(...args, hexNoHash!.toUpperCase()) as { c: number };
      const rows = db
        .prepare(
          `SELECT id, uuid, name, color, rarity, price, extra
           FROM items
           ${whereSQL ? whereSQL + " AND" : "WHERE"} UPPER(REPLACE(COALESCE(color,''), '#','')) = ?
           ORDER BY name
           LIMIT ? OFFSET ?`
        )
        .all(...args, hexNoHash!.toUpperCase(), limit, offset) as Row[];

      const out = await decorate(rows);
      const total = countRow?.c ?? 0;
      const totalPages = total ? Math.max(1, Math.ceil(total / limit)) : 0;
      return NextResponse.json({ ok: true, page, limit, total, totalPages, items: out, targetHex: hex, tolerance: tol });
    }

    // Otherwise: pull the base set by non-color filters, then rank by nibble distance
    const baseRows = db
      .prepare(
        `SELECT id, uuid, name, color, rarity, price, extra
         FROM items
         ${whereSQL}
         ORDER BY name`
      )
      .all(...args) as Row[];

    let exact: Row[] = [];
    let near: Array<{ row: Row; dist: number }> = [];

    if (hex) {
      for (const r of baseRows) {
        const c = normalizeHex(r.color || null);
        if (!c) continue;
        if (c === hex) {
          exact.push(r);
        } else {
          const d = nibbleDistance(c, hex);
          if (d <= tol) near.push({ row: r, dist: d });
        }
      }
    } else {
      // no color filter at all → everything is "exact" (just respect other filters)
      exact = baseRows;
    }

    // Sort: exact (name asc) first, then near (distance asc, then name)
    exact.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    near.sort((a, b) => (a.dist - b.dist) || String(a.row.name).localeCompare(String(b.row.name)));

    const ranked = hex ? [...exact, ...near.map((x) => x.row)] : exact;
    const total = ranked.length;
    const totalPages = total ? Math.max(1, Math.ceil(total / limit)) : 0;
    const pageRows = ranked.slice(offset, offset + limit);

    const out = await decorate(pageRows);

    return NextResponse.json({
      ok: true,
      page,
      limit,
      total,
      totalPages,
      items: out,
      targetHex: hex || null,
      tolerance: tol,
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: "Internal Server Error" }, { status: 500 });
  }
}

/* ---------- decorate rows (owner, reforge, links, usernames) ---------- */
async function decorate(rows: Row[]): Promise<Out[]> {
  const owners = new Set<string>();
  const out: Out[] = rows.map((r) => {
    let ownerUuid: string | null = null;
    let reforge: string | null = null;
    try {
      const extra = r.extra ? JSON.parse(r.extra) : null;
      ownerUuid = extra?.owner_playerUuid || extra?.owner?.playerUuid || null;
      reforge = extra?.reforge || null;
    } catch {}
    if (ownerUuid) owners.add(ownerUuid);
    const ownerUuidFlat = ownerUuid ? ownerUuid.replace(/-/g, "") : null;

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
    };
  });

  const toResolve = Array.from(owners).slice(0, 50);
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
