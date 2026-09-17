import { NextResponse } from "next/server";
import { db, dbPath, fileExists } from "../../../lib/db";
import path from "node:path";

export const runtime = "nodejs";

export async function GET() {
  try {
    // counts
    const cnt = db.prepare("SELECT COUNT(*) AS c FROM items").get() as { c: number };
    const hasFts = !!db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='items_fts'
    `).get();

    // sample rows
    const sample = db.prepare(`
      SELECT uuid, name, color, rarity FROM items ORDER BY id DESC LIMIT 3
    `).all();

    return NextResponse.json({
      ok: true,
      nodeEnv: process.env.NODE_ENV,
      cwd: process.cwd(),
      dbPath,
      dbExists: fileExists(),
      itemsCount: cnt?.c ?? 0,
      hasFts,
      sample,
      note: "If itemsCount is 0 or dbExists=false, the bundled DB didn't make it or path is wrong.",
    });
  } catch (err: any) {
    return NextResponse.json({
      ok: false,
      error: err?.message || String(err),
      cwd: process.cwd(),
      dbPath,
      dbExists: fileExists(),
    }, { status: 500 });
  }
}