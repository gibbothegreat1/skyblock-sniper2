import { NextResponse } from "next/server";

/**
 * Output types (align with the frontend)
 */
type PieceOut = { uuid: string; name: string; hex?: string | null } | null;

type SetItemOut = {
  setLabel: string;
  color: string; // normalized hex for the set's representative color if available
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
  targetHex?: string;        // must be string | undefined, not null
  tolerance?: number;
  requiresHelmet?: boolean;
  error?: string;
};

/**
 * Minimal raw data interfaces you can adapt to your DB layer.
 * If your schema differs, just adjust the mapper calls below.
 */
type RawPiece = {
  uuid: string;
  name: string;
  hex?: string | null;   // preferred per-item hex if available
  color?: string | null; // fallback field name some stores use
} | null;

type RawSet = {
  setLabel: string;
  color: string; // set representative color (can be hex)
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
    helmet?: RawPiece;
    chestplate?: RawPiece;
    leggings?: RawPiece;
    boots?: RawPiece;
  };
};

/**
 * Replace this with your actual DB/query implementation.
 * It should honor color (hex), q (set name), tolerance, page, and limit.
 */
async function fetchSetsFromYourStore(params: {
  color?: string;
  q?: string;
  tolerance?: number;
  page: number;
  limit: number;
}): Promise<{ total: number; items: RawSet[] }> {
  // TODO: hook up your real data access.
  return { total: 0, items: [] };
}

/** Normalize input hex to "#rrggbb" (lowercase). Returns null if not parseable. */
function normalizeHex(h?: string | null): string | null {
  if (!h) return null;
  const clean = h.trim().replace(/^#/, "");
  if (!clean) return null;
  if (clean.length === 3) {
    const x = clean.split("").map((ch) => ch + ch).join("");
    return `#${x.toLowerCase()}`;
  }
  if (clean.length === 6) return `#${clean.toLowerCase()}`;
  return `#${clean.toLowerCase()}`; // permissive fallback
}

/** Map a single raw piece to the output, including normalized hex. */
function mapPiece(p?: RawPiece): PieceOut {
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

    const rawColor = searchParams.get("color") || undefined; // incoming hex (may be "191919" or "#191919")
    const q = searchParams.get("q") || undefined;            // set name query
    const tolStr = searchParams.get("tolerance");
    const tolerance = tolStr ? Math.max(0, parseInt(tolStr, 10)) : undefined;

    // If required inputs missing, return an empty OK payload
    if (!rawColor || !q) {
      const empty: ApiResp = {
        ok: true,
        page,
        limit,
        total: 0,
        totalPages: 0,
        items: [],
        targetHex: normalizeHex(rawColor || "") || undefined, // coalesce null → undefined to satisfy type
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
        helmet: mapPiece(s.pieces?.helmet),
        chestplate: mapPiece(s.pieces?.chestplate),
        leggings: mapPiece(s.pieces?.leggings),
        boots: mapPiece(s.pieces?.boots),
      },
    }));

    const resp: ApiResp = {
      ok: true,
      page,
      limit,
      total,
      totalPages,
      items: mapped,
      targetHex: targetHex || undefined, // string | undefined
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
