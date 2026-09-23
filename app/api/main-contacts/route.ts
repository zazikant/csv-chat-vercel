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
  if (body.assigned_to !== undefined) body.assigned_to = normalizeArray(body.assigned_to);
  if (body.optin_status !== undefined) body.optin_status = normalizeOptinStatus(body.optin_status);
  for (const f of ["created_at", "updated_at"]) delete body[f];

  // Check if email already exists — if so, use MERGE logic (same as PUT):
  // only update fields with non-empty values; preserve existing DB values
  // for fields that are empty/null in the payload.
  const { data: existing } = await supabase
    .from("main_contacts")
    .select("*")
    .eq("email", body.email)
    .maybeSingle();

  if (existing) {
    // Email exists — MERGE: keep existing values for empty fields
    const existingRow = existing as Record<string, unknown>;
    const merged: Record<string, unknown> = {};

    for (const [k, v] of Object.entries(body)) {
      if (k === "email") { merged.email = v; continue; }

      if (k === "tags" || k === "sector" || k === "source" || k === "assigned_to") {
        const newArr = Array.isArray(v) ? v : [];
        const existingArr = Array.isArray(existingRow[k]) ? existingRow[k] : [];
        if (newArr.length === 0 && existingArr.length > 0) {
          continue; // Don't wipe — keep existing
        }
        merged[k] = newArr;
        continue;
      }

      // Text fields: if the new value is empty string, CLEAR the field (user
      // intentionally deleted the text). If the new value is null/undefined,
      // skip (field wasn't in the form). If non-empty, update.
      if (v === "") {
        merged[k] = null; // Clear the field
        continue;
      }
      if (v === null || v === undefined) {
        continue; // Field not in payload — skip
      }
      merged[k] = v;
    }

    const { data: updateData, error: updateError } = await supabase
      .from("main_contacts")
      .update(merged)
      .eq("email", body.email)
      .select();
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
    const updateResult = Array.isArray(updateData) && updateData.length > 0 ? updateData[0] : updateData;
    return NextResponse.json(updateResult, { status: 200 });
  }

  // Email doesn't exist — INSERT new record
  const { data: insertData, error: insertError } = await supabase
    .from("main_contacts")
    .insert(body)
    .select();
  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });
  const insertResult = Array.isArray(insertData) && insertData.length > 0 ? insertData[0] : insertData;
  return NextResponse.json(insertResult, { status: 201 });
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
  if (fields.assigned_to !== undefined) fields.assigned_to = normalizeArray(fields.assigned_to);
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
    if (k === "tags" || k === "sector" || k === "source" || k === "assigned_to") {
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
    // If the new value is empty string, CLEAR the field (user intentionally
    // deleted the text). If null/undefined, skip (not in payload). If non-empty, update.
    if (v === "") {
      mergedFields[k] = null; // Clear the field
      continue;
    }
    if (v === null || v === undefined) {
      continue; // Field not in payload — skip
    }
    mergedFields[k] = v;
  }

  if (Object.keys(mergedFields).length === 0) {
    // Nothing to update — return the existing record
    if (existing) return NextResponse.json(existing);
    return NextResponse.json({ error: "Record not found" }, { status: 404 });
  }

  const { data: putData, error: putError } = await supabase
    .from("main_contacts")
    .update(mergedFields)
    .eq("email", String(lookupEmail).toLowerCase())
    .select();

  if (putError) return NextResponse.json({ error: putError.message }, { status: 500 });
  const putResult = Array.isArray(putData) && putData.length > 0 ? putData[0] : putData;
  return NextResponse.json(putResult);
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
