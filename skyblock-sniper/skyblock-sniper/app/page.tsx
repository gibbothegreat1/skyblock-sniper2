"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import Link from "next/link";

/* -------------------- Types -------------------- */
type Item = {
  id: number;
  uuid: string;
  name: string;
  color?: string | null;
  rarity?: string | null;
  price?: number | null;
  reforge: string;
  ownerUuid: string | null;
  ownerUsername: string | null;
  ownerAvatarUrl: string | null;
  ownerMcuuidUrl: string | null;
  ownerPlanckeUrl: string | null;
  ownerSkyCryptUrl: string | null;
};

type ApiResp = {
  ok: boolean;
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  items: Item[];
  targetHex?: string | null;
  tolerance?: number;
  error?: string;
};

/* -------------------- Consts -------------------- */
const LS_KEY = "gibbo-favs";
const MAX_TOL = 405;

/* -------------------- Page -------------------- */
export default function HomePage() {
  // Filters
  const [q, setQ] = useState<string>("");
  const [hex, setHex] = useState<string>("");
  const [piece, setPiece] = useState<"all" | "helmet" | "chestplate" | "leggings" | "boots">("all");
  const [tolerance, setTolerance] = useState<number>(0);

  // Pagination
  const [page, setPage] = useState<number>(1);
  const [limit, setLimit] = useState<number>(50);

  // Data
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [err, setErr] = useState<string | null>(null);

  // Favourites
  const [favs, setFavs] = useState<string[]>([]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      setFavs(Array.isArray(arr) ? arr.filter(Boolean) : []);
    } catch {
      setFavs([]);
    }
  }, []);
  const toggleFav = useCallback((uuid: string) => {
    setFavs((prev) => {
      const has = prev.includes(uuid);
      const next = has ? prev.filter((u) => u !== uuid) : [...prev, uuid];
      try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);
  const isFav = (uuid: string) => favs.includes(uuid);

  // Build API URL
  const apiUrl = useMemo(() => {
    const usp = new URLSearchParams();
    usp.set("limit", String(limit));
    usp.set("page", String(page));
    if (q.trim()) usp.set("q", q.trim());
    if (hex.trim()) usp.set("color", hex.trim());
    if (piece !== "all") usp.set("piece", piece);
    if (tolerance > 0) usp.set("tolerance", String(tolerance));
    return `/api/search?${usp.toString()}`;
  }, [q, hex, piece, page, limit, tolerance]);

  // Fetch data
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const res = await fetch(apiUrl, { cache: "no-store" });
        const json: ApiResp = await res.json();
        if (!cancelled) {
          if (!json.ok) {
            setErr(json.error || "Failed to load");
            setItems([]);
            setTotal(0);
            setTotalPages(0);
          } else {
            setItems(json.items || []);
            setTotal(json.total || 0);
            setTotalPages(json.totalPages || 0);
          }
        }
      } catch (e: any) {
        if (!cancelled) {
          setErr(e?.message || String(e));
          setItems([]);
          setTotal(0);
          setTotalPages(0);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [apiUrl]);

  // Reset to page 1 when filters change
  useEffect(() => { setPage(1); }, [q, hex, piece, limit, tolerance]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-cyan-900 via-cyan-900 to-cyan-950 text-slate-100">
      <header className="py-10 text-center">
        <h1
          className="text-4xl font-extrabold tracking-tight drop-shadow"
          style={{ fontFamily: '"Exo 2", system-ui, sans-serif' }}
        >
          Gibbo&apos;s Exo&apos;s
        </h1>
        <p className="mt-2 text-sm text-cyan-200/80">gibbo is the greatest (sniper) lel</p>

        {/* Tabs (links) */}
<div className="mt-6 flex gap-3 justify-center">
  <span className="px-4 py-2 rounded-full bg-white/10 ring-1 ring-white/10 backdrop-blur-md shadow">
    All
  </span>
  <Link
    href="/favourites"
    className="px-4 py-2 rounded-full bg-white/5 ring-1 ring-white/10 hover:bg-white/10 backdrop-blur-md transition"
    title={favs.length ? `${favs.length} favourites` : "Favourites"}
  >
    Favourites {favs.length ? `(${favs.length})` : ""}
  </Link>
  <Link
    href="/sets"
    className="px-4 py-2 rounded-full bg-white/5 ring-1 ring-white/10 hover:bg-white/10 backdrop-blur-md transition"
  >
    Sets
  </Link>
</div>
      </header>

      <main className="max-w-6xl mx-auto px-4 pb-16">
        {/* Filters panel */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 mb-8">
          <div className="lg:col-span-4 grid grid-cols-1 sm:grid-cols-4 gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name (e.g. Necron, Helmet)"
              className="px-3 py-1 text-xs rounded-2xl bg-white/10 ring-1 ring-white/10 placeholder:text-slate-300/70 focus:outline-none focus:ring-2 focus:ring-cyan-300/40 backdrop-blur-md"
            />
            <input
              value={hex}
              onChange={(e) => setHex(e.target.value)}
              placeholder="Exact hex (e.g. 191919 or #191919)"
              className="px-3 py-1 text-xs rounded-2xl bg-white/10 ring-1 ring-white/10 text-slate-100 focus:outline-none focus:ring-2 focus:ring-cyan-300/40 backdrop-blur-md"
            />
            <select
              value={piece}
              onChange={(e) => setPiece(e.target.value as any)}
              // piece dropdown text explicitly black
              className="px-3 py-2 rounded-2xl bg-white/10 ring-1 ring-white/10 text-slate-100 focus:outline-none focus:ring-2 focus:ring-cyan-300/40 backdrop-blur-md"
            >
              <option value="all">All pieces</option>
              <option value="helmet">Helmet</option>
              <option value="chestplate">Chestplate</option>
              <option value="leggings">Leggings</option>
              <option value="boots">Boots</option>
            </select>

            <div className="flex items-center gap-2">
              <label className="text-xs text-cyan-200/80">Per page</label>
              <select
                value={limit}
                onChange={(e) => setLimit(parseInt(e.target.value, 10))}
                className="px-3 py-1 text-xs rounded-2xl bg-white/10 ring-1 ring-white/10 text-slate-100 focus:outline-none focus:ring-2 focus:ring-cyan-300/40 backdrop-blur-md"
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </div>
          </div>

          {/* Tolerance slider (no extra description line) */}
          <div className="lg:col-span-1 rounded-2xl bg-white/10 ring-1 ring-white/10 p-3 backdrop-blur-md">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-cyan-200/80">Nearby tolerance</span>
              <code className="text-[10px] text-cyan-200/90">{tolerance}</code>
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
          </div>
        </div>

        {/* Error */}
        {err && (
          <div className="p-3 mb-4 rounded-2xl bg-red-400/10 ring-1 ring-red-400/30 text-red-100">
            {err}
          </div>
        )}

        {/* Results */}
        {!err && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {items.map((it) => {
              const fav = isFav(it.uuid);
              return (
                <div
                  key={it.uuid}
                  className="rounded-2xl bg-white/8 ring-1 ring-white/10 backdrop-blur-xl p-4 flex gap-4 items-center shadow-lg"
                >
                  {/* color swatch + hex */}
                  <div className="flex flex-col items-center gap-1">
                    <div
                      className="w-12 h-12 rounded-xl ring-1 ring-white/20"
                      title={it.color || ""}
                      style={{ backgroundColor: it.color || "#ddd" }}
                    />
                    <code className="text-[11px] text-slate-200/90">{it.color || "—"}</code>
                  </div>

                  {/* main info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold truncate text-slate-50">{it.name}</h3>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 ring-1 ring-white/15 text-slate-100">
                        {it.reforge || "Clean"}
                      </span>
                      {it.rarity && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 ring-1 ring-white/15 text-slate-100">
                          {it.rarity}
                        </span>
                      )}
                    </div>

                    {/* owner row with username + links */}
                    <div className="mt-1 flex items-center gap-2 text-sm">
                      {it.ownerAvatarUrl && (
                        <img
                          src={it.ownerAvatarUrl}
                          alt="avatar"
                          width={20}
                          height={20}
                          className="rounded-md ring-1 ring-white/20"
                        />
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
                          <a
                            className="text-xs underline decoration-cyan-300/60 hover:decoration-cyan-300"
                            href={it.ownerPlanckeUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Plancke
                          </a>
                        )}
                        {it.ownerSkyCryptUrl && (
                          <a
                            className="text-xs underline decoration-cyan-300/60 hover:decoration-cyan-300"
                            href={it.ownerSkyCryptUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            SkyCrypt
                          </a>
                        )}
                        {it.ownerMcuuidUrl && (
                          <a
                            className="text-xs underline decoration-cyan-300/60 hover:decoration-cyan-300"
                            href={it.ownerMcuuidUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            MCUUID
                          </a>
                        )}
                      </div>
                    </div>

                    <div className="mt-1 text-[11px] text-slate-300/80">
                      UUID: <code className="break-all">{it.uuid}</code>
                    </div>
                  </div>

                  {/* favourite toggle */}
                  <button
                    onClick={() => toggleFav(it.uuid)}
                    className={`shrink-0 text-2xl leading-none ${fav ? "text-yellow-300 drop-shadow" : "text-slate-400 hover:text-yellow-300"}`}
                    title={fav ? "Remove from favourites" : "Add to favourites"}
                    aria-label={fav ? "Unfavourite" : "Favourite"}
                  >
                    ★
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {!loading && !err && totalPages > 1 && (
          <div className="mt-8 flex items-center justify-center gap-3">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="px-4 py-2 rounded-2xl bg-white/10 ring-1 ring-white/10 hover:bg-white/15 disabled:opacity-40 backdrop-blur-md"
            >
              Prev
            </button>
            <span className="text-sm text-slate-200/90">
              Page {page} / {totalPages} &nbsp;•&nbsp; {total} items
            </span>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="px-4 py-2 rounded-2xl bg-white/10 ring-1 ring-white/10 hover:bg-white/15 disabled:opacity-40 backdrop-blur-md"
            >
              Next
            </button>
          </div>
        )}

        {loading && <div className="mt-6 text-center text-sm text-slate-300/80">Loading…</div>}
      </main>
    </div>
  );
}



