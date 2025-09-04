"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { SetItem } from "../sets/page"; // reuse the type

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
  error?: string;
};

const LS_ITEMS = "gibbo-favs";
const LS_SETS = "gibbo-fav-sets";

type FavSet = SetItem & { favKey: string };

export default function FavouritesPage() {
  // pagination (items only)
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);

  // local favourites
  const [favItemUuids, setFavItemUuids] = useState<string[]>([]);
  const [favSets, setFavSets] = useState<FavSet[]>([]);
  const favTotal = favItemUuids.length + favSets.length;

  // data state (items from API)
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // read favourites from localStorage
  useEffect(() => {
    try {
      const rawItems = localStorage.getItem(LS_ITEMS);
      const arr = rawItems ? JSON.parse(rawItems) : [];
      setFavItemUuids(Array.isArray(arr) ? arr.filter(Boolean) : []);
    } catch {
      setFavItemUuids([]);
    }
    try {
      const rawSets = localStorage.getItem(LS_SETS);
      const arr2 = rawSets ? JSON.parse(rawSets) : [];
      const safe: FavSet[] = Array.isArray(arr2) ? arr2.filter(Boolean) : [];
      setFavSets(safe);
    } catch {
      setFavSets([]);
    }
  }, []);

  const apiUrl = useMemo(() => {
    const usp = new URLSearchParams();
    usp.set("limit", String(limit));
    usp.set("page", String(page));
    usp.set("uuids", favItemUuids.join(",")); // only item favourites
    return `/api/search?${usp.toString()}`;
  }, [page, limit, favItemUuids]);

  useEffect(() => {
    if (!favItemUuids.length) {
      setItems([]); setTotal(0); setTotalPages(0);
      return;
    }
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
  }, [apiUrl, favItemUuids.length]);

  const removeItemFav = (uuid: string) => {
    const next = favItemUuids.filter((u) => u !== uuid);
    setFavItemUuids(next);
    try { localStorage.setItem(LS_ITEMS, JSON.stringify(next)); } catch {}
    setPage(1);
  };

  const removeSetFav = (favKey: string) => {
    const next = favSets.filter((s) => s.favKey !== favKey);
    setFavSets(next);
    try { localStorage.setItem(LS_SETS, JSON.stringify(next)); } catch {}
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-cyan-900 via-cyan-900 to-cyan-950 text-slate-100">
      <header className="py-10 text-center">
        <h1 className="text-4xl font-extrabold tracking-tight drop-shadow" style={{ fontFamily: '"Exo 2", system-ui, sans-serif' }}>
          Gibbo&apos;s Exo&apos;s
        </h1>
        <p className="mt-2 text-sm text-cyan-200/80">gibbo is the greatest (sniper) lel</p>

        {/* Tabs */}
        <div className="mt-6 flex gap-3 justify-center">
          <Link
            href="/"
            className="px-4 py-2 rounded-full bg-white/5 ring-1 ring-white/10 hover:bg-white/10 backdrop-blur-md transition"
          >
            All
          </Link>
          <span className="px-4 py-2 rounded-full bg-white/10 ring-1 ring-white/10 backdrop-blur-md shadow">
            Favourites {favTotal ? `(${favTotal})` : ""}
          </span>
          <Link
            href="/sets"
            className="px-4 py-2 rounded-full bg-white/5 ring-1 ring-white/10 hover:bg-white/10 backdrop-blur-md transition"
          >
            Sets
          </Link>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 pb-16">
        {/* Empty state */}
        {favItemUuids.length === 0 && favSets.length === 0 && (
          <div className="p-6 rounded-2xl bg-white/8 ring-1 ring-white/10 backdrop-blur-xl text-center">
            <p>You don’t have any favourites yet.</p>
            <p className="text-sm text-slate-300/80 mt-1">
              Go to <Link href="/" className="underline decoration-cyan-300/60 hover:decoration-cyan-300">All</Link> to ★ items, or to <Link href="/sets" className="underline decoration-cyan-300/60 hover:decoration-cyan-300">Sets</Link> to ★ full sets.
            </p>
          </div>
        )}

        {/* Favourite Sets */}
        {favSets.length > 0 && (
          <>
            <h2 className="mt-4 mb-3 text-lg font-semibold">Favourite Sets ({favSets.length})</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {favSets.map((it) => (
                <div key={it.favKey} className="rounded-2xl bg-white/8 ring-1 ring-white/10 backdrop-blur-xl p-4 shadow-lg">
                  <div className="flex items-start gap-3">
                    {/* color swatch */}
                    <div className="flex flex-col items-center gap-1">
                      <div
                        className="w-10 h-10 rounded-xl ring-1 ring-white/20"
                        style={{ backgroundColor: it.color }}
                        title={it.color}
                      />
                      <code className="text-[11px] text-slate-200/90">{it.color}</code>
                    </div>

                    {/* set header */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold truncate text-slate-50">{it.setLabel}</h3>
                        {it.rarity && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 ring-1 ring-white/15 text-slate-100">
                            {it.rarity}
                          </span>
                        )}
                        {it.isExact ? (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-400/15 text-emerald-200 ring-1 ring-emerald-400/25">
                            exact
                          </span>
                        ) : typeof it.avgDist === "number" ? (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-slate-100 ring-1 ring-white/15">
                            avg {it.avgDist}
                          </span>
                        ) : null}
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

                      {/* pieces grid */}
                      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                        {it.pieces.helmet && (
                          <div className="rounded-xl bg-white/10 ring-1 ring-white/15 p-2">
                            <div className="text-xs opacity-80">Helmet</div>
                            <div className="font-medium truncate">{it.pieces.helmet.name}</div>
                            <code className="text-[11px] opacity-90">{it.pieces.helmet.color}</code>
                          </div>
                        )}
                        {it.pieces.chestplate && (
                          <div className="rounded-xl bg-white/10 ring-1 ring-white/15 p-2">
                            <div className="text-xs opacity-80">Chestplate</div>
                            <div className="font-medium truncate">{it.pieces.chestplate.name}</div>
                            <code className="text-[11px] opacity-90">{it.pieces.chestplate.color}</code>
                          </div>
                        )}
                        {it.pieces.leggings && (
                          <div className="rounded-xl bg-white/10 ring-1 ring-white/15 p-2">
                            <div className="text-xs opacity-80">Leggings</div>
                            <div className="font-medium truncate">{it.pieces.leggings.name}</div>
                            <code className="text-[11px] opacity-90">{it.pieces.leggings.color}</code>
                          </div>
                        )}
                        {it.pieces.boots && (
                          <div className="rounded-xl bg-white/10 ring-1 ring-white/15 p-2">
                            <div className="text-xs opacity-80">Boots</div>
                            <div className="font-medium truncate">{it.pieces.boots.name}</div>
                            <code className="text-[11px] opacity-90">{it.pieces.boots.color}</code>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* unfavourite set */}
                    <button
                      onClick={() => removeSetFav(it.favKey)}
                      className="shrink-0 text-2xl leading-none text-yellow-300"
                      title="Remove set from favourites"
                      aria-label="Unfavourite set"
                    >
                      ★
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Favourite Items */}
        {favItemUuids.length > 0 && (
          <>
            <div className="mt-10 mb-4 flex items-center gap-3">
              <h2 className="text-lg font-semibold">Favourite Items</h2>
              <span className="text-sm text-cyan-200/80">(showing {items.length} of {favItemUuids.length})</span>
              <div className="ml-auto flex items-center gap-3">
                <span className="text-sm text-cyan-200/80">Per page</span>
                <select
                  value={limit}
                  onChange={(e) => { setLimit(parseInt(e.target.value, 10)); setPage(1); }}
                  className="px-3 py-2 rounded-2xl bg-white/10 ring-1 ring-white/10 text-slate-100 focus:outline-none focus:ring-2 focus:ring-cyan-300/40 backdrop-blur-md"
                >
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </div>
            </div>

            {/* Error */}
            {err && (
              <div className="p-3 mb-4 rounded-2xl bg-red-400/10 ring-1 ring-red-400/30 text-red-100">{err}</div>
            )}

            {/* Results */}
            {!err && (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {items.map((it) => (
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

                      {/* info */}
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

                        {/* owner row */}
                        <div className="mt-1 flex items-center gap-2 text-sm">
                          {it.ownerAvatarUrl && (
                            <img src={it.ownerAvatarUrl} alt="avatar" width={20} height={20} className="rounded-md ring-1 ring-white/20" />
                          )}
                          {it.ownerUsername
                            ? <span className="text-slate-100">{it.ownerUsername}</span>
                            : it.ownerUuid
                              ? <span className="text-slate-300/80">{it.ownerUuid.slice(0, 8)}…</span>
                              : <span className="text-slate-300/60">No owner</span>
                          }

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

                        <div className="mt-1 text-[11px] text-slate-300/80">
                          UUID: <code className="break-all">{it.uuid}</code>
                        </div>
                      </div>

                      {/* unfavourite */}
                      <button
                        onClick={() => removeItemFav(it.uuid)}
                        className="shrink-0 text-2xl leading-none text-yellow-300"
                        title="Remove from favourites"
                        aria-label="Unfavourite"
                      >
                        ★
                      </button>
                    </div>
                  ))}
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
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
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
