"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

/* =========================================
   Types
   ========================================= */
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

/* =========================================
   Constants
   ========================================= */
const MAX_TOL = 405;
const LS_SETS = "gibbo-fav-sets";

const ARMOUR_DIR = "/images/armor";
const ICONS_DIR  = "/images/set-icons";

const PIECE_SIZE = 56;
const ICON_SCALE = 0.90;

/** Tint canvas tuning */
const V_GAIN = 0.06;  // lifts deep shadows slightly
const GAMMA  = 0.95;  // <1 brightens mids a touch
const HIGHLIGHT_OPACITY = 0.12; // sheen inside the masked area only

/** Base-outline recolour tuning */
const BASE_BLEND = 0.55;     // how strongly to push outlines toward target colour (0..1)
const BASE_DARK_PUSH = 0.9;  // keep outlines a bit darker
// Brown detection (in degrees)
const BROWN_H_MIN = 12;
const BROWN_H_MAX = 45;
const BROWN_S_MIN = 0.25;
const BROWN_V_MIN = 0.18;
const BROWN_V_MAX = 0.85;

/* =========================================
   Color helpers
   ========================================= */
function normHex(h?: string | null) {
  if (!h) return null;
  const x = h.trim().replace(/^#/, "");
  return /^[0-9a-fA-F]{6}$/.test(x) ? `#${x.toLowerCase()}` : null;
}
function hexToRgb(h: string) {
  const x = h.replace("#", "");
  return [parseInt(x.slice(0,2),16), parseInt(x.slice(2,4),16), parseInt(x.slice(4,6),16)] as [number,number,number];
}
function rgbToHex(r: number, g: number, b: number) {
  return "#" + [r,g,b].map(v => Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,"0")).join("");
}
function rgbToHsv(r: number, g: number, b: number) {
  r/=255; g/=255; b/=255;
  const max = Math.max(r,g,b), min = Math.min(r,g,b), d = max-min;
  let h = 0;
  if (d !== 0) {
    switch(max){
      case r: h = ((g-b)/d + (g < b ? 6:0)); break;
      case g: h = (b-r)/d + 2; break;
      default: h = (r-g)/d + 4;
    }
    h /= 6;
  }
  const s = max === 0 ? 0 : d/max;
  return [h, s, max] as [number, number, number];
}
function hsvToRgb(h: number, s: number, v: number) {
  const i = Math.floor(h*6);
  const f = h*6 - i;
  const p = v*(1-s);
  const q = v*(1-f*s);
  const t = v*(1-(1-f)*s);
  let r=0,g=0,b=0;
  switch(i%6){
    case 0: r=v; g=t; b=p; break;
    case 1: r=q; g=v; b=p; break;
    case 2: r=p; g=v; b=t; break;
    case 3: r=p; g=q; b=v; break;
    case 4: r=t; g=p; b=v; break;
    case 5: r=v; g=p; b=q; break;
  }
  return [Math.round(r*255), Math.round(g*255), Math.round(b*255)] as [number,number,number];
}
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/* =========================================
   Display hex from pieces
   ========================================= */
function hexToRgbMaybe(h?: string | null) { const n = normHex(h||""); return n ? hexToRgb(n) : null; }
function computeSetDisplayHex(s: SetItem): string | null {
  const cols = [
    hexToRgbMaybe(s.pieces.helmet?.color),
    hexToRgbMaybe(s.pieces.chestplate?.color),
    hexToRgbMaybe(s.pieces.leggings?.color),
    hexToRgbMaybe(s.pieces.boots?.color),
  ].filter(Boolean) as [number,number,number][];
  if (!cols.length) return null;
  const sum = cols.reduce((a,[r,g,b]) => [a[0]+r, a[1]+g, a[2]+b], [0,0,0] as [number,number,number]);
  const avg: [number,number,number] = [sum[0]/cols.length, sum[1]/cols.length, sum[2]/cols.length];
  return rgbToHex(avg[0], avg[1], avg[2]);
}
function makeSetKey(s: SetItem) {
  return [s.ownerUuid||"?", s.setLabel||"?", s.pieces.helmet?.uuid||"", s.pieces.chestplate?.uuid||"", s.pieces.leggings?.uuid||"", s.pieces.boots?.uuid||""].join("|");
}
function inferDragonKey(setLabel: string) {
  const m = setLabel.toLowerCase().match(/\b(superior|wise|unstable|strong|young|old|protector|holy)\b/);
  return m ? m[1] : null;
}

/* =========================================
   Image utils
   ========================================= */
function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.decoding = "sync";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/* =========================================
   Canvas recolouring — TINT sprite
   ========================================= */
async function recolorTintToHex(tintUrl: string, hex: string, size: number): Promise<HTMLCanvasElement> {
  const img = await loadImage(tintUrl);
  const w = img.naturalWidth || size;
  const h = img.naturalHeight || size;

  const cnv = document.createElement("canvas");
  cnv.width = w; cnv.height = h;
  const ctx = cnv.getContext("2d", { willReadFrequently: true })!;
  ctx.clearRect(0,0,w,h);
  ctx.drawImage(img, 0, 0, w, h);

  const image = ctx.getImageData(0,0,w,h);
  const d = image.data;

  const [tr, tg, tb] = hexToRgb(hex);
  const [th, ts, tv] = rgbToHsv(tr, tg, tb);
  const grayTarget = ts < 0.001;

  for (let i=0; i<d.length; i+=4) {
    const a = d[i+3]; if (a===0) continue;
    const r = d[i], g = d[i+1], b = d[i+2];
    let v = Math.max(r,g,b)/255;
    v = clamp01(Math.pow(v, GAMMA) + V_GAIN);

    let nr: number, ng: number, nb: number;
    if (grayTarget) {
      nr = Math.round(tr * v);
      ng = Math.round(tg * v);
      nb = Math.round(tb * v);
    } else {
      const vOut = clamp01(v * (0.5 + tv*0.5));
      [nr,ng,nb] = hsvToRgb(th, ts, vOut);
    }
    d[i]=nr; d[i+1]=ng; d[i+2]=nb;
  }
  ctx.putImageData(image, 0, 0);

  // Masked highlight (no outer box)
  if (HIGHLIGHT_OPACITY > 0) {
    const gradC = document.createElement("canvas");
    gradC.width = w; gradC.height = h;
    const gctx = gradC.getContext("2d")!;
    const grad = gctx.createLinearGradient(0,0,0,h);
    grad.addColorStop(0, `rgba(255,255,255,${HIGHLIGHT_OPACITY})`);
    grad.addColorStop(1, "rgba(255,255,255,0)");
    gctx.fillStyle = grad;
    gctx.fillRect(0,0,w,h);
    // keep only sprite alpha
    gctx.globalCompositeOperation = "destination-in";
    gctx.drawImage(img, 0, 0, w, h);
    // composite into main with screen
    ctx.globalCompositeOperation = "screen";
    ctx.drawImage(gradC, 0, 0);
    ctx.globalCompositeOperation = "source-over";
  }
  return cnv;
}

/* =========================================
   Canvas recolouring — BASE outline (skip browns)
   ========================================= */
function isBrownPixel(r: number, g: number, b: number) {
  let [h, s, v] = rgbToHsv(r, g, b);
  const deg = h * 360;
  return (
    deg >= BROWN_H_MIN && deg <= BROWN_H_MAX &&
    s >= BROWN_S_MIN &&
    v >= BROWN_V_MIN && v <= BROWN_V_MAX
  );
}

/** Push non-brown base pixels toward target colour; keep leather browns unmodified. */
async function recolorBaseOutline(baseUrl: string, hex: string, size: number): Promise<HTMLCanvasElement> {
  const img = await loadImage(baseUrl);
  const w = img.naturalWidth || size;
  const h = img.naturalHeight || size;

  const cnv = document.createElement("canvas");
  cnv.width = w; cnv.height = h;
  const ctx = cnv.getContext("2d", { willReadFrequently: true })!;
  ctx.clearRect(0,0,w,h);
  ctx.drawImage(img, 0, 0, w, h);

  const image = ctx.getImageData(0,0,w,h);
  const d = image.data;

  const [tr, tg, tb] = hexToRgb(hex);
  const [th, ts, tv] = rgbToHsv(tr, tg, tb); // target hsv

  for (let i=0; i<d.length; i+=4) {
    const a = d[i+3]; if (a === 0) continue;
    const r = d[i], g = d[i+1], b = d[i+2];

    if (isBrownPixel(r,g,b)) {
      // keep leather/strap colours exactly
      continue;
    }

    // For outlines/light grays: softly push hue/sat toward target but keep value close to original
    let [h, s, v] = rgbToHsv(r, g, b);
    // Blend hue/sat toward target
    h = (1-BASE_BLEND)*h + BASE_BLEND*th;
    s = clamp01((1-BASE_BLEND)*s + BASE_BLEND*(ts*0.85));
    // Keep outlines slightly darker to preserve contrast
    v = clamp01(v*BASE_DARK_PUSH + tv*(1-BASE_DARK_PUSH)*0.25);

    const [nr, ng, nb] = hsvToRgb(h, s, v);
    d[i]=nr; d[i+1]=ng; d[i+2]=nb;
  }
  ctx.putImageData(image, 0, 0);
  return cnv;
}

/* =========================================
   Small caches
   ========================================= */
const tintCache  = new Map<string, string>();  // key: url|hex|size
const baseCache  = new Map<string, string>();  // key: url|hex|size

async function getTint(url: string, hex: string, size: number) {
  const key = `${url}|${hex}|${size}|t2`;
  const hit = tintCache.get(key);
  if (hit) return hit;
  const cnv = await recolorTintToHex(url, hex, size);
  const data = cnv.toDataURL("image/png");
  tintCache.set(key, data);
  return data;
}
async function getBase(url: string, hex: string, size: number) {
  const key = `${url}|${hex}|${size}|b2`;
  const hit = baseCache.get(key);
  if (hit) return hit;
  const cnv = await recolorBaseOutline(url, hex, size);
  const data = cnv.toDataURL("image/png");
  baseCache.set(key, data);
  return data;
}

/* =========================================
   UI: Helmet icon & armour preview
   ========================================= */
function HelmetIconSlot({ setLabel }: { setLabel: string }) {
  const key = inferDragonKey(setLabel);
  const size = Math.round(PIECE_SIZE * ICON_SCALE);
  if (!key) {
    return <img src={`${ARMOUR_DIR}/helmet_base.png`} alt="Helmet" className="mx-auto opacity-90" style={{ width:size, height:size, objectFit:"contain" }}/>;
  }
  return (
    <img
      src={`${ICONS_DIR}/${key}.png`}
      alt={`${key} icon`}
      className="mx-auto opacity-90"
      style={{ width:size, height:size, objectFit:"contain" }}
      onError={(e)=>{(e.currentTarget as HTMLImageElement).src = `${ARMOUR_DIR}/helmet_base.png`;}}
    />
  );
}

/** Canvas-based recolour: recolored tint UNDER + recolored base outline ON TOP (browns preserved). */
function ArmourCanvas({
  piece, hex, size = PIECE_SIZE, title
}: { piece:"helmet"|"chestplate"|"leggings"|"boots"; hex:string|null; size?:number; title?:string }) {
  const tintUrl = `${ARMOUR_DIR}/${piece}_tint.png`;
  const baseUrl = `${ARMOUR_DIR}/${piece}_base.png`;
  const baseAlt = `${ARMOUR_DIR}/${piece}__base.png`;

  const [imgTint, setImgTint] = useState<string|null>(null);
  const [imgBase, setImgBase] = useState<string|null>(null);
  const [fallbackBase, setFallbackBase] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async ()=>{
      const nhex = normHex(hex||"");
      if (!nhex) { setImgTint(null); setImgBase(null); return; }
      try {
        const [t, b] = await Promise.all([
          getTint(tintUrl, nhex, size),
          getBase(fallbackBase ? baseAlt : baseUrl, nhex, size)
        ]);
        if (!cancelled) { setImgTint(t); setImgBase(b); }
      } catch {
        if (!cancelled) {
          if (!fallbackBase) { setFallbackBase(true); }
          else { setImgTint(null); setImgBase(null); }
        }
      }
    })();
    return ()=>{ cancelled = true; };
  }, [tintUrl, baseUrl, baseAlt, hex, size, fallbackBase]);

  return (
    <div className="relative" title={title||piece} style={{ width:size, height:size }}>
      {imgTint && <img src={imgTint} alt={`${piece} tint`} className="absolute inset-0 w-full h-full object-contain select-none pointer-events-none" />}
      {imgBase && <img src={imgBase} alt={`${piece} base`} className="absolute inset-0 w-full h-full object-contain select-none pointer-events-none" />}
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
      <ArmourCanvas piece="chestplate" hex={c} title="Chestplate" />
      <ArmourCanvas piece="leggings"  hex={l} title="Leggings" />
      <ArmourCanvas piece="boots"      hex={b} title="Boots" />
    </div>
  );
}

/* =========================================
   Page
   ========================================= */
export default function SetsPage() {
  const [hex, setHex] = useState("");
  const [q, setQ] = useState("");
  const [tolerance, setTolerance] = useState(0);
  const [exactGroup, setExactGroup] = useState(false);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(24);
  const [items, setItems] = useState<SetItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string|null>(null);

  const [favKeys, setFavKeys] = useState<Set<string>>(() => {
    try { const raw = localStorage.getItem(LS_SETS); const arr:any[] = raw ? JSON.parse(raw) : []; return new Set(arr.map(x=>x?.favKey).filter(Boolean)); }
    catch { return new Set(); }
  });

  const apiUrl = useMemo(() => {
    const usp = new URLSearchParams();
    usp.set("page", String(page));
    usp.set("limit", String(limit));
    if (hex.trim()) usp.set("color", hex.trim());
    if (q.trim()) usp.set("q", q.trim());
    if (tolerance > 0) usp.set("tolerance", String(tolerance));
    if (exactGroup) usp.set("exactGroup","1");
    return `/api/sets?${usp.toString()}`;
  }, [hex, q, page, limit, tolerance, exactGroup]);

  useEffect(() => {
    if (!hex.trim() || !q.trim()) { setItems([]); setTotal(0); setTotalPages(0); setErr(null); return; }
    let cancelled = false;
    (async () => {
      setLoading(true); setErr(null);
      try {
        const res = await fetch(apiUrl, { cache:"no-store" });
        const json: ApiResp = await res.json();
        if (!cancelled) {
          if (!json.ok) { setErr(json.error || "Failed to load"); setItems([]); setTotal(0); setTotalPages(0); }
          else { setItems(json.items||[]); setTotal(json.total||0); setTotalPages(json.totalPages||0); }
        }
      } catch (e:any) {
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
    setFavKeys(prev => {
      const next = new Set(prev);
      try {
        const raw = localStorage.getItem(LS_SETS);
        const arr:any[] = raw ? JSON.parse(raw) : [];
        let filtered = arr.filter(x => x?.favKey !== key);
        if (!next.has(key)) { filtered = [...filtered, { ...s, favKey:key }]; next.add(key); }
        else { next.delete(key); }
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
            <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Set name (e.g. Wise Dragon, Farm Suit)" className="px-3 py-1.5 text-sm rounded-2xl bg-white/10 ring-1 ring-white/10 placeholder:text-slate-300/70 focus:outline-none focus:ring-2 focus:ring-cyan-300/40 backdrop-blur-md" />
            <input value={hex} onChange={e=>setHex(e.target.value)} placeholder="Exact hex (e.g. 191919 or #191919)" className="px-3 py-1.5 text-sm rounded-2xl bg-white/10 ring-1 ring-white/10 placeholder:text-slate-300/70 focus:outline-none focus:ring-2 focus:ring-cyan-300/40 backdrop-blur-md" />
            <div className="flex items-center gap-2">
              <label className="text-sm text-cyan-200/80">Per page</label>
              <select value={limit} onChange={e=>setLimit(parseInt(e.target.value,10))} className="px-3 py-1.5 text-sm rounded-2xl bg-white/10 ring-1 ring-white/10 text-slate-100 focus:outline-none focus:ring-2 focus:ring-cyan-300/40 backdrop-blur-md">
                <option value={12}>12</option>
                <option value={24}>24</option>
                <option value={48}>48</option>
              </select>
            </div>
            <div className="flex items-end">
              <button onClick={()=>setPage(1)} className="w-full px-4 py-2 rounded-2xl bg-white/10 ring-1 ring-white/10 hover:bg-white/15 backdrop-blur-md">Search</button>
            </div>
          </div>

          <div className="lg:col-span-1 rounded-2xl bg-white/10 ring-1 ring-white/10 p-3 backdrop-blur-md">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-cyan-200/80">Nearby tolerance</span>
              <code className="text-[10px] text-cyan-200/90">tol: {tolerance}</code>
            </div>
            <input type="range" min={0} max={MAX_TOL} step={1} value={tolerance} onChange={e=>setTolerance(parseInt(e.target.value,10))} className="w-full accent-cyan-300" />
            <label className="mt-2 flex items-center gap-2 text-xs text-cyan-100/90">
              <input type="checkbox" checked={exactGroup} onChange={e=>setExactGroup(e.target.checked)} /> Exact group hexes only
            </label>
          </div>
        </div>

        {/* Guidance & Errors */}
        {!hex.trim() || !q.trim() ? (
          <div className="p-4 rounded-2xl bg-white/8 ring-1 ring-white/10 backdrop-blur-xl text-center text-sm text-slate-200/90">
            Enter a <strong>set name</strong> and an <strong>exact hex</strong> to find complete sets owned by the same player.
            <div className="mt-1 opacity-80">Dragon sets return <em>Chestplate + Leggings + Boots</em>. Others (e.g. Farm Suit) return all four pieces.</div>
          </div>
        ) : null}

        {err && <div className="p-3 mb-4 rounded-2xl bg-red-400/10 ring-1 ring-red-400/30 text-red-100">{err}</div>}

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
                      {/* swatch */}
                      <div className="flex flex-col items-center gap-1">
                        <div className="w-10 h-10 rounded-xl ring-1 ring-white/20" style={{ backgroundColor: displayHex||"#888" }} title={displayHex||undefined}/>
                        <code className="text-[11px] text-slate-200/90">{displayHex}</code>
                      </div>

                      {/* info */}
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
                          {it.rarity && <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 ring-1 ring-white/15 text-slate-100">{it.rarity}</span>}
                        </div>

                        {/* owner */}
                        <div className="mt-1 flex items-center gap-2 text-sm">
                          {it.ownerAvatarUrl && <img src={it.ownerAvatarUrl} width={20} height={20} alt="avatar" className="rounded-md ring-1 ring-white/20" />}
                          {it.ownerUsername ? <span className="text-slate-100">{it.ownerUsername}</span>
                            : it.ownerUuid ? <span className="text-slate-300/80">{it.ownerUuid.slice(0,8)}…</span>
                            : <span className="text-slate-300/60">No owner</span>}
                          <div className="ml-auto flex items-center gap-2">
                            {it.ownerPlanckeUrl && <a className="text-xs underline decoration-cyan-300/60 hover:decoration-cyan-300" href={it.ownerPlanckeUrl} target="_blank" rel="noreferrer">Plancke</a>}
                            {it.ownerSkyCryptUrl && <a className="text-xs underline decoration-cyan-300/60 hover:decoration-cyan-300" href={it.ownerSkyCryptUrl} target="_blank" rel="noreferrer">SkyCrypt</a>}
                            {it.ownerMcuuidUrl && <a className="text-xs underline decoration-cyan-300/60 hover:decoration-cyan-300" href={it.ownerMcuuidUrl} target="_blank" rel="noreferrer">MCUUID</a>}
                          </div>
                        </div>

                        {/* piece metadata */}
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

                      {/* right: vertical preview & favourite */}
                      <div className="flex flex-col items-center gap-3">
                        <VerticalSetPreview s={it} />
                        <button
                          onClick={()=>toggleFav(it)}
                          className={`text-2xl leading-none ${isFav ? "text-yellow-300 drop-shadow":"text-slate-400 hover:text-yellow-300"}`}
                          title={isFav ? "Remove set from favourites":"Add set to favourites"}
                          aria-label={isFav ? "Unfavourite set":"Favourite set"}
                        >★</button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* pagination */}
            {totalPages > 1 && (
              <div className="mt-8 flex items-center justify-center gap-3">
                <button disabled={page<=1} onClick={()=>setPage(p=>Math.max(1,p-1))} className="px-4 py-2 rounded-2xl bg-white/10 ring-1 ring-white/10 hover:bg-white/15 disabled:opacity-40 backdrop-blur-md">Prev</button>
                <span className="text-sm text-slate-200/90">Page {page} / {totalPages} • {total} sets</span>
                <button disabled={page>=totalPages} onClick={()=>setPage(p=>Math.min(totalPages,p+1))} className="px-4 py-2 rounded-2xl bg-white/10 ring-1 ring-white/10 hover:bg-white/15 disabled:opacity-40 backdrop-blur-md">Next</button>
              </div>
            )}
          </>
        )}

        {loading && <div className="mt-6 text-center text-sm text-slate-300/80">Loading…</div>}
      </main>
    </div>
  );
}
