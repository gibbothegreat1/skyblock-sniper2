import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Target = {
  uuid?: string | null;
  name?: string | null;
  color?: string | null;
};

type ExoticoItem = {
  id?: string | null;
  name?: string | null;
  color?: string | null;
  variant?: string | null;
  profile?: string | null;
  profileName?: string | null;
  location?: string | null;
  armorType?: string | null;
  category?: string | null;
};

type ExoticoProfile = {
  name?: string | null;
  exoticItems?: ExoticoItem[] | null;
};

type ExoticoResponse = {
  profiles?: ExoticoProfile[] | null;
  items?: Array<Record<string, unknown>> | null;
  cached?: boolean;
  fetchTime?: number;
  timestamp?: number;
};

const REFORGES = new Set([
  "ancient", "bizarre", "clean", "fierce", "forceful", "godly", "heavy", "hurtful", "light",
  "loving", "mythic", "necrotic", "pleasant", "pure", "reinforced", "renowned", "ridiculous",
  "smart", "spiked", "strong", "superior", "titanic", "unpleasant", "very", "wise", "zealous",
]);

const ITEM_ID_ALIASES: Record<string, string[]> = {
  STEREO_PANTS: ["MUSIC_PANTS"],
  MUSIC_PANTS: ["STEREO_PANTS"],
  LEAFLET_BOOTS: ["LEAFLET_SANDALS"],
  LEAFLET_CHESTPLATE: ["LEAFLET_TUNIC"],
  LEAFLET_LEGGINGS: ["LEAFLET_PANTS"],
};

function normalizeHex(input?: string | null): string | null {
  if (!input) return null;
  const s = String(input).trim().replace(/^#/, "").toUpperCase();
  return /^[0-9A-F]{6}$/.test(s) ? s : null;
}

function stripFormatting(input: string) {
  return input.replace(/§[0-9A-FK-OR]/gi, "").trim();
}

function wordsToItemId(words: string[]) {
  return words
    .join(" ")
    .replace(/[’']/g, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_")
    .toUpperCase();
}

function targetItemIdCandidates(input?: string | null): string[] {
  if (!input) return [];

  const originalWords = stripFormatting(String(input))
    .replace(/[_-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  const candidates = new Set<string>();
  const add = (words: string[]) => {
    if (!words.length) return;
    const id = wordsToItemId(words);
    if (!id) return;
    candidates.add(id);
    for (const alias of ITEM_ID_ALIASES[id] || []) candidates.add(alias);
  };

  add(originalWords);

  const lower = originalWords.map((w) => w.toLowerCase());
  if (lower.length > 1 && REFORGES.has(lower[0])) add(originalWords.slice(1));
  if (lower.length > 2 && lower[0] === "very" && lower[1] === "wise") add(originalWords.slice(2));

  return Array.from(candidates);
}

async function resolveIgn(ownerUuid?: string | null) {
  if (!ownerUuid) return null;
  const uuid = ownerUuid.replace(/-/g, "");
  try {
    const r = await fetch(`https://api.ashcon.app/mojang/v2/user/${uuid}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { username?: string; name?: string };
    return j.username || j.name || null;
  } catch {
    return null;
  }
}

type CachedApi = { data: ExoticoResponse; loadedAt: number };
const globalCache = globalThis as typeof globalThis & {
  __exoticoApiCache?: Map<string, CachedApi>;
};
const apiCache = globalCache.__exoticoApiCache || new Map<string, CachedApi>();
globalCache.__exoticoApiCache = apiCache;
const CACHE_MS = 60_000;

async function fetchExotico(ign: string): Promise<ExoticoResponse> {
  const key = ign.toLowerCase();
  const cached = apiCache.get(key);
  if (cached && Date.now() - cached.loadedAt < CACHE_MS) return cached.data;

  const token = (process.env.EXOTICO_LOAD_TOKEN || "").trim();
  const headers: Record<string, string> = {
    accept: "application/json, text/plain, */*",
    referer: `https://exotico.flori.tv/?player=${encodeURIComponent(ign)}`,
    "user-agent": "Mozilla/5.0 (compatible; SkyblockSniper/1.0)",
  };
  if (token) headers["x-load-token"] = token;

  const url = `https://exotico.flori.tv/api/exotic-items?playername=${encodeURIComponent(ign)}&limit=10000`;
  const response = await fetch(url, {
    method: "GET",
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const snippet = body.replace(/\s+/g, " ").slice(0, 180);
    const err = new Error(`Exotico API returned HTTP ${response.status}${snippet ? `: ${snippet}` : ""}`);
    (err as Error & { status?: number }).status = response.status;
    throw err;
  }

  const data = (await response.json()) as ExoticoResponse;
  if (!data || !Array.isArray(data.profiles)) {
    throw new Error("Exotico returned an unexpected response shape.");
  }

  apiCache.set(key, { data, loadedAt: Date.now() });
  return data;
}

function allExoticItems(data: ExoticoResponse): ExoticoItem[] {
  const out: ExoticoItem[] = [];
  for (const profile of data.profiles || []) {
    for (const item of profile.exoticItems || []) {
      if (item && typeof item === "object") out.push(item);
    }
  }
  return out;
}

function matchTarget(items: ExoticoItem[], target: Target) {
  const targetColor = normalizeHex(target.color);
  const ids = targetItemIdCandidates(target.name);
  if (!targetColor || ids.length === 0) return null;

  const found = items.find((item) => {
    const itemId = String(item.name || "").trim().toUpperCase();
    const itemColor = normalizeHex(item.color);
    return ids.includes(itemId) && itemColor === targetColor;
  });

  return found || null;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      ign?: string | null;
      ownerUuid?: string | null;
      targets?: Target[];
    };

    const targets = Array.isArray(body.targets)
      ? body.targets.filter((t) => t?.name && normalizeHex(t?.color))
      : [];

    if (!targets.length) {
      return NextResponse.json(
        { status: "api_off", detail: "No valid armour target and hex were supplied." },
        { status: 400 }
      );
    }

    const ign = (body.ign || "").trim() || (await resolveIgn(body.ownerUuid));
    if (!ign) {
      return NextResponse.json({
        status: "api_off",
        detail: "Could not resolve the player's IGN.",
      });
    }

    let data: ExoticoResponse;
    try {
      data = await fetchExotico(ign);
    } catch (err) {
      console.error("Exotico API check failed", err);
      const message = err instanceof Error ? err.message : "Unknown Exotico API error";
      const status = (err as Error & { status?: number })?.status;

      if ((status === 401 || status === 403) && !process.env.EXOTICO_LOAD_TOKEN) {
        return NextResponse.json({
          status: "api_off",
          detail: "Exotico requires its load token. Add EXOTICO_LOAD_TOKEN in Vercel Environment Variables, then redeploy.",
        });
      }

      if (status === 401 || status === 403) {
        return NextResponse.json({
          status: "api_off",
          detail: "Exotico rejected the configured load token. Refresh Exotico in your browser, copy the current x-load-token value, update EXOTICO_LOAD_TOKEN in Vercel, and redeploy.",
        });
      }

      return NextResponse.json({
        status: "api_off",
        detail: `Exotico API could not be read (${message}).`,
      });
    }

    const items = allExoticItems(data);
    const matchedItems = targets.map((target) => matchTarget(items, target));
    const matches = matchedItems.map(Boolean);
    const allFound = matches.every(Boolean);

    if (allFound) {
      return NextResponse.json({
        status: "still_has",
        detail: `${ign}: ${targets.length === 1 ? "matching piece is" : "all matching pieces are"} still on Exotico.`,
        matches,
        matchedItems: matchedItems.map((item) => item
          ? {
              id: item.id || null,
              name: item.name || null,
              color: item.color || null,
              variant: item.variant || null,
              profile: item.profileName || item.profile || null,
              location: item.location || null,
            }
          : null),
      });
    }

    return NextResponse.json({
      status: "missing",
      detail: `${ign}: ${matches.filter(Boolean).length}/${matches.length} requested pieces matched on Exotico.`,
      matches,
      missing: targets
        .map((target, i) => ({ target, found: matches[i] }))
        .filter((x) => !x.found)
        .map((x) => ({
          name: x.target.name || null,
          color: normalizeHex(x.target.color),
          itemIdCandidates: targetItemIdCandidates(x.target.name),
        })),
    });
  } catch (err) {
    console.error("check-exotico route failed", err);
    return NextResponse.json({
      status: "api_off",
      detail: "Checker failed before the Exotico comparison completed.",
    });
  }
}
