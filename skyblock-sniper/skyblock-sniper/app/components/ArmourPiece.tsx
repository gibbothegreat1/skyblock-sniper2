"use client";

import { useEffect, useRef, useState } from "react";

/** Public API */
export function ArmourPiece({
  piece,            // "helmet" | "chestplate" | "leggings" | "boots"
  hex,              // "#RRGGBB" (or "RRGGBB")
  size = 48,        // tweak per your card layout
  title,
  className = "",
}: {
  piece: "helmet" | "chestplate" | "leggings" | "boots";
  hex: string | null | undefined;
  size?: number;
  title?: string;
  className?: string;
}) {
  const tintUrl = `/images/armor/${piece}_tint.png`;
  const baseUrl = `/images/armor/${piece}_base.png`;
  const baseAlt = `/images/armor/${piece}__base.png`; // optional fallback

  const [imgTint, setImgTint] = useState<string | null>(null);
  const [imgBase, setImgBase] = useState<string | null>(null);
  const [fallbackBase, setFallbackBase] = useState(false);
  const mounted = useRef(true);

  useEffect(() => () => { mounted.current = false; }, []);

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
    <div className={`relative ${className}`} title={title} style={{ width: size, height: size }}>
      {imgTint && <img src={imgTint} alt={`${piece} tint`} className="absolute inset-0 w-full h-full object-contain select-none pointer-events-none" />}
      {imgBase && <img src={imgBase} alt={`${piece} base`} className="absolute inset-0 w-full h-full object-contain select-none pointer-events-none" />}
    </div>
  );
}

/* =========================
   Internals (same tuning as Sets)
   ========================= */
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

function normHex(h?: string | null) {
  if (!h) return null;
  const x = h.trim().replace(/^#/, "");
  return /^[0-9a-fA-F]{6}$/.test(x) ? `#${x.toLowerCase()}` : null;
}
function hexToRgb(h: string) {
  const x = h.replace("#", "");
  return [parseInt(x.slice(0,2),16), parseInt(x.slice(2,4),16), parseInt(x.slice(4,6),16)] as [number,number,number];
}
function rgbToHsv(r: number, g: number, b: number) {
  r/=255; g/=255; b/=255;
  const max = Math.max(r,g,b), min = Math.min(r,g,b), d = max-min;
  let h = 0;
  if (d !== 0) {
    switch(max){
      case r: h = ((g-b)/d + (g<b ? 6:0)); break;
      case g: h = (b-r)/d + 2; break;
      default: h = (r-g)/d + 4;
    }
    h /= 6;
  }
  const s = max === 0 ? 0 : (d/max);
  return [h, s, max] as [number,number,number];
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
  return [Math.round(r*255), Math.round(b*255), Math.round(b*255)] as any; // will be overridden below
}
function hsv2rgb(h: number, s: number, v: number) {
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

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.decoding = "sync";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/* ============== tint recolour (under) ============== */
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
      [nr,ng,nb] = hsv2rgb(th, ts, vOut);
    }
    d[i]=nr; d[i+1]=ng; d[i+2]=nb;
  }
  ctx.putImageData(image, 0, 0);

  // masked highlight (no halo)
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

/* ============== base outline recolour (over) ============== */
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

    const [nr,ng,nb] = hsv2rgb(h,s,v);
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
