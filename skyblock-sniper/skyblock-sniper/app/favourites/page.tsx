"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

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

const LS_KEY = "gibbo-favs";

export default function FavouritesPage() {
  // pagination
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);

  // local favourites
  const [favs, setFavs] = useState<string[]>([]);

  // data state
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // read favourites from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      setFavs(Array.isArray(arr) ? arr.filter(Boolean) : []);
    } catch {
      setFavs([]);
    }
  }, []);

  const apiUrl = useMemo(() => {
    const usp = new URLSearchParams();
    usp.set("limit", String(limit));
    usp.set("page", String(page));
    usp.set("uuids", favs.join(",")); // only favourites
    return `/api/search?${usp.toString()}`;
  }, [page, limit, favs]);

  useEffect(() => {
    if (!favs.length) {
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
  }, [apiUrl, favs.length]);

  const removeFav = (uuid: string) => {
    const next = favs.filter((u) => u !== uuid);
    setFavs(next);
    try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch {}
    setPage(1);
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
            Favourites {favs.length ? `(${favs.length})` : ""}
          </span>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 pb-16">
        {/* Per page control */}
        <div className="mb-6 flex items-center gap-3">
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

        {/* Empty state */}
        {favs.length === 0 && (
          <div className="p-6 rounded-2xl bg-white/8 ring-1 ring-white/10 backdrop-blur-xl text-center">
            <p>You don’t have any favourites yet.</p>
            <p className="text-sm text-slate-300/80 mt-1">
              Go to the <Link href="/" className="underline decoration-cyan-300/60 hover:decoration-cyan-300">All</Link> tab and click the ★ on any item.
            </p>
          </div>
        )}

        {/* Error */}
        {err && (
          <div className="p-3 mb-4 rounded-2xl bg-red-400/10 ring-1 ring-red-400/30 text-red-100">{err}</div>
        )}

        {/* Results */}
        {!err && favs.length > 0 && (
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
                    onClick={() => removeFav(it.uuid)}
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
      </main>
    </div>
  );
}
