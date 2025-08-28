"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type SetItem = {
  setLabel: string;
  color: string;
  rarity: string | null;
  ownerUuid: string | null;
  ownerUsername: string | null;
  ownerAvatarUrl: string | null;
  ownerMcuuidUrl: string | null;
  ownerPlanckeUrl: string | null;
  ownerSkyCryptUrl: string | null;
  pieces: {
    helmet: { uuid: string; name: string } | null;
    chestplate: { uuid: string; name: string } | null;
    leggings: { uuid: string; name: string } | null;
    boots: { uuid: string; name: string } | null;
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
  requiresHelmet?: boolean;
  error?: string;
};

export default function SetsPage() {
  // inputs
  const [hex, setHex] = useState("");
  const [q, setQ] = useState(""); // set keyword e.g. "wise dragon", "farm suit"

  // paging
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(24);

  // data
  const [items, setItems] = useState<SetItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const apiUrl = useMemo(() => {
    const usp = new URLSearchParams();
    usp.set("page", String(page));
    usp.set("limit", String(limit));
    if (hex.trim()) usp.set("color", hex.trim());
    if (q.trim()) usp.set("q", q.trim());
    return `/api/sets?${usp.toString()}`;
  }, [hex, q, page, limit]);

  useEffect(() => {
    // don’t call until both fields have something
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

  // Reset to page 1 when filters change
  useEffect(() => { setPage(1); }, [hex, q, limit]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-cyan-900 via-cyan-900 to-cyan-950 text-slate-100">
      <header className="py-10 text-center">
        <h1
          className="text-4xl font-extrabold tracking-tight drop-shadow"
          style={{ fontFamily: '"Exo 2", system-ui, sans-serif' }}
        >
          Gibbo&apos;s Exo&apos;s — Sets
        </h1>
        <p className="mt-2 text-sm text-cyan-200/80">Search complete sets by hex + set name (per owner)</p>

        <div className="mt-4 flex gap-3 justify-center">
          <Link
            href="/"
            className="px-4 py-2 rounded-full bg-white/5 ring-1 ring-white/10 hover:bg-white/10 backdrop-blur-md transition"
          >
            All Items
          </Link>
          <Link
            href="/favourites"
            className="px-4 py-2 rounded-full bg-white/5 ring-1 ring-white/10 hover:bg-white/10 backdrop-blur-md transition"
          >
            Favourites
          </Link>
          <span className="px-4 py-2 rounded-full bg-white/10 ring-1 ring-white/10 backdrop-blur-md shadow">
            Sets
          </span>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 pb-16">
        {/* filters */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-8">
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

        {/* hint */}
        {!hex.trim() || !q.trim() ? (
          <div className="p-4 rounded-2xl bg-white/8 ring-1 ring-white/10 backdrop-blur-xl text-center text-sm text-slate-200/90">
            Enter a <strong>set name</strong> and an <strong>exact hex</strong> to find complete sets owned by the same player.
            <div className="mt-1 opacity-80">Dragon sets return <em>Chestplate + Leggings + Boots</em>. Others (e.g. Farm Suit) return all four pieces.</div>
          </div>
        ) : null}

        {/* error */}
        {err && (
          <div className="p-3 mb-4 rounded-2xl bg-red-400/10 ring-1 ring-red-400/30 text-red-100">
            {err}
          </div>
        )}

        {/* results */}
        {!err && items.length > 0 && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {items.map((it, idx) => (
                <div key={idx} className="rounded-2xl bg-white/8 ring-1 ring-white/10 backdrop-blur-xl p-4 shadow-lg">
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
                      </div>

                      {/* owner + links */}
                      <div className="mt-1 flex items-center gap-2 text-sm">
                        {it.ownerAvatarUrl && (
                          <img
                            src={it.ownerAvatarUrl}
                            width={20}
                            height={20}
                            alt="avatar"
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

                      {/* pieces table */}
                      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                        {it.pieces.helmet && (
                          <div className="rounded-xl bg-white/10 ring-1 ring-white/15 p-2">
                            <div className="text-xs opacity-80">Helmet</div>
                            <div className="font-medium truncate">{it.pieces.helmet.name}</div>
                          </div>
                        )}
                        {it.pieces.chestplate && (
                          <div className="rounded-xl bg-white/10 ring-1 ring-white/15 p-2">
                            <div className="text-xs opacity-80">Chestplate</div>
                            <div className="font-medium truncate">{it.pieces.chestplate.name}</div>
                          </div>
                        )}
                        {it.pieces.leggings && (
                          <div className="rounded-xl bg-white/10 ring-1 ring-white/15 p-2">
                            <div className="text-xs opacity-80">Leggings</div>
                            <div className="font-medium truncate">{it.pieces.leggings.name}</div>
                          </div>
                        )}
                        {it.pieces.boots && (
                          <div className="rounded-xl bg-white/10 ring-1 ring-white/15 p-2">
                            <div className="text-xs opacity-80">Boots</div>
                            <div className="font-medium truncate">{it.pieces.boots.name}</div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
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
                <span className="text-sm text-slate-200/90">
                  Page {page} / {totalPages} &nbsp;•&nbsp; {total} sets
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
          </>
        )}

        {loading && <div className="mt-6 text-center text-sm text-slate-300/80">Loading…</div>}
      </main>
    </div>
  );
}
