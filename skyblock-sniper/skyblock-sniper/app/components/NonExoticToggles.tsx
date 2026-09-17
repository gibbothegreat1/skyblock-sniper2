"use client";

export default function NonExoticToggles({
  includeFairy,
  includeCrystal,
  onFairy,
  onCrystal,
  compact = false,
}: {
  includeFairy: boolean;
  includeCrystal: boolean;
  onFairy: (value: boolean) => void;
  onCrystal: (value: boolean) => void;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "nonexotic-inline" : "nonexotic-card"}>
      {!compact && <div className="nonexotic-heading"><strong>Non-exotic hexes</strong><span>Excluded by default</span></div>}
      <div className={compact ? "nonexotic-inline-list" : "toggle-list"}>
        <label className="filter-toggle">
          <input type="checkbox" checked={includeFairy} onChange={(e) => onFairy(e.target.checked)} />
          <span className="toggle-track" aria-hidden="true"><span /></span>
          <span><strong>Fairy</strong>{!compact && <small>Include Fairy cycle colours</small>}</span>
        </label>
        <label className="filter-toggle">
          <input type="checkbox" checked={includeCrystal} onChange={(e) => onCrystal(e.target.checked)} />
          <span className="toggle-track" aria-hidden="true"><span /></span>
          <span><strong>Crystal</strong>{!compact && <small>Include Crystal light colours</small>}</span>
        </label>
      </div>
    </div>
  );
}
