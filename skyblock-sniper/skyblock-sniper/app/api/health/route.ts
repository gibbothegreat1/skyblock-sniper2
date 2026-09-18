import { NextResponse } from "next/server";
import { getDb, databaseDiagnostics } from "../../../lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const db = getDb();
    const cnt = db.prepare("SELECT COUNT(*) AS c FROM items").get() as { c: number };
    const hasFts = !!db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='items_fts'
    `).get();
    const sample = db.prepare(`
      SELECT uuid, name, color, rarity FROM items ORDER BY id DESC LIMIT 3
    `).all();

    return NextResponse.json({
      ok: true,
      ...databaseDiagnostics(),
      journalMode: db.pragma("journal_mode", { simple: true }),
      queryOnly: db.pragma("query_only", { simple: true }),
      itemsCount: cnt?.c ?? 0,
      hasFts,
      sample,
    });
  } catch (err: any) {
    console.error("/api/health failed:", err);
    return NextResponse.json({
      ok: false,
      ...databaseDiagnostics(),
      error: err?.message || String(err),
      code: err?.code || null,
      stack: err?.stack || null,
    }, { status: 500 });
  }
}
