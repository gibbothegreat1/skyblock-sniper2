"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArmourPiece } from "./components/ArmourPiece";

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
  color?: string | null;
  rarity?: string | null;
  reforge?: string | null;
  hexType?: "fairy" | "crystal" | null;
  isExotic?: boolean;
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

type SearchState = {
  q: string;
  hex: string;
  tolerance: number;
  includeFairy: boolean;
  includeCrystal: boolean;
  limit: number;
};

const LS_ITEM_FAVS = "gibbo-fav-items";
const MAX_TOL = 405;

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
  try {
    localStorage.setItem(LS_ITEM_FAVS, JSON.stringify(list));
  } catch {}
}

function normHex(h?: string | null) {
  if (!h) return null;
  const x = h.trim().replace(/^#/, "");
  return /^[0-9a-fA-F]{6}$/.test(x) ? `#${x.toUpperCase()}` : null;
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

function Toggle({
  checked,
  onChange,
  title,
  subtitle,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: string;
  subtitle: string;
}) {
  return (
    <label className="filter-toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden="true"><span /></span>
      <span>
        <strong>{title}</strong>
        <small>{subtitle}</small>
      </span>
    </label>
  );
}

function Nav() {
  return (
    <nav className="top-nav" aria-label="Main navigation">
      <Link className="nav-pill active" href="/">All Items</Link>
      <Link className="nav-pill" href="/sets">Sets</Link>
      <Link className="nav-pill" href="/favourites">Favourites</Link>
      <Link className="nav-pill" href="/old">Old Dragon</Link>
    </nav>
  );
}

export default function ItemsPage() {
  const [draft, setDraft] = useState<SearchState>({
    q: "",
    hex: "",
    tolerance: 0,
    includeFairy: false,
    includeCrystal: false,
    limit: 24,
  });
  const [search, setSearch] = useState<SearchState>(draft);
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<ItemEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [favSet, setFavSet] = useState<Set<string>>(new Set());

  useEffect(() => {
    setFavSet(new Set(loadItemFavs().map((f) => f.uuid)));
  }, []);

  const apiUrl = useMemo(() => {
    const usp = new URLSearchParams();
    usp.set("page", String(page));
    usp.set("limit", String(search.limit));
    if (search.q.trim()) usp.set("q", search.q.trim());
    if (search.hex.trim()) usp.set("color", search.hex.trim());
    if (search.tolerance > 0) usp.set("tolerance", String(search.tolerance));
    if (search.includeFairy) usp.set("includeFairy", "1");
    if (search.includeCrystal) usp.set("includeCrystal", "1");
    return `/api/search?${usp.toString()}`;
  }, [page, search]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);

    (async () => {
      try {
        const res = await fetch(apiUrl, { cache: "no-store" });
        const json = (await res.json()) as ApiResp;
        if (cancelled) return;
        if (!res.ok || !json.ok) {
          setErr(json.error || `Search failed (${res.status})`);
          setItems([]);
          setTotal(0);
          setTotalPages(0);
          return;
        }
        setItems(json.items || []);
        setTotal(json.total || 0);
        setTotalPages(json.totalPages || 0);
      } catch (e) {
        if (!cancelled) {
          setErr(e instanceof Error ? e.message : "Could not connect to the search service.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [apiUrl]);

  function submitSearch(e?: FormEvent) {
    e?.preventDefault();
    setPage(1);
    setSearch({ ...draft });
  }

  function toggleFav(item: ItemEntry) {
    setFavSet((prev) => {
      const next = new Set(prev);
      const list = loadItemFavs();
      if (next.has(item.uuid)) {
        next.delete(item.uuid);
        saveItemFavs(list.filter((x) => x.uuid !== item.uuid));
      } else {
        next.add(item.uuid);
        if (!list.some((x) => x.uuid === item.uuid)) saveItemFavs([...list, item]);
      }
      return next;
    });
  }

  const hasFilters = Boolean(search.q.trim() || search.hex.trim() || search.includeFairy || search.includeCrystal || search.tolerance);

  return (
    <div className="site-shell">
      <div className="ambient ambient-a" />
      <div className="ambient ambient-b" />

      <header className="site-header">
        <div className="brand-mark">G</div>
        <div>
          <p className="eyebrow">HYPIXEL SKYBLOCK EXOTICS DATABASE</p>
          <h1>Gibbo&apos;s Exotics</h1>
          <p className="header-copy">Search armour by name and colour, compare nearby hexes, and separate true exotics from known Fairy and Crystal colours.</p>
        </div>
      </header>

      <Nav />

      <main className="content-wrap">
        <form className="search-panel" onSubmit={submitSearch}>
          <div className="search-panel-top">
            <div>
              <p className="section-kicker">ITEM SEARCH</p>
              <h2>Find a specific exotic</h2>
            </div>
            <div className="result-chip">{loading ? "Searching…" : `${total.toLocaleString()} result${total === 1 ? "" : "s"}`}</div>
          </div>

          <div className="search-grid">
            <label className="field wide-field">
              <span>Item name</span>
              <input
                value={draft.q}
                onChange={(e) => setDraft((d) => ({ ...d, q: e.target.value }))}
                placeholder="e.g. Old Dragon, Stereo Pants, Lapis"
              />
            </label>

            <label className="field hex-field">
              <span>Hex colour</span>
              <div className="hex-input-wrap">
                <i style={{ background: normHex(draft.hex) || "linear-gradient(135deg,#6ee7f9,#8b5cf6)" }} />
                <input
                  value={draft.hex}
                  onChange={(e) => setDraft((d) => ({ ...d, hex: e.target.value }))}
                  placeholder="191919"
                  maxLength={7}
                />
              </div>
            </label>

            <label className="field compact-field">
              <span>Per page</span>
              <select value={draft.limit} onChange={(e) => setDraft((d) => ({ ...d, limit: Number(e.target.value) }))}>
                <option value={12}>12</option>
                <option value={24}>24</option>
                <option value={48}>48</option>
              </select>
            </label>

            <button className="search-button" type="submit">Search</button>
          </div>

          <div className="advanced-row">
            <div className="tolerance-card">
              <div className="tolerance-heading">
                <div>
                  <strong>Nearby colour tolerance</strong>
                  <span>0 = exact hex only</span>
                </div>
                <code>{draft.tolerance}</code>
              </div>
              <input
                type="range"
                min={0}
                max={MAX_TOL}
                step={1}
                value={draft.tolerance}
                onChange={(e) => setDraft((d) => ({ ...d, tolerance: Number(e.target.value) }))}
              />
            </div>

            <div className="nonexotic-card">
              <div className="nonexotic-heading">
                <strong>Non-exotic hexes</strong>
                <span>Excluded by default</span>
              </div>
              <div className="toggle-list">
                <Toggle
                  checked={draft.includeFairy}
                  onChange={(value) => setDraft((d) => ({ ...d, includeFairy: value }))}
                  title="Include Fairy hexes"
                  subtitle="Animated Fairy armour colour cycle"
                />
                <Toggle
                  checked={draft.includeCrystal}
                  onChange={(value) => setDraft((d) => ({ ...d, includeCrystal: value }))}
                  title="Include Crystal hexes"
                  subtitle="Crystal armour light-level colours"
                />
              </div>
            </div>
          </div>
        </form>

        {err && (
          <div className="error-banner">
            <strong>Search unavailable</strong>
            <span>{err}</span>
          </div>
        )}

        {!hasFilters && !loading && (
          <div className="info-banner">
            <span className="info-icon">⌕</span>
            <div><strong>Browse the database or narrow it down.</strong><span>Try an item name, a six-digit hex, or both. Fairy and Crystal colours stay hidden unless you include them.</span></div>
          </div>
        )}

        {loading && items.length === 0 ? (
          <div className="skeleton-grid">
            {Array.from({ length: 6 }).map((_, i) => <div className="skeleton-card" key={i} />)}
          </div>
        ) : items.length > 0 ? (
          <>
            <div className="results-heading">
              <div><p className="section-kicker">RESULTS</p><h2>{hasFilters ? "Matching armour" : "Database items"}</h2></div>
              {search.hex && <span className="target-hex">Target <b>{normHex(search.hex) || search.hex}</b></span>}
            </div>

            <div className="results-grid">
              {items.map((it) => {
                const piece = inferPieceFromName(it.name);
                const colorHex = normHex(it.color);
                const isFav = favSet.has(it.uuid);
                const ownerLabel = it.ownerUsername || (it.ownerUuid ? `${it.ownerUuid.slice(0, 8)}…` : "Owner unavailable");

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
                            {it.hexType && <span className={`hex-badge ${it.hexType}`}>{it.hexType === "fairy" ? "Fairy hex" : "Crystal hex"}</span>}
                            {!it.hexType && colorHex && <span className="hex-badge exotic">Exotic hex</span>}
                          </div>
                          <h3>{it.name}</h3>
                        </div>
                        <button className={`fav-button ${isFav ? "saved" : ""}`} onClick={() => toggleFav(it)} aria-label={isFav ? "Remove favourite" : "Add favourite"}>{isFav ? "★" : "☆"}</button>
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
                    </div>
                  </article>
                );
              })}
            </div>

            {totalPages > 1 && (
              <div className="pagination">
                <button disabled={page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))}>← Previous</button>
                <span>Page <b>{page}</b> of <b>{totalPages}</b></span>
                <button disabled={page >= totalPages || loading} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next →</button>
              </div>
            )}
          </>
        ) : !err ? (
          <div className="empty-state">
            <div className="empty-orb" />
            <h3>No matching armour found</h3>
            <p>Try a different name, hex, or increase the nearby-colour tolerance.</p>
          </div>
        ) : null}
      </main>
    </div>
  );
}
