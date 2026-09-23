import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";

interface CleanedRow {
  email: string;
  name: string | null;
  company: string | null;
  designation: string | null;
  phone: string | null;
  city: string | null;
  sector: string[];
  tags: string[];
  source: string[];
  optin_status: string;
  remarks: string | null;
}

function normalizeArray(val: unknown): string[] {
  if (!Array.isArray(val)) {
    if (typeof val === "string" && val.trim()) return val.split(/[,;]/).map((s) => s.trim().toLowerCase()).filter(Boolean);
    return [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of val) {
    if (typeof t !== "string") continue;
    const tag = t.trim().toLowerCase();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

function normalizeOptinStatus(raw: string): string {
  const s = raw.trim().toLowerCase().replace(/[-_\s]+/g, " ");
  if (s === "hard bounced" || s === "hardbounced" || s === "hb" || s === "bounced") return "Hard Bounced";
  if (s === "unsubscribed" || s === "unsub" || s === "opted out") return "Unsubscribed";
  return "Subscribed";
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { rows } = body;
  if (!Array.isArray(rows) || rows.length === 0) return NextResponse.json({ error: "rows array is required" }, { status: 400 });
  if (rows.length > 500) return NextResponse.json({ error: "Maximum 500 rows per upload" }, { status: 400 });

  const cleanedRows: CleanedRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] as Record<string, unknown>;
    if (!r?.email) return NextResponse.json({ error: `Row ${i + 1} is missing required field: email` }, { status: 400 });
    cleanedRows.push({
      email: String(r.email).trim().toLowerCase(),
      name: r.name ? String(r.name).trim() : null,
      company: r.company ? String(r.company).trim() : null,
      designation: r.designation ? String(r.designation).trim() : null,
      phone: r.phone ? String(r.phone).trim() : null,
      city: r.city ? String(r.city).trim() : null,
      sector: normalizeArray(r.sector),
      tags: normalizeArray(r.tags),
      source: normalizeArray(r.source),
      optin_status: normalizeOptinStatus(r.optin_status ? String(r.optin_status).trim() : "Subscribed"),
      remarks: r.remarks ? String(r.remarks).trim() : null,
    });
  }

  // UPSERT all rows by email — if email exists, update ALL fields; if new, insert
  const { data, error } = await supabase
    .from("main_contacts")
    .upsert(cleanedRows, { onConflict: "email" })
    .select();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    inserted: data?.length ?? 0,
    upserted: data?.length ?? 0,
    total: cleanedRows.length,
  }, { status: 201 });
}
