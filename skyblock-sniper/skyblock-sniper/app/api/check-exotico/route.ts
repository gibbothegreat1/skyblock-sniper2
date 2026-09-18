import { NextResponse } from "next/server";
import { normalizeColorHex } from "../../../lib/colorDistance";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

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
  if (words.length > 2 && REFORGES.has(words[0])) candidates.add(words.slice(1).join(" "));
  if (words.length > 3 && words[0] === "very" && words[1] === "wise") candidates.add(words.slice(2).join(" "));
  return Array.from(candidates).sort((a, b) => b.length - a.length);
}

function compactText(s: string) {
  return s
    .replace(/§[0-9a-fk-or]/gi, "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
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

function targetFound(renderedText: string, target: Target) {
  const text = compactText(renderedText);
  const hex = normalizeColorHex(target.color || null)?.toLowerCase() || null;
  const names = canonicalNameCandidates(target.name);

  if (!names.length) return false;

  for (const name of names) {
    let from = 0;
    while (true) {
      const idx = text.indexOf(name, from);
      if (idx < 0) break;
      if (!hex) return true;
      // One Exotico item card is far smaller than this. Keeping the window
      // local prevents a hex from a different item on the page causing a hit.
      const start = Math.max(0, idx - 450);
      const end = Math.min(text.length, idx + name.length + 700);
      const window = text.slice(start, end);
      if (window.includes(hex)) return true;
      from = idx + name.length;
    }
  }
  return false;
}

type Snapshot = { text: string; url: string; title: string; loadedAt: number };
const globalCache = globalThis as typeof globalThis & { __exoticoSnapshots?: Map<string, Snapshot> };
const snapshotCache = globalCache.__exoticoSnapshots || new Map<string, Snapshot>();
globalCache.__exoticoSnapshots = snapshotCache;
const CACHE_MS = 60_000;

async function renderedExoticoPage(ign: string): Promise<Snapshot> {
  const key = ign.toLowerCase();
  const cached = snapshotCache.get(key);
  if (cached && Date.now() - cached.loadedAt < CACHE_MS) return cached;

  const chromiumMod = await import("@sparticuz/chromium");
  const puppeteerMod = await import("puppeteer-core");
  const chromium = chromiumMod.default;
  const puppeteer = puppeteerMod.default;

  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
  try {
    browser = await puppeteer.launch({
      args: [
        ...chromium.args,
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--disable-setuid-sandbox",
      ],
      defaultViewport: { width: 1600, height: 1100 },
      executablePath: await chromium.executablePath(),
      headless: true,
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    );
    await page.setExtraHTTPHeaders({
      "accept-language": "en-US,en;q=0.9",
    });

    const url = `https://exotico.flori.tv/?player=${encodeURIComponent(ign)}`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25_000 });

    // Exotico is client-rendered. The previous checker fetched raw HTML only,
    // so it never saw the exotic cards. Here we wait for the browser-rendered UI.
    await page.waitForFunction(() => {
      const t = document.body?.innerText || "";
      return /\bExotics\b/i.test(t) || /API\s*(error|off|down)/i.test(t);
    }, { timeout: 12_000 }).catch(() => undefined);

    // If the player page did not land on Exotics, click its Exotics tab.
    await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll("a,button,[role='tab']"));
      const hit = nodes.find((el) => (el.textContent || "").trim().toLowerCase() === "exotics");
      if (hit instanceof HTMLElement) hit.click();
    }).catch(() => undefined);

    await new Promise((resolve) => setTimeout(resolve, 2500));

    // Wait a little longer when the page is clearly loading a player collection.
    await page.waitForFunction(() => {
      const t = document.body?.innerText || "";
      return /\b\d+\s+items?\b/i.test(t)
        || /no\s+(exotics|items)/i.test(t)
        || /API\s*(error|off|down)/i.test(t)
        || /player\s+not\s+found/i.test(t);
    }, { timeout: 10_000 }).catch(() => undefined);

    const result = await page.evaluate(() => ({
      text: document.body?.innerText || "",
      url: location.href,
      title: document.title || "",
    }));

    const snap: Snapshot = { ...result, loadedAt: Date.now() };
    snapshotCache.set(key, snap);
    return snap;
  } finally {
    if (browser) await browser.close().catch(() => undefined);
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as { ign?: string | null; ownerUuid?: string | null; targets?: Target[] };
    const targets = Array.isArray(body.targets) ? body.targets.filter((t) => t?.name) : [];
    if (!targets.length) {
      return NextResponse.json({ status: "api_off", detail: "No armour target supplied." }, { status: 400 });
    }

    const ign = (body.ign || "").trim() || await resolveIgn(body.ownerUuid);
    if (!ign) return NextResponse.json({ status: "api_off", detail: "Could not resolve the player's IGN." });

    let snapshot: Snapshot;
    try {
      snapshot = await renderedExoticoPage(ign);
    } catch (err) {
      console.error("Exotico browser check failed", err);
      return NextResponse.json({
        status: "api_off",
        detail: "Could not render Exotico on the server. Use Open Exotico to check manually.",
      });
    }

    const text = snapshot.text;
    const plain = compactText(text);

    if (!plain || plain.length < 80) {
      return NextResponse.json({ status: "api_off", detail: "Exotico returned an empty page. Check manually." });
    }

    if (/api\s*(is\s*)?(off|down|error)|failed\s+to\s+fetch|internal\s+server\s+error|application\s+error/.test(plain)) {
      return NextResponse.json({ status: "api_off", detail: "Exotico/API appears unavailable. Check manually." });
    }

    if (/player\s+not\s+found|unknown\s+player/.test(plain)) {
      return NextResponse.json({ status: "api_off", detail: `${ign} could not be loaded on Exotico.` });
    }

    // A valid rendered player page should expose the Exotics tab plus either an
    // item count, exotic item names, or an explicit empty state.
    const looksLikePlayerPage = /\bexotics\b/.test(plain) && (
      /\b\d+\s+items?\b/.test(plain)
      || /(helmet|chestplate|leggings|boots)/.test(plain)
      || /no\s+(exotics|items)/.test(plain)
    );
    if (!looksLikePlayerPage) {
      return NextResponse.json({
        status: "api_off",
        detail: "Exotico opened, but the player's Exotics tab did not finish loading. Check manually.",
      });
    }

    const matches = targets.map((t) => targetFound(text, t));
    const allFound = matches.every(Boolean);

    if (allFound) {
      return NextResponse.json({
        status: "still_has",
        detail: `${ign}: ${targets.length === 1 ? "matching piece is" : "all matching pieces are"} still visible in Exotico.`,
        matches,
      });
    }

    return NextResponse.json({
      status: "missing",
      detail: `${ign}: ${matches.filter(Boolean).length}/${matches.length} requested pieces matched on Exotico.`,
      matches,
    });
  } catch (err) {
    console.error("check-exotico route failed", err);
    return NextResponse.json({ status: "api_off", detail: "Checker failed. Check Exotico manually." });
  }
}
