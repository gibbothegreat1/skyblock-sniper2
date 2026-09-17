"use client";

import { useState } from "react";

type Target = { uuid?: string | null; name: string; color?: string | null };
type CheckStatus = "idle" | "loading" | "still_has" | "missing" | "api_off";

export default function CheckMeButton({
  ownerUsername,
  ownerUuid,
  target,
  targets,
  className = "",
}: {
  ownerUsername?: string | null;
  ownerUuid?: string | null;
  target?: Target;
  targets?: Target[];
  className?: string;
}) {
  const [status, setStatus] = useState<CheckStatus>("idle");
  const [detail, setDetail] = useState<string>("");

  async function check() {
    if (!ownerUsername && !ownerUuid) {
      setStatus("api_off");
      setDetail("No player IGN/UUID is available for this record.");
      return;
    }
    const payloadTargets = targets?.length ? targets : target ? [target] : [];
    if (!payloadTargets.length) return;

    setStatus("loading");
    setDetail("");
    try {
      const res = await fetch("/api/check-exotico", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ign: ownerUsername || null, ownerUuid: ownerUuid || null, targets: payloadTargets }),
      });
      const json = await res.json();
      const next = (json?.status || "api_off") as CheckStatus;
      setStatus(next);
      setDetail(json?.detail || "");
    } catch {
      setStatus("api_off");
      setDetail("Could not reach Exotico.");
    }
  }

  const label = status === "loading" ? "Checking…"
    : status === "still_has" ? "STILL HAS"
    : status === "missing" ? "UNLUCKY NERD, SHIT'S SNIPED OR WIPED XD"
    : status === "api_off" ? "API off, check yourself"
    : "Check me";

  return (
    <div className={`check-me-wrap ${className}`} title={detail || undefined}>
      <button type="button" onClick={check} disabled={status === "loading"} className={`check-me-button ${status}`}>
        {label}
      </button>
      {(status === "still_has" || status === "api_off") && detail ? <span className="check-me-detail">{detail}</span> : null}
      {status === "api_off" && ownerUsername ? (
        <a className="check-me-link" href={`https://exotico.flori.tv/?player=${encodeURIComponent(ownerUsername)}`} target="_blank" rel="noreferrer">Open Exotico ↗</a>
      ) : null}
    </div>
  );
}
