"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

/* =========================
   Types
   ========================= */
type PieceEntry = { uuid: string; name: string; color: string };
export type SetItem = {
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
    helmet: PieceEntry | null;
    chestplate: PieceEntry | null;
    leggings: PieceEntry | null;
    boots: PieceEntry | null;
  };
};
type ApiResp = {
  ok: boolean;
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  items: SetItem[];
  targetHex?: string;
  tolerance?: number;
  exactGroup?: boolean;
  requiresHelmet?: boolean;
  error?: string;
};

/* =========================
   Constants
   ========================= */
const MAX_TOL = 405;
const LS_SETS = "gibbo-fav-sets";

const ARMOUR_DIR = "/images/armor";
const ICONS_DIR = "/images/set-icons";

const PIECE_SIZE = 56;  // preview size for chest/legs/boots
const ICON_SCALE = 0.9; // helmet icon fraction of piece size

// Canvas recolor tuning
const V_GAIN = 0.06;  // lift deep shadows a touch (0..~0.15)
const GAMMA = 0.95;   // <1 brightens midtones slightly

const HIGHLIGHT_OPACITY = 0.12; // extra sheen (0..1)

/* =========================
   Color helpers
   ========================= */
function normHex(h?: string | null) {
  if (!h) return null;
  const x = h.trim().replace(/^#/, "");
  return /^[0-9a-fA-F]{6}$/.test(x) ? `#${x.toLowerCase()}` : null;
}
function hexToRgb(h: string) {
  const x = h.replace("#", "");
  const r = parseInt(x.slice(0, 2), 16);
  const g = parseInt(x.slice(2, 4), 16);
  const b = parseInt(x.slice(4, 6), 16);
  return [r, g, b] as [number, number, number];
}
function rgbToHex(r: number, g: number, b: number) {
  return (
    "#" +
    [r, g, b]
      .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0"))
      .join("")
  );
}
function rgbToHsv(r: number, g: number, b: number) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  const s = max === 0 ? 0 : d / max;
  const v = max;
  return [h, s, v] as [number, number, number];
}
function hsvToRgb(h: number, s: number, v: number) {
  let r = 0, g = 0, b = 0;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    case 5: r = v; g = p; b = q; break;
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)] as [number, number, number];
}

/* =========================
   Representative set color
   ========================= */
function hexToRgbMaybe(h?: string | null) {
  const n = normHex(h || "");
  return n ? hexToRgb(n) : null;
}
function computeSetDisplayHex(s: SetItem): string | null {
  const cols = [
    hexToRgbMaybe(s.pieces.helmet?.color),
    hexToRgbMaybe(s.pieces.chestplate?.color),
    hexToRgbMaybe(s.pieces.leggings?.color),
    hexToRgbMaybe(s.pieces.boots?.color),
  ].filter(Boolean) as [number, number, number][];
  if (!cols.length) return null;
  const sum = cols.reduce((acc, [r,g,b]) => [acc[0]+r, acc[1]+g, acc[2]+b], [0,0,0] as [number,number,number]);
  const avg: [number, number, number] = [sum[0]/cols.length, sum[1]/cols.length, sum[2]/cols.length];
  return rgbToHex(avg[0], avg[1], avg[2]);
}

function makeSetKey(s: SetItem) {
  return [
    s.ownerUuid || "?",
    s.setLabel || "?",
    s.pieces.helmet?.uuid || "",
    s.pieces.chestplate?.uuid || "",
    s.pieces.leggings?.uuid || "",
    s.pieces.boots?.uuid || "",
  ].join("|");
}
function inferDragonKey(setLabel: string): string | null {
  const m = setLabel.toLowerCase().match(/\b(superior|wise|unstable|strong|young|old|protector|holy)\b/);
  return m ? m[1] : null;
}

/* =========================
   Canvas recolor
   ========================= */
/**
 * Recolors a grayscale/tinted PNG (the *_tint.png) to the target hex.
 * - For COLOURED targets: hue+sat from target, value from source brightness (scaled by target value a bit).
 * - For GRAY targets (sat≈0): outRGB = targetRGB * sourceBrightness (component-wise), so it never washes to white.
 */
async function recolorSpriteToHex(
  tintUrl: string,
  hex: string,
  size: number
): Promise<string> {
  const img = await loadImage(tintUrl);
  const w = img.naturalWidth || size;
  const h = img.naturalHeight || size;

  const cnv = document.createElement("canvas");
  cnv.width = w; cnv.height = h;
  const ctx = cnv.getContext("2d", { willReadFrequently: true })!;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);

  const data = ctx.getImageData(0, 0, w, h);
  const buf = data.data;

  const [tr, tg, tb] = hexToRgb(hex);
  const [th, ts, tv] = rgbToHsv(tr, tg, tb); // tv ∈ [0..1]

  const grayTarget = ts < 0.001; // achromatic

  for (let i = 0; i < buf.length; i += 4) {
    const r = buf[i], g = buf[i+1], b = buf[i+2], a = buf[i+3];
    if (a === 0) continue; // transparent

    // Source brightness from the tint image (works for grayscale art)
    let v = Math.max(r, g, b) / 255;
    v = Math.pow(v, GAMMA) + V_GAIN; // gamma + small gain for deep shadows
    if (v > 1) v = 1;

    let nr: number, ng: number, nb: number;

    if (grayTarget) {
      // Shade toward the exact gray: component-wise multiply by brightness.
      nr = Math.round(tr * v);
      ng = Math.round(tg * v);
      nb = Math.round(tb * v);
    } else {
      // Keep target hue/sat, but scale value by both source v and target tv a bit.
      const vOut = Math.max(0, Math.min(1, v * (0.5 + tv * 0.5))); // blend between v and tv
      [nr, ng, nb] = hsvToRgb(th, ts, vOut);
    }

    buf[i] = nr; buf[i+1] = ng; buf[i+2] = nb; // keep alpha
  }

  ctx.putImageData(data, 0, 0);

  // Optional masked highlight for a little sheen
  if (HIGHLIGHT_OPACITY > 0) {
    ctx.globalCompositeOperation = "screen";
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, `rgba(255,255,255,${HIGHLIGHT_OPACITY})`);
    grad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "source-over";
  }

  return cnv.toDataURL("image/png");
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.decoding = "sync";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/* Cache per (url|hex|size) to avoid recomputation */
const recolorCache = new Map<string, string>();
async function getRecolored(url: string, hex: string, size: number) {
  const key = `${url}|${hex}|${size}|v2`; // bump key if algo changes
  const cached = recolorCache.get(key);
  if (cached) return cached;
  const dataUrl = await recolorSpriteToHex(url, hex, size);
  recolorCache.set(key, dataUrl);
  return dataUrl;
}

/* =========================
   Armour UI
   ========================= */
function HelmetIconSlot({ setLabel }: { setLabel: string }) {
  const key = inferDragonKey(setLabel);
  const size = Math.round(PIECE_SIZE * ICON_SCALE);

  if (!key) {
    return (
      <img
        src={`${ARMOUR_DIR}/helmet_base.png`}
        alt="Helmet"
        className="mx-auto opacity-90"
        style={{ width: size, height: size, objectFit: "contain" }}
      />
    );
  }
  return (
    <img
      src={`${ICONS_DIR}/${key}.png`}
      alt={`${key} icon`}
      className="mx-auto opacity-90"
      style={{ width: size, height: size, objectFit: "contain" }}
      onError={(e) => { (e.currentTarget as HTMLImageElement).src = `${ARMOUR_DIR}/helmet_base.png`; }}
    />
  );
}

/** Canvas-based recolor component (recolored tint UNDER, base ON TOP). */
function RecoloredArmour({
  piece,
  hex,
  size = PIECE_SIZE,
  title,
}: {
  piece: "helmet" | "chestplate" | "leggings" | "boots";
  hex: string | null;
  size?: number;
  title?: string;
}) {
  const baseDefault = `${ARMOUR_DIR}/${piece}_base.png`;
  const baseAlt     = `${ARMOUR_DIR}/${piece}__base.png`; // e.g. boots__base.png
  const tintSrc     = `${ARMOUR_DIR}/${piece}_tint.png`;

  const [baseSrc, setBaseSrc] = useState(baseDefault);
  const [recolored, setRecolored] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => { return () => { mounted.current = false; }; }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const nhex = normHex(hex || "");
      if (!nhex) { setRecolored(null); return; }
      try {
        const dataUrl = await getRecolored(tintSrc, nhex, size);
        if (!cancelled && mounted.current) setRecolored(dataUrl);
      } catch {
        if (!cancelled && mounted.current) setRecolored(null);
      }
    })();
    return () => { cancelled = true; };
  }, [tintSrc, hex, size]);

  return (
    <div className="relative" title={title || piece} style={{ width: size, height: size }}>
      {/* recolored tint under */}
      {recolored && (
        <img
          src={recolored}
          alt={`${piece} recolored`}
          className="absolute inset-0 w-full h-full object-contain select-none pointer-events-none"
        />
      )}
      {/* base on top for crisp pixels */}
      <img
        src={baseSrc}
        alt={`${piece} base`}
        className="absolute inset-0 w-full h-full object-contain select-none pointer-events-none"
        onError={() => { if (baseSrc !== baseAlt) setBaseSrc(baseAlt); }}
      />
    </div>
  );
}

function VerticalSetPreview({ s }: { s: SetItem }) {
  const c = normHex(s.pieces.chestplate?.color);
  const l = normHex(s.pieces.leggings?.color);
  const b = normHex(s.pieces.boots?.color);
  return (
    <div className="flex flex-col items-center gap-2">
      <HelmetIconSlot setLabel={s.setLabel} />
      <RecoloredArmour piece="chestplate" hex={c} title="Chestplate" />
      <RecoloredArmour piece="leggings"  hex={l} title="Leggings" />
      <RecoloredArmour piece="boots"      hex={b} title="Boots" />
    </div>
  );
}

/* =========================
   Page
   ========================= */
export default function SetsPage() {
  // inputs
  const [hex, setHex] = useState("");
  const [q, setQ] = useState("");
  const [tolerance, setTolerance] = useState(0);
  const [exactGroup, setExactGroup] = useState(false);

  // paging
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(24);

  // data
  const [items, setItems] = useState<SetItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // favourites (store full objects for your /favourites page)
  const [favKeys, setFavKeys] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(LS_SETS);
      const arr: any[] = raw ? JSON.parse(raw) : [];
      return new Set(arr.map((x) => x?.favKey).filter(Boolean));
    } catch { return new Set(); }
  });

  const apiUrl = useMemo(() => {
    const usp = new URLSearchParams();
    usp.set("page", String(page));
    usp.set("limit", String(limit));
    if (hex.trim()) usp.set("color", hex.trim());
    if (q.trim()) usp.set("q", q.trim());
    if (tolerance > 0) usp.set("tolerance", String(tolerance));
    if (exactGroup) usp.set("exactGroup", "1");
    return `/api/sets?${usp.toString()}`;
  }, [hex, q, page, limit, tolerance, exactGroup]);

  useEffect(() => {
    if (!hex.trim() || !q.trim()) {
      setItems([]); setTotal(0); setTotalPages(0); setErr(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true); setErr(null);
      try {
        const res = await fetch(apiUrl, { cache: "no-store" });
        const json: ApiResp = await res.json();
        if (!cancelled) {
          if (!json.ok) {
            setErr(json.error || "Failed to load");
            setItems([]); setTotal(0); setTotalPages(0);
          } else {
            setItems(json.items || []);
            setTotal(json.total || 0);
            setTotalPages(json.totalPages || 0);
          }
        }
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [apiUrl]);

  useEffect(() => { setPage(1); }, [hex, q, limit, tolerance, exactGroup]);

  const toggleFav = (s: SetItem) => {
    const key = makeSetKey(s);
    setFavKeys((prev) => {
      const next = new Set(prev);
      try {
        const raw = localStorage.getItem(LS_SETS);
        const arr: any[] = raw ? JSON.parse(raw) : [];
        let filtered = arr.filter((x) => x?.favKey !== key);
        if (!next.has(key)) {
          filtered = [...filtered, { ...s, favKey: key }];
          next.add(key);
        } else {
          next.delete(key);
        }
        localStorage.setItem(LS_SETS, JSON.stringify(filtered));
      } catch {}
      return next;
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-cyan-900 via-cyan-900 to-cyan-950 text-slate-100">
      <header className="py-10 text-center">
        <h1 className="text-4xl font-extrabold tracking-tight drop-shadow" style={{ fontFamily: '"Exo 2", system-ui, sans-serif' }}>
          Gibbo&apos;s Exo&apos;s — Sets
        </h1>
        <p className="mt-2 text-sm text-cyan-200/80">Search complete sets by hex + set name (per owner)</p>

        <div className="mt-4 flex gap-3 justify-center">
          <Link href="/" className="px-4 py-2 rounded-full bg-white/5 ring-1 ring-white/10 hover:bg-white/10 backdrop-blur-md transition">All Items</Link>
          <Link href="/favourites" className="px-4 py-2 rounded-full bg-white/5 ring-1 ring-white/10 hover:bg-white/10 backdrop-blur-md transition">Favourites</Link>
          <span className="px-4 py-2 rounded-full bg-white/10 ring-1 ring-white/10 backdrop-blur-md shadow">Sets</span>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 pb-16">
        {/* Filters */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 mb-8">
          <div className="lg:col-span-4 grid grid-cols-1 sm:grid-cols-4 gap-3">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Set name (e.g. Wise Dragon, Farm Suit)"
              className="px-3 py-1.5 text-sm rounded-2xl bg-white/10 ring-1 ring-white/10 placeholder:text-slate-300/70 focus:outline-none focus:ring-2 focus:ring-cyan-300/40 backdrop-blur-md"
            />
            <input
              value={hex}
              onChange={(e) => setHex(e.target.value)}
              placeholder="Exact hex (e.g. 191919 or #191919)"
              className="px-3 py-1.5 text-sm rounded-2xl bg-white/10 ring-1 ring-white/10 placeholder:text-slate-300/70 focus:outline-none focus:ring-2 focus:ring-cyan-300/40 backdrop-blur-md"
            />
            <div className="flex items-center gap-2">
              <label className="text-sm text-cyan-200/80">Per page</label>
              <select
                value={limit}
                onChange={(e) => setLimit(parseInt(e.target.value, 10))}
                className="px-3 py-1.5 text-sm rounded-2xl bg-white/10 ring-1 ring-white/10 text-slate-100 focus:outline-none focus:ring-2 focus:ring-cyan-300/40 backdrop-blur-md"
              >
                <option value={12}>12</option>
                <option value={24}>24</option>
                <option value={48}>48</option>
              </select>
            </div>
            <div className="flex items-end">
              <button
                onClick={() => setPage(1)}
                className="w-full px-4 py-2 rounded-2xl bg-white/10 ring-1 ring-white/10 hover:bg-white/15 backdrop-blur-md"
              >
                Search
              </button>
            </div>
          </div>

          {/* tolerance + exactGroup */}
          <div className="lg:col-span-1 rounded-2xl bg-white/10 ring-1 ring-white/10 p-3 backdrop-blur-md">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-cyan-200/80">Nearby tolerance</span>
              <code className="text-[10px] text-cyan-200/90">tol: {tolerance}</code>
            </div>
            <input
              type="range"
              min={0}
              max={MAX_TOL}
              step={1}
              value={tolerance}
              onChange={(e) => setTolerance(parseInt(e.target.value, 10))}
              className="w-full accent-cyan-300"
            />
            <label className="mt-2 flex items-center gap-2 text-xs text-cyan-100/90">
              <input type="checkbox" checked={exactGroup} onChange={(e) => setExactGroup(e.target.checked)} />
              Exact group hexes only
            </label>
          </div>
        </div>

        {/* Prompt / Error */}
        {!hex.trim() || !q.trim() ? (
          <div className="p-4 rounded-2xl bg-white/8 ring-1 ring-white/10 backdrop-blur-xl text-center text-sm text-slate-200/90">
            Enter a <strong>set name</strong> and an <strong>exact hex</strong> to find complete sets owned by the same player.
            <div className="mt-1 opacity-80">Dragon sets return <em>Chestplate + Leggings + Boots</em>. Others (e.g. Farm Suit) return all four pieces.</div>
          </div>
        ) : null}

        {err && (
          <div className="p-3 mb-4 rounded-2xl bg-red-400/10 ring-1 ring-red-400/30 text-red-100">
            {err}
          </div>
        )}

        {/* Results */}
        {!err && items.length > 0 && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {items.map((it, idx) => {
                const favKey = makeSetKey(it);
                const displayHex = computeSetDisplayHex(it) || normHex(it.color) || "#888888";
                const isFav = favKeys.has(favKey);

                return (
                  <div key={idx} className="rounded-2xl bg-white/8 ring-1 ring-white/10 backdrop-blur-xl p-4 shadow-lg">
                    <div className="flex items-start gap-4">
                      {/* left: representative swatch */}
                      <div className="flex flex-col items-center gap-1">
                        <div
                          className="w-10 h-10 rounded-xl ring-1 ring-white/20"
                          style={{ backgroundColor: displayHex || "#888" }}
                          title={displayHex || undefined}
                        />
                        <code className="text-[11px] text-slate-200/90">{displayHex}</code>
                      </div>

                      {/* middle: info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold truncate text-slate-50">
                            {it.setLabel}
                            {it.isExact ? (
                              <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-emerald-400/15 text-emerald-200 ring-1 ring-emerald-400/25">exact</span>
                            ) : typeof it.avgDist === "number" ? (
                              <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-white/10 text-slate-100 ring-1 ring-white/15">avg {it.avgDist}</span>
                            ) : null}
                          </h3>
                          {it.rarity && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 ring-1 ring-white/15 text-slate-100">{it.rarity}</span>
                          )}
                        </div>

                        {/* owner + links */}
                        <div className="mt-1 flex items-center gap-2 text-sm">
                          {it.ownerAvatarUrl && (
                            <img src={it.ownerAvatarUrl} width={20} height={20} alt="avatar" className="rounded-md ring-1 ring-white/20" />
                          )}
                          {it.ownerUsername ? (
                            <span className="text-slate-100">{it.ownerUsername}</span>
                          ) : it.ownerUuid ? (
                            <span className="text-slate-300/80">{it.ownerUuid.slice(0, 8)}…</span>
                          ) : (
                            <span className="text-slate-300/60">No owner</span>
                          )}

                          <div className="ml-auto flex items-center gap-2">
                            {it.ownerPlanckeUrl && (
                              <a className="text-xs underline decoration-cyan-300/60 hover:decoration-cyan-300" href={it.ownerPlanckeUrl} target="_blank" rel="noreferrer">Plancke</a>
                            )}
                            {it.ownerSkyCryptUrl && (
                              <a className="text-xs underline decoration-cyan-300/60 hover:decoration-cyan-300" href={it.ownerSkyCryptUrl} target="_blank" rel="noreferrer">SkyCrypt</a>
                            )}
                            {it.ownerMcuuidUrl && (
                              <a className="text-xs underline decoration-cyan-300/60 hover:decoration-cyan-300" href={it.ownerMcuuidUrl} target="_blank" rel="noreferrer">MCUUID</a>
                            )}
                          </div>
                        </div>

                        {/* piece info */}
                        <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                          {it.pieces.chestplate && (
                            <div className="rounded-xl bg-white/10 ring-1 ring-white/15 p-2">
                              <div className="text-xs opacity-80">Chestplate</div>
                              <div className="font-medium truncate">{it.pieces.chestplate.name}</div>
                              <code className="text-[11px] opacity-90">{normHex(it.pieces.chestplate.color)}</code>
                            </div>
                          )}
                          {it.pieces.leggings && (
                            <div className="rounded-xl bg-white/10 ring-1 ring-white/15 p-2">
                              <div className="text-xs opacity-80">Leggings</div>
                              <div className="font-medium truncate">{it.pieces.leggings.name}</div>
                              <code className="text-[11px] opacity-90">{normHex(it.pieces.leggings.color)}</code>
                            </div>
                          )}
                          {it.pieces.boots && (
                            <div className="rounded-xl bg-white/10 ring-1 ring-white/15 p-2">
                              <div className="text-xs opacity-80">Boots</div>
                              <div className="font-medium truncate">{it.pieces.boots.name}</div>
                              <code className="text-[11px] opacity-90">{normHex(it.pieces.boots.color)}</code>
                            </div>
                          )}
                          {it.pieces.helmet && (
                            <div className="rounded-xl bg-white/10 ring-1 ring-white/15 p-2">
                              <div className="text-xs opacity-80">Helmet</div>
                              <div className="font-medium truncate">{it.pieces.helmet.name}</div>
                              <code className="text-[11px] opacity-90">{normHex(it.pieces.helmet.color)}</code>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* right: vertical preview + favourite */}
                      <div className="flex flex-col items-center gap-3">
                        <VerticalSetPreview s={it} />
                        <button
                          onClick={() => toggleFav(it)}
                          className={`text-2xl leading-none ${isFav ? "text-yellow-300 drop-shadow" : "text-slate-400 hover:text-yellow-300"}`}
                          title={isFav ? "Remove set from favourites" : "Add set to favourites"}
                          aria-label={isFav ? "Unfavourite set" : "Favourite set"}
                        >
                          ★
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* pagination */}
            {totalPages > 1 && (
              <div className="mt-8 flex items-center justify-center gap-3">
                <button
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="px-4 py-2 rounded-2xl bg-white/10 ring-1 ring-white/10 hover:bg-white/15 disabled:opacity-40 backdrop-blur-md"
                >
                  Prev
                </button>
                <span className="text-sm text-slate-200/90">Page {page} / {totalPages} • {total} sets</span>
                <button
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="px-4 py-2 rounded-2xl bg-white/10 ring-1 ring-white/10 hover:bg-white/15 disabled:opacity-40 backdrop-blur-md"
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}

        {loading && <div className="mt-6 text-center text-sm text-slate-300/80">Loading…</div>}
      </main>
    </div>
  );
}
