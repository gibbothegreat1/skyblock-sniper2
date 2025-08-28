import { NextResponse } from "next/server";
import { db } from "../../../lib/db";

export const runtime = "nodejs";

export async function GET() {
  try {
    const row = db.prepare("SELECT COUNT(*) AS c FROM items").get() as { c: number };
    const one = db.prepare("SELECT uuid, name, color FROM items LIMIT 1").get();
    return NextResponse.json({ ok: true, count: row.c, sample: one });
  } catch (e:any) {
    return NextResponse.json({ ok: false, error: e.message, stack: e.stack }, { status: 500 });
  }
}
