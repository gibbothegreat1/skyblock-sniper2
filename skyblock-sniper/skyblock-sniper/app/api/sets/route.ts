import { NextResponse } from "next/server";

/**
 * Types that match the front-end.
 */
type PieceOut = { uuid: string; name: string; hex?: string | null } | null;

type SetItemOut = {
  setLabel: string;
  color: string;
  rarity: string | null;
  ownerUuid: string | null;
  ownerUsername: string | null;
  ownerAvatarUrl: string | null;
  ownerMcuuidUrl: string | null;
  ownerPlanckeUrl: string | null;
  ownerSkyCryptUrl: string | null;
  isExact?: boolean;
  avgDist?: number;
  pieces: {
    helmet: PieceOut;
    chestplate: PieceOut;
    leggings: PieceOut;
    boots: PieceOut;
  };
};

type ApiResp = {
  ok: boolean;
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  items: SetItemOut[];
  targetHex?: string;
  tolerance?: number;
  requiresHelmet?: boolean;
  error?: string;
};

/**
 * Minimal interface for whatever your data layer returns.
 * Replace this with your actual schema or adapters.
 */
type RawPiece = {
  uuid: string;
  name: string;
  // if your store already has a hex, great; otherwise you can compute it
  hex?: string | null;
  color?: string | null; // fallback field name some stores use
};

type RawSet = {
  setLabel: string;
  // aggregate/representative color for the set
  color: string;
  rarity: string | null;
  ownerUuid: string | null;
  ownerUsername: string | null;
  ownerAvatarUrl: string | null;
  ownerMcuuidUrl: string | null;
  ownerPlanckeUrl: string | null;
  ownerSkyCryptUrl: string | null;
  isExact?: boolean;
  avgDist?: number;
  pieces: {
    helmet?: RawPiece | null;
    chestplate?: RawPiece | null;
    leggings?: RawPiece | null;
    boots?: RawPiece | null;
  };
};

/**
 * Plug your real data fetch here.
 * It should apply filters: color (target hex), q (set name), tolerance, page, limit.
 */
async function fetchSetsFromYourStore(params: {
  color?: string;
  q?: string;
  tolerance?: number;
  page: number;
  limit: number;
}): Promise<{ total: number; items: RawSet[] }> {
  // TODO: Replace with your actual DB/query implementation.
  // This stub returns nothing; it's here to show how mapping works.
  return { total: 0, items: [] };
}

// normalize to #rrggbb lowercase
function normalizeHex(h?: string | null): string | null {
  if (!h) return null;
  const clean = h.trim().replace(/^#/, "");
  if (!clean) return null;
  if (clean.length === 3) {
    const c = clean.split("").map((ch) => ch + ch).join("");
    return `#${c.toLowerCase()}`;
  }
  if (clean.length === 6) return `#${clean.toLowerCase()}`;
  return `#${clean.toLowerCase()}`;
}

function mapPiece(p?: RawPiece | null): PieceOut {
  if (!p) return null;
  return {
    uuid: p.uuid,
    name: p.name,
    hex: normalizeHex(p.hex ?? p.color ?? null),
  };
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.max(1, Math.min(100, parseInt(searchParams.get("limit") || "24", 10)));

    const rawColor = searchParams.get("color") || undefined;
    const q = searchParams.get("q") || undefined;
    const tolStr = searchParams.get("tolerance");
    const tolerance = tolStr ? Math.max(0, parseInt(tolStr, 10)) : undefined;

    if (!rawColor || !q) {
      const empty: ApiResp = {
        ok: true,
        page,
        limit,
        total: 0,
        totalPages: 0,
        items: [],
        targetHex: normalizeHex(rawColor || ""),
        tolerance,
      };
      return NextResponse.json(empty, { status: 200 });
    }

    const targetHex = normalizeHex(rawColor);

    const { total, items } = await fetchSetsFromYourStore({
      color: targetHex || undefined,
      q,
      tolerance,
      page,
      limit,
    });

    const totalPages = total > 0 ? Math.ceil(total / limit) : 0;

    const mapped: SetItemOut[] = (items || []).map((s) => ({
      setLabel: s.setLabel,
      color: normalizeHex(s.color) || s.color || "#000000",
      rarity: s.rarity ?? null,
      ownerUuid: s.ownerUuid ?? null,
      ownerUsername: s.ownerUsername ?? null,
      ownerAvatarUrl: s.ownerAvatarUrl ?? null,
      ownerMcuuidUrl: s.ownerMcuuidUrl ?? null,
      ownerPlanckeUrl: s.ownerPlanckeUrl ?? null,
      ownerSkyCryptUrl: s.ownerSkyCryptUrl ?? null,
      isExact: s.isExact,
      avgDist: s.avgDist,
      pieces: {
        helmet: mapPiece(s.pieces?.helmet ?? null),
        chestplate: mapPiece(s.pieces?.chestplate ?? null),
        leggings: mapPiece(s.pieces?.leggings ?? null),
        boots: mapPiece(s.pieces?.boots ?? null),
      },
    }));

    const resp: ApiResp = {
      ok: true,
      page,
      limit,
      total,
      totalPages,
      items: mapped,
      targetHex: targetHex || undefined,
      tolerance,
    };

    return NextResponse.json(resp, { status: 200 });
  } catch (e: any) {
    const errResp: ApiResp = {
      ok: false,
      page: 1,
      limit: 24,
      total: 0,
      totalPages: 0,
      items: [],
      error: e?.message || "Unexpected error",
    };
    return NextResponse.json(errResp, { status: 500 });
  }
}
