"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

/* ================================
   Types (adjust if your API differs)
   ================================ */
type OwnerBits = {
  ownerUuid?: string | null;
  ownerUsername?: string | null;
  ownerAvatarUrl?: string | null;
  ownerMcuuidUrl?: string | null;
  ownerPlanckeUrl?: string | null;
  ownerSkyCryptUrl?: string | null;
};

type ItemEntry = OwnerBits & {
  uuid: string;
  name: string;
  color?: string | null;   // hex for this specific item
  rarity?: string | null;
};

type ApiResp = {
  ok: boolean;
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  items: ItemEntry[];
  error?: string;
};

/* ================================
   LocalStorage: item favourites
   ================================ */
const LS_ITEM_FAVS = "gibbo-fav-items";

function loadItemFavs(): ItemEntry[] {
  try {
    const raw = localStorage.getItem(LS_ITEM_FAVS);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
function saveItemFavs(list: ItemEntry[]) {
  try { localStorage.setItem(LS_ITEM_FAVS, JSON.stringify(list)); } catch {}
}
function upsertFavItem(item: ItemEntry) {
  const list = loadItemFavs();
  if (!list.some(x => x.uuid === item.uuid)) {
    list.push(item);
    saveItemFavs(list);
  }
}
function removeFavItem(uuid: string) {
  const next = loadItemFavs().filter(x => x.uuid !== uuid);
  saveItemFavs(next);
}

/* ================================
   Utilities
   ================================ */
const MAX_TOL = 405;
const ARMOUR_DIR = "/images/armor";

const normHex = (h?: string | null) => {
  if (!h) return null;
  const x = h.trim().replace(/^#/, "");
  return /^[0-9a-fA-F]{6}$/.test(x) ? `#${x.toLowerCase()}` : null;
};

function inferPieceFromName(name?: string | null): "helmet" | "chestplate" | "leggings" | "boots" | null {
  if (!name) return null;
  const n = name.toLowerCase();
  if (/\b(helm|helmet|mask|cap)\b/.test(n)) return "helmet";
  if (/\b(chest|chestplate|torso|tunic|plate)\b/.test(n)) return "chestplate";
  if (/\b(leg|legging|leggings|pants|trouser)\b/.test(n)) return "leggings";
  if (/\b(boot|boots|shoe|shoes|greave)\b/.test(n)) return "boots";
  return null;
}

/* ================================
   Colour math helpers
   ================================ */
function hexToRgb(h: string) {
  const x = h.replace("#", "");
  return [parseInt(x.slice(0,2),16), parseInt(x.slice(2,4),16), parseInt(x.slice(4,6),16)] as [number,number,number];
}
function rgbToHsv(r:number,g:number,b:number) {
  r/=255; g/=255; b/=255;
  const max=Math.max(r,g,b), min=Math.min(r,g,b), d=max-min;
  let h=0;
  if (d!==0) {
    switch(max){
      case r: h=((g-b)/d + (g<b?6:0)); break;
      case g: h=(b-r)/d + 2; break;
      default: h=(r-g)/d + 4;
    }
    h/=6;
  }
  const s = max===0?0:d/max;
  return [h,s,max] as [number,number,number];
}
function hsv2rgb(h:number,s:number,v:number){
  const i=Math.floor(h*6);
  const f=h*6-i;
  const p=v*(1-s);
  const q=v*(1-f*s);
  const t=v*(1-(1-f)*s);
  let r=0,g=0,b=0;
  switch(i%6){
    case 0: r=v; g=t; b=p; break;
    case 1: r=q; g=v; b=p; break;
    case 2: r=p; g=v; b=t; break;
    case 3: r=p; g=q; b=v; break;
    case 4: r=t; g=p; b=v; break;
    case 5: r=v; g=p; b=q; break;
  }
  return [Math.round(r*255),Math.round(g*255),Math.round(b*255)] as [number,number,number];
}
const clamp01 = (x:number)=>Math.max(0,Math.min(1,x));

/* ================================
   Canvas recolour for a single piece
   ================================ */
const V_GAIN = 0.06;
const GAMMA = 0.95;
const HIGHLIGHT_OPACITY = 0.12;

const BASE_BLEND = 0.55;
const BASE_DARK_PUSH = 0.9;
const BROWN_H_MIN = 12;
const BROWN_H_MAX = 45;
const BROWN_S_MIN = 0.25;
const BROWN_V_MIN = 0.18;
const BROWN_V_MAX = 0.85;

function loadImage(src:string){
  return new Promise<HTMLImageElement>((resolve,reject)=>{
    const img = new Image();
    img.decoding = "sync";
    img.onload = ()=>resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
async function recolorTintToHex(tintUrl:string, hex:string, size:number){
  const img = await loadImage(tintUrl);
  const w = img.naturalWidth || size, h = img.naturalHeight || size;
  const cnv = document.createElement("canvas");
  cnv.width=w; cnv.height=h;
  const ctx = cnv.getContext("2d", { willReadFrequently:true })!;
  ctx.drawImage(img,0,0,w,h);

  const id = ctx.getImageData(0,0,w,h);
  const d = id.data;
  const [tr,tg,tb] = hexToRgb(hex);
  const [th,ts,tv] = rgbToHsv(tr,tg,tb);
  const grayTarget = ts < 0.001;

  for (let i=0;i<d.length;i+=4){
    const a=d[i+3]; if (a===0) continue;
    const r=d[i], g=d[i+1], b=d[i+2];
    let v = Math.max(r,g,b)/255;
    v = clamp01(Math.pow(v, GAMMA) + V_GAIN);

    let nr:number, ng:number, nb:number;
    if (grayTarget){
      nr = Math.round(tr*v); ng=Math.round(tg*v); nb=Math.round(tb*v);
    } else {
      const vOut = clamp01(v*(0.5 + tv*0.5));
      [nr,ng,nb] = hsv2rgb(th,ts,vOut);
    }
    d[i]=nr; d[i+1]=ng; d[i+2]=nb;
  }
  ctx.putImageData(id,0,0);

  if (HIGHLIGHT_OPACITY>0){
    const mask = document.createElement("canvas");
    mask.width=w; mask.height=h;
    const m = mask.getContext("2d")!;
    const grad = m.createLinearGradient(0,0,0,h);
    grad.addColorStop(0,`rgba(255,255,255,${HIGHLIGHT_OPACITY})`);
    grad.addColorStop(1,"rgba(255,255,255,0)");
    m.fillStyle = grad;
    m.fillRect(0,0,w,h);
    m.globalCompositeOperation = "destination-in";
    m.drawImage(img,0,0,w,h);
    ctx.globalCompositeOperation="screen";
    ctx.drawImage(mask,0,0);
    ctx.globalCompositeOperation="source-over";
  }
  return cnv;
}
function isBrownPixel(r:number,g:number,b:number){
  const [h,s,v]=rgbToHsv(r,g,b);
  const deg=h*360;
  return (deg>=BROWN_H_MIN && deg<=BROWN_H_MAX && s>=BROWN_S_MIN && v>=BROWN_V_MIN && v<=BROWN_V_MAX);
}
async function recolorBaseOutline(baseUrl:string, hex:string, size:number){
  const img = await loadImage(baseUrl);
  const w = img.naturalWidth || size, h = img.naturalHeight || size;
  const cnv = document.createElement("canvas");
  cnv.width=w; cnv.height=h;
  const ctx = cnv.getContext("2d", { willReadFrequently:true })!;
  ctx.drawImage(img,0,0,w,h);

  const id = ctx.getImageData(0,0,w,h);
  const d = id.data;

  const [tr,tg,tb] = hexToRgb(hex);
  const [th,ts,tv] = rgbToHsv(tr,tg,tb);

  for (let i=0;i<d.length;i+=4){
    const a=d[i+3]; if (a===0) continue;
    const r=d[i], g=d[i+1], b=d[i+2];
    if (isBrownPixel(r,g,b)) continue;

    let [h,s,v]=rgbToHsv(r,g,b);
    h = (1-BASE_BLEND)*h + BASE_BLEND*th;
    s = clamp01((1-BASE_BLEND)*s + BASE_BLEND*(ts*0.85));
    v = clamp01(v*BASE_DARK_PUSH + tv*(1-BASE_DARK_PUSH)*0.25);
    const [nr,ng,nb] = hsv2rgb(h,s,v);
    d[i]=nr; d[i+1]=ng; d[i+2]=nb;
  }
  ctx.putImageData(id,0,0);
  return cnv;
}

/* caches */
const tintCache = new Map<string,string>();
const baseCache = new Map<string,string>();
async function getTint(url:string, hex:string, size:number){
  const key = `${url}|${hex}|${size}|t2`;
  const hit = tintCache.get(key); if (hit) return hit;
  const cnv = await recolorTintToHex(url, hex, size);
  const data = cnv.toDataURL("image/png");
  tintCache.set(key, data);
  return data;
}
async function getBase(url:string, hex:string, size:number){
  const key = `${url}|${hex}|${size}|b2`;
  const hit = baseCache.get(key); if (hit) return hit;
  const cnv = await recolorBaseOutline(url, hex, size);
  const data = cnv.toDataURL("image/png");
  baseCache.set(key, data);
  return data;
}

/* ================================
   Small UI for a single armour piece
   ================================ */
function ArmourPiece({
  piece,
  hex,
  size = 48,
  className = "",
  title,
}: {
  piece: "helmet" | "chestplate" | "leggings" | "boots";
  hex: string | null | undefined;
  size?: number;
  className?: string;
  title?: string;
}) {
  const tintUrl = `${ARMOUR_DIR}/${piece}_tint.png`;
  const baseUrl = `${ARMOUR_DIR}/${piece}_base.png`;
  const baseAlt = `${ARMOUR_DIR}/${piece}__base.png`;

  const [imgTint, setImgTint] = useState<string|null>(null);
  const [imgBase, setImgBase] = useState<string|null>(null);
  const [fallbackBase, setFallbackBase] = useState(false);
  const mounted = useRef(true);
  useEffect(()=>()=>{ mounted.current=false; },[]);

  useEffect(()=>{
    let cancelled=false;
    (async ()=>{
      const nhex = normHex(hex || "");
      if (!nhex) { setImgTint(null); setImgBase(null); return; }
      try {
        const [t,b] = await Promise.all([
          getTint(tintUrl, nhex, size),
          getBase(fallbackBase ? baseAlt : baseUrl, nhex, size),
        ]);
        if (!cancelled && mounted.current) { setImgTint(t); setImgBase(b); }
      } catch {
        if (!cancelled){
          if (!fallbackBase) setFallbackBase(true);
          else { setImgTint(null); setImgBase(null); }
        }
      }
    })();
    return ()=>{ cancelled=true; };
  },[tintUrl, baseUrl, baseAlt, hex, size, fallbackBase]);

  return (
    <div className={`relative ${className}`} title={title||piece} style={{ width:size, height:size }}>
      {imgTint && <img src={imgTint} alt={`${piece} tint`} className="absolute inset-0 w-full h-full object-contain select-none pointer-events-none" />}
      {imgBase && <img src={imgBase} alt={`${piece} base`} className="absolute inset-0 w-full h-full object-contain select-none pointer-events-none" />}
    </div>
  );
}

/* ================================
   Page
   ================================ */
export default function ItemsPage() {
  const [q, setQ] = useState("");
  const [hex, setHex] = useState("");
  const [tolerance, setTolerance] = useState(0);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(24);

  const [items, setItems] = useState<ItemEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string|null>(null);

  // favourites (items)
  const [favSet, setFavSet] = useState<Set<string>>(new Set());

  useEffect(() => {
    // hydrate favourites from LS on mount
    const favs = loadItemFavs();
    setFavSet(new Set(favs.map(f => f.uuid)));
  }, []);

  const apiUrl = useMemo(() => {
    const usp = new URLSearchParams();
    usp.set("page", String(page));
    usp.set("limit", String(limit));
    if (q.trim()) usp.set("q", q.trim());
    if (hex.trim()) usp.set("color", hex.trim());
    if (tolerance > 0) usp.set("tolerance", String(tolerance));
    return `/api/search?${usp.toString()}`; // change if your endpoint is different
  }, [q, hex, page, limit, tolerance]);

  useEffect(() => { setPage(1); }, [q, hex, limit, tolerance]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setErr(null);
    (async ()=>{
      try {
        const res = await fetch(apiUrl, { cache:"no-store" });
        const json: ApiResp = await res.json();
        if (!cancelled){
          if (!json.ok) { setErr(json.error || "Failed to load"); setItems([]); setTotal(0); setTotalPages(0); }
          else { setItems(json.items||[]); setTotal(json.total||0); setTotalPages(json.totalPages||0); }
        }
      } catch (e:any) {
        if (!cancelled) setErr(e?.message || String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return ()=>{ cancelled = true; };
  }, [apiUrl]);

  const toggleFav = (item: ItemEntry) => {
    setFavSet(prev => {
      const next = new Set(prev);
      if (next.has(item.uuid)) {
        next.delete(item.uuid);
        removeFavItem(item.uuid);
      } else {
        next.add(item.uuid);
        // store minimal-but-useful payload (keep what you want to show in favourites)
        upsertFavItem({
          uuid: item.uuid,
          name: item.name,
          color: item.color ?? null,
          rarity: item.rarity ?? null,
          ownerUuid: item.ownerUuid ?? null,
          ownerUsername: item.ownerUsername ?? null,
          ownerAvatarUrl: item.ownerAvatarUrl ?? null,
          ownerMcuuidUrl: item.ownerMcuuidUrl ?? null,
          ownerPlanckeUrl: item.ownerPlanckeUrl ?? null,
          ownerSkyCryptUrl: item.ownerSkyCryptUrl ?? null,
        });
      }
      return next;
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-cyan-900 via-cyan-900 to-cyan-950 text-slate-100">
      <header className="py-10 text-center">
  <h1 className="text-4xl font-extrabold tracking-tight drop-shadow" style={{ fontFamily: '"Exo 2", system-ui, sans-serif' }}>
    Gibbo&apos;s Exo&apos;s — Items
  </h1>

  {/* ▼ replace your current tabs div with this one ▼ */}
  <div className="mt-4 flex gap-3 justify-center">
    <span className="px-4 py-2 rounded-full bg-white/10 ring-1 ring-white/10 backdrop-blur-md shadow">
      All Items
    </span>
    <Link
      href="/sets"
      className="px-4 py-2 rounded-full bg-white/5 ring-1 ring-white/10 hover:bg-white/10 backdrop-blur-md transition"
    >
      Sets
    </Link>
    <Link
      href="/favourites"
      className="px-4 py-2 rounded-full bg-white/5 ring-1 ring-white/10 hover:bg-white/10 backdrop-blur-md transition"
    >
      Favourites
    </Link>
    {/* new tab */}
    <Link
      href="/old"
      className="px-4 py-2 rounded-full bg-white/5 ring-1 ring-white/10 hover:bg-white/10 backdrop-blur-md transition"
    >
      Old Dragon
    </Link>
  </div>
  {/* ▲ end replace ▲ */}
</header>
      <main className="max-w-6xl mx-auto px-4 pb-16">
        {/* Filters */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 mb-8">
          <div className="lg:col-span-4 grid grid-cols-1 sm:grid-cols-4 gap-3">
            <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Item name (e.g. Wise Dragon Helmet)" className="px-3 py-1.5 text-sm rounded-2xl bg-white/10 ring-1 ring-white/10 placeholder:text-slate-300/70 focus:outline-none focus:ring-2 focus:ring-cyan-300/40 backdrop-blur-md" />
            <input value={hex} onChange={e=>setHex(e.target.value)} placeholder="Hex (e.g. 191919 or #191919)" className="px-3 py-1.5 text-sm rounded-2xl bg-white/10 ring-1 ring-white/10 placeholder:text-slate-300/70 focus:outline-none focus:ring-2 focus:ring-cyan-300/40 backdrop-blur-md" />
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
          </div>
        </div>

        {/* Messages */}
        {err && <div className="p-3 mb-4 rounded-2xl bg-red-400/10 ring-1 ring-red-400/30 text-red-100">{err}</div>}
        {(!q.trim() && !hex.trim()) && (
          <div className="p-4 mb-4 rounded-2xl bg-white/8 ring-1 ring-white/10 backdrop-blur-xl text-center text-sm text-slate-200/90">
            Tip: enter an <strong>item name</strong> or a <strong>hex</strong> to filter.
          </div>
        )}

        {/* Results */}
        {items.length > 0 && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {items.map((it) => {
                const piece = inferPieceFromName(it.name);
                const colorHex = normHex(it.color);
                const isFav = favSet.has(it.uuid);

                return (
                  <div key={it.uuid} className="rounded-2xl bg-white/8 ring-1 ring-white/10 backdrop-blur-xl p-4 shadow-lg">
                    <div className="flex items-start gap-4">
                      {/* colour swatch */}
                      <div className="flex flex-col items-center gap-1">
                        <div className="w-10 h-10 rounded-xl ring-1 ring-white/20" style={{ backgroundColor: colorHex || "#888" }} />
                        <code className="text-[11px] text-slate-200/90">{colorHex || "—"}</code>
                      </div>

                      {/* info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold truncate text-slate-50">{it.name}</h3>
                          {it.rarity && <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 ring-1 ring-white/15 text-slate-100">{it.rarity}</span>}

                          {/* favourite toggle */}
                          <button
                            onClick={() => toggleFav(it)}
                            className={`ml-1 -mr-1 text-lg leading-none transition ${
                              isFav ? "text-yellow-300 hover:text-yellow-200" : "text-slate-400 hover:text-slate-200"
                            }`}
                            title={isFav ? "Unfavourite" : "Favourite"}
                            aria-label={isFav ? "Unfavourite item" : "Favourite item"}
                          >
                            {isFav ? "★" : "☆"}
                          </button>
                        </div>

                        {/* owner */}
                        <div className="mt-1 flex items-center gap-2 text-sm">
                          {it.ownerAvatarUrl && <img src={it.ownerAvatarUrl} width={20} height={20} alt="avatar" className="rounded-md ring-1 ring-white/20" />}
                          {it.ownerUsername ? (
                            <span className="text-slate-100">{it.ownerUsername}</span>
                          ) : it.ownerUuid ? (
                            <span className="text-slate-300/80">{it.ownerUuid.slice(0,8)}…</span>
                          ) : (
                            <span className="text-slate-300/60">No owner</span>
                          )}
                          <div className="ml-auto flex items-center gap-2">
                            {it.ownerPlanckeUrl && <a className="text-xs underline decoration-cyan-300/60 hover:decoration-cyan-300" href={it.ownerPlanckeUrl} target="_blank" rel="noreferrer">Plancke</a>}
                            {it.ownerSkyCryptUrl && <a className="text-xs underline decoration-cyan-300/60 hover:decoration-cyan-300" href={it.ownerSkyCryptUrl} target="_blank" rel="noreferrer">SkyCrypt</a>}
                            {it.ownerMcuuidUrl && <a className="text-xs underline decoration-cyan-300/60 hover:decoration-cyan-300" href={it.ownerMcuuidUrl} target="_blank" rel="noreferrer">MCUUID</a>}
                          </div>
                        </div>
                      </div>

                      {/* right: single armour sprite for this item (only if we can infer) */}
                      {piece && colorHex ? (
                        <ArmourPiece piece={piece} hex={colorHex} size={56} />
                      ) : (
                        <div className="w-[56px] h-[56px] opacity-30 flex items-center justify-center text-xs">—</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="mt-8 flex items-center justify-center gap-3">
                <button disabled={page<=1} onClick={()=>setPage(p=>Math.max(1,p-1))} className="px-4 py-2 rounded-2xl bg-white/10 ring-1 ring-white/10 hover:bg-white/15 disabled:opacity-40 backdrop-blur-md">Prev</button>
                <span className="text-sm text-slate-200/90">Page {page} / {totalPages} • {total} items</span>
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
