import { NextResponse } from "next/server";
import { normalizeColorHex } from "../../../lib/colorDistance";

export const runtime = "nodejs";
export const maxDuration = 30;

type Target = { uuid?: string | null; name?: string | null; color?: string | null };

const REFORGES = new Set([
  "ancient","bizarre","clean","fierce","forceful","godly","heavy","hurtful","light","loving","mythic",
  "necrotic","pleasant","pure","reinforced","renowned","ridiculous","smart","spiked","strong","superior",
  "titanic","unpleasant","very","wise","zealous"
]);

function canonicalNameCandidates(input?: string | null) {
  const words = String(input || "")
    .replace(/§[0-9a-fk-or]/gi, "")
    .replace(/[_-]+/g, " ")
    .replace(/[^a-zA-Z0-9 ]+/g, " ")
    .toLowerCase().split(/\s+/).filter(Boolean);
  const candidates = new Set<string>();
  if (words.length) candidates.add(words.join(" "));
  // Legacy dumps often prepend a reforge to the actual item name. Keep the
  // full name as the strongest match, then try one stripped prefix as fallback.
  if (words.length > 2 && REFORGES.has(words[0])) candidates.add(words.slice(1).join(" "));
  if (words.length > 3 && words[0] === "very" && words[1] === "wise") candidates.add(words.slice(2).join(" "));
  return Array.from(candidates).sort((a, b) => b.length - a.length);
}

function htmlPlain(raw: string) {
  return raw
    .replace(/\\u0023/gi, "#")
    .replace(/\\u003c/gi, "<")
    .replace(/\\u003e/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#x27;|&#39;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/<[^>]*>/g, " ")
    .replace(/\\n|\\r|\\t/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
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
    const j = await r.json() as { username?: string; name?: string };
    return j.username || j.name || null;
  } catch { return null; }
}

function targetFound(raw: string, plain: string, target: Target) {
  const hex = normalizeColorHex(target.color || null)?.toLowerCase() || null;
  const names = canonicalNameCandidates(target.name);
  const uuid = String(target.uuid || "").toLowerCase();

  // Strongest signal: item UUID appears in the page payload.
  if (uuid && uuid.length >= 16 && raw.toLowerCase().includes(uuid)) return true;
  if (!names.length) return false;

  const variants = names.flatMap((name) => [name, name.replace(/ /g, "_"), name.replace(/ /g, "-")]);
  for (const variant of variants) {
    let from = 0;
    while (true) {
      const idx = plain.indexOf(variant, from);
      if (idx < 0) break;
      if (!hex) return true;
      const start = Math.max(0, idx - 1200);
      const end = Math.min(plain.length, idx + variant.length + 1200);
      const window = plain.slice(start, end);
      if (window.includes(hex)) return true;
      from = idx + variant.length;
    }
  }
  return false;
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as { ign?: string | null; ownerUuid?: string | null; targets?: Target[] };
    const targets = Array.isArray(body.targets) ? body.targets.filter((t) => t?.name) : [];
    if (!targets.length) return NextResponse.json({ status: "api_off", detail: "No armour target supplied." }, { status: 400 });

    const ign = (body.ign || "").trim() || await resolveIgn(body.ownerUuid);
    if (!ign) return NextResponse.json({ status: "api_off", detail: "Could not resolve the player's IGN." });

    const url = `https://exotico.flori.tv/?player=${encodeURIComponent(ign)}`;
    let response: Response;
    try {
      response = await fetch(url, {
        cache: "no-store",
        headers: {
          "user-agent": "Mozilla/5.0 (compatible; GibboExoticsChecker/1.0)",
          accept: "text/html,application/xhtml+xml",
        },
        signal: AbortSignal.timeout(12000),
      });
    } catch {
      return NextResponse.json({ status: "api_off", detail: "Exotico could not be reached. Check manually." });
    }

    if (!response.ok) {
      return NextResponse.json({ status: "api_off", detail: `Exotico returned HTTP ${response.status}. Check manually.` });
    }
    const raw = await response.text();
    const plain = htmlPlain(raw);
    if (raw.length < 500 || /api\s*(is\s*)?(off|down)|failed to fetch|internal server error|application error/.test(plain)) {
      return NextResponse.json({ status: "api_off", detail: "Exotico/API appears unavailable. Check manually." });
    }

    const matches = targets.map((t) => targetFound(raw, plain, t));
    const allFound = matches.every(Boolean);
    if (allFound) {
      return NextResponse.json({ status: "still_has", detail: `${ign}: ${targets.length === 1 ? "matching piece is" : "all matching pieces are"} still visible in Exotico.`, matches });
    }

    // Be conservative if Exotico served only its app shell (or changed its data
    // format). In that case we cannot distinguish "missing" from "not loaded",
    // so return API-off/manual-check instead of a false snipe result.
    const dataLike = /(helmet|chestplate|leggings|boots)[\s\S]{0,700}#[0-9a-f]{6}|#[0-9a-f]{6}[\s\S]{0,700}(helmet|chestplate|leggings|boots)/i.test(raw);
    if (!dataLike) {
      return NextResponse.json({ status: "api_off", detail: "Exotico loaded, but its exotic item data could not be verified automatically. Check manually.", matches });
    }

    return NextResponse.json({ status: "missing", detail: `${ign}: ${matches.filter(Boolean).length}/${matches.length} requested pieces matched.`, matches });
  } catch {
    return NextResponse.json({ status: "api_off", detail: "Checker failed. Check Exotico manually." });
  }
}
