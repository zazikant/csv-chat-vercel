import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

/** Normalize a text[] field — accepts string, string[], or null. */
function normalizeArray(val: unknown): string[] {
  if (!Array.isArray(val)) return [];
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

function normalizeOptinStatus(raw: string | undefined | null): string {
  const s = (raw ?? "").trim().toLowerCase().replace(/[-_\s]+/g, " ");
  if (s === "hard bounced" || s === "hardbounced" || s === "hb" || s === "bounced" || s === "hard") return "Hard Bounced";
  if (s === "unsubscribed" || s === "unsub" || s === "opted out" || s === "opt out") return "Unsubscribed";
  return "Subscribed";
}

/** Fetch the actual column names that exist in main_contacts. */
async function getExistingColumns(): Promise<Set<string>> {
  // Don't cache — Vercel serverless instances may have stale cache from
  // before a schema migration was run. Querying information_schema is fast.
  const { data, error } = await supabase.rpc("run_select_query", {
    query_text: "SELECT column_name FROM information_schema.columns WHERE table_name = 'main_contacts' AND table_schema = 'public'",
  });
  if (error || !data) {
    return new Set(["email","name","company","designation","phone","city","sector","tags","source","optin_status","remarks","created_at","updated_at"]);
  }
  let rows = typeof data === "string" ? JSON.parse(data) : data;
  if (rows && typeof rows === "object" && !Array.isArray(rows)) rows = Object.values(rows)[0];
  const cols = new Set<string>();
  for (const r of (rows as Array<Record<string, string>>) ?? []) {
    if (r?.column_name) cols.add(r.column_name);
  }
  return cols;
}

/** Strip fields from the payload that don't exist in the DB (silently skip
 *  so the app works even before the schema migration is run). */
async function stripUnknownFields(obj: Record<string, unknown>): Promise<Record<string, unknown>> {
  const cols = await getExistingColumns();
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (cols.has(k)) out[k] = v;
  }
  return out;
}

export async function GET() {
  const { data, error } = await supabase
    .from("main_contacts")
    .select("*")
    .order("email", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  if (!body?.email) return NextResponse.json({ error: "email is required" }, { status: 400 });
  body.email = String(body.email).trim().toLowerCase();

  // Normalize array fields — but handle sector specially:
  // If the DB column is text (not text[]), convert array to comma-separated string.
  const cols = await getExistingColumns();
  // Check if sector is text or text[] by trying to insert an array
  // For now, just send the array and let Supabase handle it.
  // If sector column is text, Supabase will reject array — we catch and retry.
  if (body.tags !== undefined) body.tags = normalizeArray(body.tags);
  if (body.sector !== undefined) body.sector = normalizeArray(body.sector);
  if (body.source !== undefined) body.source = normalizeArray(body.source);
  if (body.optin_status !== undefined) body.optin_status = normalizeOptinStatus(body.optin_status);

  for (const f of ["created_at", "updated_at"]) delete body[f];

  // Strip fields that don't exist in the DB yet (graceful schema mismatch)
  const cleanBody = await stripUnknownFields(body);

  let { data, error } = await supabase
    .from("main_contacts")
    .upsert(cleanBody, { onConflict: "email" })
    .select()
    .single();

  // If sector failed because column is text not text[], retry with string
  if (error && error.message.includes("sector") && cleanBody.sector !== undefined) {
    cleanBody.sector = Array.isArray(cleanBody.sector) && cleanBody.sector.length > 0
      ? (cleanBody.sector as string[]).join(", ")
      : null;
    const retry = await supabase
      .from("main_contacts")
      .upsert(cleanBody, { onConflict: "email" })
      .select()
      .single();
    data = retry.data;
    error = retry.error;
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  // The body includes both the old email (as `email`) and the new email
  // (as `email` in the fields, which may differ from the lookup key).
  // We use `email` as the lookup key (old PK) and update all other fields.
  const { email: lookupEmail, ...fields } = body;
  if (!lookupEmail) return NextResponse.json({ error: "email is required" }, { status: 400 });

  for (const f of ["created_at", "updated_at"]) delete fields[f];

  // Normalize array fields
  if (fields.tags !== undefined) fields.tags = normalizeArray(fields.tags);
  if (fields.sector !== undefined) fields.sector = normalizeArray(fields.sector);
  if (fields.source !== undefined) fields.source = normalizeArray(fields.source);
  if (fields.optin_status !== undefined) fields.optin_status = normalizeOptinStatus(fields.optin_status);

  // Strip fields that don't exist in the DB
  const cleanFields = await stripUnknownFields(fields);

  // If email is being changed, we need to update it (it's the PK)
  // Supabase .update() with .eq('email', oldEmail) will update the PK too
  // if 'email' is in the fields. The FK cascade on contacts.email will
  // automatically update the engagement rows.

  let { data, error } = await supabase
    .from("main_contacts")
    .update(cleanFields)
    .eq("email", String(lookupEmail).toLowerCase())
    .select()
    .single();

  // If sector failed because column is text not text[], retry with string
  if (error && error.message.includes("sector") && cleanFields.sector !== undefined) {
    cleanFields.sector = Array.isArray(cleanFields.sector) && cleanFields.sector.length > 0
      ? (cleanFields.sector as string[]).join(", ")
      : null;
    const retry = await supabase
      .from("main_contacts")
      .update(cleanFields)
      .eq("email", String(lookupEmail).toLowerCase())
      .select()
      .single();
    data = retry.data;
    error = retry.error;
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest) {
  const body = await req.json();
  if (Array.isArray(body.emails)) {
    const { error } = await supabase
      .from("main_contacts")
      .delete()
      .in("email", body.emails.map((e: string) => e.toLowerCase()));
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, deleted: body.emails.length });
  }
  const { email } = body;
  if (!email) return NextResponse.json({ error: "email or emails is required" }, { status: 400 });
  const { error } = await supabase
    .from("main_contacts")
    .delete()
    .eq("email", String(email).toLowerCase());
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
