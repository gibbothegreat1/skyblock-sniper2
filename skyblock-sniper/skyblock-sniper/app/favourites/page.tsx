"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import SiteChrome from "../components/SiteChrome";
import CheckMeButton from "../components/CheckMeButton";
import NonExoticToggles from "../components/NonExoticToggles";
import { getNonExoticHexType } from "../../lib/nonExoticHexes";
import { ArmourPiece } from "../components/ArmourPiece";

/* =========================================
   Types (matches what you store in LS)
   ========================================= */
type PieceEntry = { uuid: string; name: string; color: string };
type SetItem = {
  favKey?: string; // present in your stored payloads
  setLabel: string;
  color?: string | null;
  rarity?: string | null;

  ownerUuid?: string | null;
  ownerUsername?: string | null;
  ownerAvatarUrl?: string | null;
  ownerMcuuidUrl?: string | null;
  ownerPlanckeUrl?: string | null;
  ownerSkyCryptUrl?: string | null;

  pieces: {
    helmet: PieceEntry | null;
    chestplate: PieceEntry | null;
    leggings: PieceEntry | null;
    boots: PieceEntry | null;
  };
};

type ItemFav = {
  uuid: string;
  name: string;
  color?: string | null;
  rarity?: string | null;
  reforge?: string | null;
  hexType?: "fairy" | "crystal" | null;
  ownerUuid?: string | null;
  ownerUsername?: string | null;
  ownerAvatarUrl?: string | null;
  ownerMcuuidUrl?: string | null;
  ownerPlanckeUrl?: string | null;
  ownerSkyCryptUrl?: string | null;
};

/* =========================================
   Constants (same as Sets page)
   ========================================= */
const LS_SETS = "gibbo-fav-sets";
const LS_ITEMS = "gibbo-fav-items";

const ARMOUR_DIR = "/images/armor";
const ICONS_DIR = "/images/set-icons";

const PIECE_SIZE = 56;       // preview size for chest/legs/boots
const ICON_SCALE = 0.9;      // helmet icon fraction of piece size

// tint pipeline
const V_GAIN = 0.06;
const GAMMA = 0.95;
const HIGHLIGHT_OPACITY = 0.12;

// base-outline recolour
const BASE_BLEND = 0.55;
const BASE_DARK_PUSH = 0.9;
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
    switch (max) {
      case r: h = ((g-b)/d + (g < b ? 6 : 0)); break;
      case g: h = (b-r)/d + 2; break;
      default: h = (r-g)/d + 4; break;
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

/* representative hex from piece colours */
function hexToRgbMaybe(h?: string | null) { const n = normHex(h||""); return n ? hexToRgb(n) : null; }
function computeSetDisplayHex(s: SetItem): string | null {
  const cols = [
    hexToRgbMaybe(s.pieces.helmet?.color),
    hexToRgbMaybe(s.pieces.chestplate?.color),
    hexToRgbMaybe(s.pieces.leggings?.color),
    hexToRgbMaybe(s.pieces.boots?.color),
  ].filter(Boolean) as [number,number,number][];
  if (!cols.length) return null;
  const sum = cols.reduce((a,[r,g,b]) => [a[0]+r,a[1]+g,a[2]+b],[0,0,0] as [number,number,number]);
  const avg: [number,number,number] = [sum[0]/cols.length, sum[1]/cols.length, sum[2]/cols.length];
  return rgbToHex(avg[0], avg[1], avg[2]);
}

function setPieceList(s: SetItem): PieceEntry[] {
  return [s.pieces.helmet, s.pieces.chestplate, s.pieces.leggings, s.pieces.boots]
    .filter((piece): piece is PieceEntry => Boolean(piece));
}

function inferDragonKey(setLabel: string) {
  const m = setLabel.toLowerCase().match(/\b(superior|wise|unstable|strong|young|old|protector|holy)\b/);
  return m ? m[1] : null;
}

/* =========================================
   Canvas utils (same algorithms as Sets)
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

/* recolour the *_tint.png toward target hex; gray targets handled */
async function recolorTintToHex(tintUrl: string, hex: string, size: number): Promise<HTMLCanvasElement> {
  const img = await loadImage(tintUrl);
  const w = img.naturalWidth || size;
  const h = img.naturalHeight || size;

  const cnv = document.createElement("canvas");
  cnv.width = w; cnv.height = h;
  const ctx = cnv.getContext("2d", { willReadFrequently: true })!;
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
      const vOut = clamp01(v * (0.5 + tv * 0.5));
      [nr,ng,nb] = hsvToRgb(th, ts, vOut);
    }
    d[i]=nr; d[i+1]=ng; d[i+2]=nb;
  }
  ctx.putImageData(image, 0, 0);

  // masked highlight (no outer square)
  if (HIGHLIGHT_OPACITY > 0) {
    const maskC = document.createElement("canvas");
    maskC.width = w; maskC.height = h;
    const mctx = maskC.getContext("2d")!;
    const grad = mctx.createLinearGradient(0,0,0,h);
    grad.addColorStop(0, `rgba(255,255,255,${HIGHLIGHT_OPACITY})`);
    grad.addColorStop(1, "rgba(255,255,255,0)");
    mctx.fillStyle = grad;
    mctx.fillRect(0,0,w,h);
    mctx.globalCompositeOperation = "destination-in";
    mctx.drawImage(img, 0, 0, w, h);
    ctx.globalCompositeOperation = "screen";
    ctx.drawImage(maskC, 0, 0);
    ctx.globalCompositeOperation = "source-over";
  }

  return cnv;
}

/* recolour base outline but skip “brown/leather” pixels */
function isBrownPixel(r: number, g: number, b: number) {
  const [h,s,v] = rgbToHsv(r,g,b);
  const deg = h*360;
  return (
    deg >= BROWN_H_MIN && deg <= BROWN_H_MAX &&
    s >= BROWN_S_MIN &&
    v >= BROWN_V_MIN && v <= BROWN_V_MAX
  );
}
async function recolorBaseOutline(baseUrl: string, hex: string, size: number): Promise<HTMLCanvasElement> {
  const img = await loadImage(baseUrl);
  const w = img.naturalWidth || size;
  const h = img.naturalHeight || size;

  const cnv = document.createElement("canvas");
  cnv.width = w; cnv.height = h;
  const ctx = cnv.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);

  const image = ctx.getImageData(0,0,w,h);
  const d = image.data;

  const [tr, tg, tb] = hexToRgb(hex);
  const [th, ts, tv] = rgbToHsv(tr, tg, tb);

  for (let i=0; i<d.length; i+=4) {
    const a = d[i+3]; if (a===0) continue;
    const r = d[i], g = d[i+1], b = d[i+2];

    if (isBrownPixel(r,g,b)) continue;

    let [h, s, v] = rgbToHsv(r,g,b);
    h = (1-BASE_BLEND)*h + BASE_BLEND*th;
    s = clamp01((1-BASE_BLEND)*s + BASE_BLEND*(ts*0.85));
    v = clamp01(v*BASE_DARK_PUSH + tv*(1-BASE_DARK_PUSH)*0.25);

    const [nr,ng,nb] = hsvToRgb(h,s,v);
    d[i]=nr; d[i+1]=ng; d[i+2]=nb;
  }
  ctx.putImageData(image, 0, 0);
  return cnv;
}

/* caches */
const tintCache = new Map<string,string>();
const baseCache = new Map<string,string>();
async function getTint(url: string, hex: string, size: number) {
  const key = `${url}|${hex}|${size}|t2`;
  const hit = tintCache.get(key); if (hit) return hit;
  const cnv = await recolorTintToHex(url, hex, size);
  const data = cnv.toDataURL("image/png");
  tintCache.set(key, data);
  return data;
}
async function getBase(url: string, hex: string, size: number) {
  const key = `${url}|${hex}|${size}|b2`;
  const hit = baseCache.get(key); if (hit) return hit;
  const cnv = await recolorBaseOutline(url, hex, size);
  const data = cnv.toDataURL("image/png");
  baseCache.set(key, data);
  return data;
}

/* =========================================
   Armour UI
   ========================================= */
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

function ArmourCanvas({
  piece, hex, size = PIECE_SIZE, title
}: { piece: "helmet" | "chestplate" | "leggings" | "boots"; hex: string | null; size?: number; title?: string }) {
  const tintUrl = `${ARMOUR_DIR}/${piece}_tint.png`;
  const baseUrl = `${ARMOUR_DIR}/${piece}_base.png`;
  const baseAlt = `${ARMOUR_DIR}/${piece}__base.png`;

  const [imgTint, setImgTint] = useState<string | null>(null);
  const [imgBase, setImgBase] = useState<string | null>(null);
  const [fallbackBase, setFallbackBase] = useState(false);
  const mounted = useRef(true);

  useEffect(() => { return () => { mounted.current = false; }; }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const nhex = normHex(hex || "");
      if (!nhex) { setImgTint(null); setImgBase(null); return; }
      try {
        const [t, b] = await Promise.all([
          getTint(tintUrl, nhex, size),
          getBase(fallbackBase ? baseAlt : baseUrl, nhex, size),
        ]);
        if (!cancelled && mounted.current) { setImgTint(t); setImgBase(b); }
      } catch {
        if (!cancelled) {
          if (!fallbackBase) setFallbackBase(true);
          else { setImgTint(null); setImgBase(null); }
        }
      }
    })();
    return () => { cancelled = true; };
  }, [tintUrl, baseUrl, baseAlt, hex, size, fallbackBase]);

  return (
    <div className="relative" title={title || piece} style={{ width: size, height: size }}>
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
   LocalStorage helpers (keep your current key)
   ========================================= */
function loadFavs(): SetItem[] {
  try {
    const raw = localStorage.getItem(LS_SETS);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}
function saveFavs(list: SetItem[]) {
  try { localStorage.setItem(LS_SETS, JSON.stringify(list)); } catch {}
}


function inferPieceFromName(name?: string | null): "helmet" | "chestplate" | "leggings" | "boots" | null {
  if (!name) return null;
  const n = name.toLowerCase();
  if (/\b(helm|helmet|mask|cap)\b/.test(n)) return "helmet";
  if (/\b(chest|chestplate|torso|tunic|plate)\b/.test(n)) return "chestplate";
  if (/\b(leg|legging|leggings|pants|trouser)\b/.test(n)) return "leggings";
  if (/\b(boot|boots|shoe|shoes|greave)\b/.test(n)) return "boots";
  return null;
}

function loadItemFavs(): ItemFav[] {
  try {
    const raw = localStorage.getItem(LS_ITEMS);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}
function saveItemFavs(list: ItemFav[]) {
  try { localStorage.setItem(LS_ITEMS, JSON.stringify(list)); } catch {}
}

/* =========================================
   Page
   ========================================= */
export default function FavouritesPage() {
  const [items, setItems] = useState<SetItem[]>([]);
  const [itemFavs, setItemFavs] = useState<ItemFav[]>([]);
  const [includeFairy, setIncludeFairy] = useState(false);
  const [includeCrystal, setIncludeCrystal] = useState(false);

  const refresh = () => { setItems(loadFavs()); setItemFavs(loadItemFavs()); };

  useEffect(() => { refresh(); }, []);


  const visibleItems = useMemo(() => items.filter((s) => {
    const types = setPieceList(s).map((p) => getNonExoticHexType(p.color));
    if (!includeFairy && types.includes("fairy")) return false;
    if (!includeCrystal && types.includes("crystal")) return false;
    return true;
  }), [items, includeFairy, includeCrystal]);

  const visibleItemFavs = useMemo(() => itemFavs.filter((it) => {
    const type = it.hexType ?? getNonExoticHexType(it.color);
    if (type === "fairy" && !includeFairy) return false;
    if (type === "crystal" && !includeCrystal) return false;
    return true;
  }), [itemFavs, includeFairy, includeCrystal]);

  const remove = (favKey?: string) => {
    if (!favKey) return;
    const next = loadFavs().filter((f) => f.favKey !== favKey);
    saveFavs(next);
    setItems(next);
  };

  const removeItem = (uuid: string) => {
    const next = loadItemFavs().filter((f) => f.uuid !== uuid);
    saveItemFavs(next);
    setItemFavs(next);
  };

  return (
    <div className="site-shell">
      <SiteChrome
        title="Gibbo's Exotics — Favourites"
        subtitle="Keep saved exotic pieces and complete sets together, with the same Fairy/Crystal filters and live verification."
      />

      <main className="content-wrap page-content">
        <div className="theme-panel p-4 mb-6">
          <NonExoticToggles compact includeFairy={includeFairy} includeCrystal={includeCrystal} onFairy={setIncludeFairy} onCrystal={setIncludeCrystal} />
        </div>
        {(itemFavs.length > 0 || items.length > 0) ? (
          <div className="space-y-8">
            {itemFavs.length > 0 && (
              <section>
                <div className="results-heading mb-4">
                  <div><p className="section-kicker">SAVED PIECES</p><h2>Favourite armour</h2></div>
                  <span className="result-chip">{visibleItemFavs.length} visible</span>
                </div>
                {visibleItemFavs.length === 0 ? (
                  <div className="theme-banner p-6 text-center text-sm">All saved pieces are hidden by the Fairy/Crystal filters.</div>
                ) : (
                  <div className="results-grid">
                    {visibleItemFavs.map((it) => {
                      const colorHex = normHex(it.color);
                      const piece = inferPieceFromName(it.name);
                      const hexType = it.hexType ?? getNonExoticHexType(it.color);
                      const ownerLabel = it.ownerUsername || (it.ownerUuid ? `${it.ownerUuid.slice(0,8)}…` : "Owner unavailable");
                      return (
                        <article className="item-card" key={it.uuid}>
                          <div className="item-visual">
                            <div className="colour-orb" style={{ background: colorHex || "#64748b" }} />
                            {piece && colorHex ? <ArmourPiece piece={piece} hex={colorHex} size={76} /> : <div className="armour-placeholder">?</div>}
                          </div>
                          <div className="item-body">
                            <div className="item-title-row">
                              <div>
                                <div className="badge-row">
                                  {it.rarity && <span className="rarity-badge">{it.rarity}</span>}
                                  {hexType && <span className={`hex-badge ${hexType}`}>{hexType === "fairy" ? "Fairy hex" : "Crystal hex"}</span>}
                                  {!hexType && colorHex && <span className="hex-badge exotic">Exotic hex</span>}
                                </div>
                                <h3>{it.name}</h3>
                              </div>
                              <button className="fav-button saved" onClick={() => removeItem(it.uuid)} aria-label="Remove favourite">★</button>
                            </div>
                            <div className="hex-line">
                              <span className="mini-swatch" style={{ background: colorHex || "#64748b" }} />
                              <code>{colorHex || "NO HEX"}</code>
                              {it.reforge && it.reforge !== "Clean" && <span className="reforge">{it.reforge}</span>}
                            </div>
                            <div className="owner-row">
                              <div className="owner-id">
                                {it.ownerAvatarUrl ? <img src={it.ownerAvatarUrl} width={24} height={24} alt="" /> : <span className="avatar-fallback" />}
                                <span>{ownerLabel}</span>
                              </div>
                              <div className="owner-links">
                                {it.ownerSkyCryptUrl && <a href={it.ownerSkyCryptUrl} target="_blank" rel="noreferrer">SkyCrypt</a>}
                                {it.ownerPlanckeUrl && <a href={it.ownerPlanckeUrl} target="_blank" rel="noreferrer">Plancke</a>}
                                {it.ownerMcuuidUrl && <a href={it.ownerMcuuidUrl} target="_blank" rel="noreferrer">UUID</a>}
                              </div>
                            </div>
                            <CheckMeButton ownerUsername={it.ownerUsername} ownerUuid={it.ownerUuid} target={{ uuid: it.uuid, name: it.name, color: it.color }} />
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>
            )}

            {items.length > 0 && (
              <section>
                <div className="results-heading mb-4">
                  <div><p className="section-kicker">SAVED SETS</p><h2>Favourite sets</h2></div>
                  <span className="result-chip">{visibleItems.length} visible</span>
                </div>
                {visibleItems.length === 0 ? (
                  <div className="theme-banner p-6 text-center text-sm">All saved sets are hidden by the Fairy/Crystal filters.</div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {visibleItems.map((s, idx) => {
                      const favKey = s.favKey ?? `${idx}`;
                      const displayHex = computeSetDisplayHex(s) || normHex(s.color) || "#888888";
                      return (
                        <div key={favKey} className="theme-card p-4">
                          <div className="flex items-start gap-4">
                            <div className="flex flex-col items-center gap-1">
                              <div className="w-10 h-10 rounded-xl ring-1 ring-white/20" style={{ backgroundColor: displayHex || "#888" }} />
                              <code className="text-[11px] text-slate-200/90">{displayHex}</code>
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <h3 className="font-semibold truncate text-slate-50">{s.setLabel}</h3>
                                {s.rarity && <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 ring-1 ring-white/15 text-slate-100">{s.rarity}</span>}
                              </div>
                              <div className="mt-1 flex items-center gap-2 text-sm">
                                {s.ownerAvatarUrl && <img src={s.ownerAvatarUrl} width={20} height={20} alt="avatar" className="rounded-md ring-1 ring-white/20" />}
                                {s.ownerUsername ? <span className="text-slate-100">{s.ownerUsername}</span> : s.ownerUuid ? <span className="text-slate-300/80">{s.ownerUuid.slice(0,8)}…</span> : <span className="text-slate-300/60">No owner</span>}
                                <div className="ml-auto flex items-center gap-2">
                                  {s.ownerPlanckeUrl && <a className="text-xs underline decoration-cyan-300/60 hover:decoration-cyan-300" href={s.ownerPlanckeUrl} target="_blank" rel="noreferrer">Plancke</a>}
                                  {s.ownerSkyCryptUrl && <a className="text-xs underline decoration-cyan-300/60 hover:decoration-cyan-300" href={s.ownerSkyCryptUrl} target="_blank" rel="noreferrer">SkyCrypt</a>}
                                  {s.ownerMcuuidUrl && <a className="text-xs underline decoration-cyan-300/60 hover:decoration-cyan-300" href={s.ownerMcuuidUrl} target="_blank" rel="noreferrer">MCUUID</a>}
                                </div>
                              </div>
                              <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                                {(["chestplate","leggings","boots","helmet"] as const).map((kind) => {
                                  const piece = s.pieces[kind];
                                  if (!piece) return null;
                                  return <div className="theme-piece p-2" key={kind}><div className="text-xs opacity-80">{kind[0].toUpperCase()+kind.slice(1)}</div><div className="font-medium truncate">{piece.name}</div><code className="text-[11px] opacity-90">{normHex(piece.color)}</code></div>;
                                })}
                              </div>
                            </div>
                            <VerticalSetPreview s={s} />
                          </div>
                          <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
                            <CheckMeButton ownerUsername={s.ownerUsername} ownerUuid={s.ownerUuid} targets={setPieceList(s).map((p) => ({ uuid: p.uuid, name: p.name, color: p.color }))} />
                            <button onClick={() => remove(s.favKey)} className="px-3 py-1.5 text-sm rounded-xl bg-white/10 ring-1 ring-white/10 hover:bg-white/15" title="Remove from favourites">Remove</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            )}
          </div>
        ) : (
          <div className="theme-banner p-8 text-center text-sm">
            No favourites yet. Save individual pieces from <Link className="underline" href="/">All Items</Link> or complete sets from <Link className="underline" href="/sets">Sets</Link>.
          </div>
        )}
      </main>
    </div>
  );
}
