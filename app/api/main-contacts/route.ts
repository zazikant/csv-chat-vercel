import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

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
  if (body.tags !== undefined) body.tags = normalizeArray(body.tags);
  if (body.sector !== undefined) body.sector = normalizeArray(body.sector);
  if (body.source !== undefined) body.source = normalizeArray(body.source);
  if (body.optin_status !== undefined) body.optin_status = normalizeOptinStatus(body.optin_status);
  for (const f of ["created_at", "updated_at"]) delete body[f];

  const { data, error } = await supabase
    .from("main_contacts")
    .upsert(body, { onConflict: "email" })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const { email: lookupEmail, ...fields } = body;
  if (!lookupEmail) return NextResponse.json({ error: "email is required" }, { status: 400 });

  for (const f of ["created_at", "updated_at"]) delete fields[f];

  // Normalize array fields
  if (fields.tags !== undefined) fields.tags = normalizeArray(fields.tags);
  if (fields.sector !== undefined) fields.sector = normalizeArray(fields.sector);
  if (fields.source !== undefined) fields.source = normalizeArray(fields.source);
  if (fields.optin_status !== undefined) fields.optin_status = normalizeOptinStatus(fields.optin_status);

  // MERGE SEMANTICS: fetch the existing record first.
  // For each field in the payload:
  //   - If the new value is non-empty → use the new value (user changed it)
  //   - If the new value is empty/null but the existing DB value is non-empty →
  //     KEEP the existing DB value (don't wipe data the user didn't touch)
  //   - If both are empty → keep empty
  // This prevents the "adding source wipes sector/tags" bug.
  const { data: existing } = await supabase
    .from("main_contacts")
    .select("*")
    .eq("email", String(lookupEmail).toLowerCase())
    .maybeSingle();

  const mergedFields: Record<string, unknown> = {};
  const existingRow = (existing ?? {}) as Record<string, unknown>;

  for (const [k, v] of Object.entries(fields)) {
    if (k === "email") {
      // email is the PK — only include if it's different from the lookup email
      if (String(v).toLowerCase() !== String(lookupEmail).toLowerCase()) {
        mergedFields.email = v;
      }
      continue;
    }

    // For array fields (tags, sector, source):
    // If the new value is empty [] but the DB has values, keep the DB values.
    // If the new value is non-empty, use it (user changed it).
    if (k === "tags" || k === "sector" || k === "source") {
      const newArr = Array.isArray(v) ? v : [];
      const existingArr = Array.isArray(existingRow[k]) ? existingRow[k] : [];
      if (newArr.length === 0 && existingArr.length > 0) {
        // Don't wipe — keep existing
        continue;
      }
      mergedFields[k] = newArr;
      continue;
    }

    // For text fields:
    // If the new value is null/empty but the DB has a value, keep the DB value.
    // If the new value is non-empty, use it.
    if (v === null || v === undefined || v === "") {
      const existingVal = existingRow[k];
      if (existingVal !== null && existingVal !== undefined && existingVal !== "") {
        // Don't wipe — keep existing
        continue;
      }
      // Both empty — skip (don't need to update)
      continue;
    }
    mergedFields[k] = v;
  }

  if (Object.keys(mergedFields).length === 0) {
    // Nothing to update — return the existing record
    if (existing) return NextResponse.json(existing);
    return NextResponse.json({ error: "Record not found" }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("main_contacts")
    .update(mergedFields)
    .eq("email", String(lookupEmail).toLowerCase())
    .select()
    .single();

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
