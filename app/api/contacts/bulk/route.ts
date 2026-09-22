import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";

/**
 * POST /api/contacts/bulk
 *
 * Body: { rows: Array<Partial<ContactRow>> }
 *
 * Dedup logic (per user spec v2.3):
 *   For each row in the upload:
 *     - If email does NOT exist in DB → INSERT (new contact)
 *     - If email exists AND all 6 fields match exactly → SKIP (exact dup)
 *     - If email exists AND any of the 6 fields differ → SKIP (don't overwrite)
 *
 *   The 6 fields checked: name, company, designation, email, phone, mailer_id
 *   (case-insensitive, trimmed for comparison).
 *
 *   This means: CSV upload NEVER overwrites existing records. To update a
 *   contact, edit it manually in the UI.
 *
 * Response: { inserted, skipped, skippedRows, total }
 *   skippedRows: array of { email, reason } so the UI can show a summary.
 *
 * Tags: comma-separated string in CSV → normalized to text[] (lowercase, deduped).
 */

interface CleanedRow {
  email: string;
  name: string | null;
  company: string | null;
  designation: string | null;
  phone: string | null;
  city: string | null;
  sector: string | null;
  optin_status: string;
  mailer_id: string | null;
  opens: number;
  clicks: number;
  tags: string[];
}

function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags) {
    if (typeof t !== "string") continue;
    const tag = t.trim().toLowerCase();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

/** Parse tags from a CSV cell: "vip, mumbai, contractor" → ["vip","mumbai","contractor"] */
function parseTagsCell(raw: string | undefined): string[] {
  if (!raw) return [];
  return normalizeTags(raw.split(/[;,]/).map((s) => s.trim()));
}

function normalizeStr(v: unknown): string {
  if (v == null) return "";
  return String(v).trim().toLowerCase();
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { rows } = body;

  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "rows array is required" }, { status: 400 });
  }

  if (rows.length > 500) {
    return NextResponse.json({ error: "Maximum 500 rows per upload" }, { status: 400 });
  }

  // Step 1: Validate + clean each row
  const cleanedRows: CleanedRow[] = [];
  const mailerIdsToEnsure = new Set<string>();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] as Record<string, unknown>;
    if (!r?.email) {
      return NextResponse.json(
        { error: `Row ${i + 1} is missing required field: email` },
        { status: 400 }
      );
    }
    const cleaned: CleanedRow = {
      email: String(r.email).trim(),
      name: r.name ? String(r.name).trim() : null,
      company: r.company ? String(r.company).trim() : null,
      designation: r.designation ? String(r.designation).trim() : null,
      phone: r.phone ? String(r.phone).trim() : null,
      city: r.city ? String(r.city).trim() : null,
      sector: r.sector ? String(r.sector).trim() : null,
      optin_status: r.optin_status ? String(r.optin_status).trim() : "Subscribed",
      mailer_id: r.mailer_id ? String(r.mailer_id).trim() : null,
      opens: r.opens == null || r.opens === "" ? 0 : Number(r.opens) || 0,
      clicks: r.clicks == null || r.clicks === "" ? 0 : Number(r.clicks) || 0,
      tags: Array.isArray(r.tags)
        ? normalizeTags(r.tags)
        : parseTagsCell(typeof r.tags === "string" ? r.tags : undefined),
    };
    if (cleaned.mailer_id) mailerIdsToEnsure.add(cleaned.mailer_id);
    cleanedRows.push(cleaned);
  }

  // Step 2: Lazily create any mailers that don't exist yet
  if (mailerIdsToEnsure.size > 0) {
    const ids = Array.from(mailerIdsToEnsure);
    const { data: existingMailers, error: selErr } = await supabase
      .from("mailers")
      .select("mailer_id")
      .in("mailer_id", ids);
    if (selErr) {
      return NextResponse.json({ error: `Failed to check mailers: ${selErr.message}` }, { status: 500 });
    }
    const existingSet = new Set((existingMailers ?? []).map((m: { mailer_id: string }) => m.mailer_id));
    const toCreate = ids.filter((id) => !existingSet.has(id));
    if (toCreate.length > 0) {
      const { error: insErr } = await supabase
        .from("mailers")
        .insert(toCreate.map((id) => ({
          mailer_id: id,
          subject_line: `(auto-created from CSV upload — edit in Mailers tab)`,
          template_name: null,
          sent_date: null,
        })));
      if (insErr) {
        return NextResponse.json({ error: `Failed to auto-create mailers: ${insErr.message}` }, { status: 500 });
      }
    }
  }

  // Step 3: Fetch existing contacts by email to compute dedup
  const allEmails = Array.from(new Set(cleanedRows.map((r) => r.email)));
  const { data: existingContacts, error: fetchErr } = await supabase
    .from("contacts")
    .select("email,name,company,designation,phone,mailer_id")
    .in("email", allEmails);

  if (fetchErr) {
    return NextResponse.json({ error: `Failed to fetch existing contacts: ${fetchErr.message}` }, { status: 500 });
  }

  // Build a dedup lookup: email → array of existing contact rows (typically 1)
  const existingByEmail = new Map<string, Array<{ name: string | null; company: string | null; designation: string | null; phone: string | null; mailer_id: string | null }>>();
  for (const c of existingContacts ?? []) {
    const email = normalizeStr(c.email);
    if (!existingByEmail.has(email)) existingByEmail.set(email, []);
    existingByEmail.get(email)!.push({
      name: c.name,
      company: c.company,
      designation: c.designation,
      phone: c.phone,
      mailer_id: c.mailer_id,
    });
  }

  // Step 4: Apply dedup — skip ANY row whose email already exists in DB.
  // (User spec v2.3: never overwrite existing records via CSV import.
  //  To update a contact, edit it manually in the UI.)
  const toInsert: CleanedRow[] = [];
  const skipped: { email: string; reason: string }[] = [];
  for (const row of cleanedRows) {
    const existingMatches = existingByEmail.get(normalizeStr(row.email)) ?? [];
    if (existingMatches.length === 0) {
      // Email is new — insert
      toInsert.push(row);
      continue;
    }
    // Email already exists — check if it's an exact match (same 6 fields)
    const isExactMatch = existingMatches.some((e) =>
      normalizeStr(e.name)        === normalizeStr(row.name)        &&
      normalizeStr(e.company)     === normalizeStr(row.company)     &&
      normalizeStr(e.designation)  === normalizeStr(row.designation) &&
      normalizeStr(e.phone)        === normalizeStr(row.phone)        &&
      normalizeStr(e.mailer_id)   === normalizeStr(row.mailer_id)
    );
    if (isExactMatch) {
      skipped.push({
        email: row.email,
        reason: "exact duplicate — skipped (existing record preserved)",
      });
    } else {
      // Email exists with different other fields — DON'T overwrite (preserve existing data)
      const diffs: string[] = [];
      const ex = existingMatches[0];
      if (normalizeStr(ex.name)       !== normalizeStr(row.name))       diffs.push(`name ("${ex.name ?? ""}" → "${row.name ?? ""}")`);
      if (normalizeStr(ex.company)    !== normalizeStr(row.company))     diffs.push(`company ("${ex.company ?? ""}" → "${row.company ?? ""}")`);
      if (normalizeStr(ex.designation) !== normalizeStr(row.designation)) diffs.push(`designation`);
      if (normalizeStr(ex.phone)      !== normalizeStr(row.phone))       diffs.push(`phone`);
      if (normalizeStr(ex.mailer_id)  !== normalizeStr(row.mailer_id))   diffs.push(`mailer_id`);
      skipped.push({
        email: row.email,
        reason: `email already exists, NOT replaced (different: ${diffs.join(", ")}). To update, edit this contact manually in the UI.`,
      });
    }
  }

  // Step 5: Insert the new rows (no upsert — only new emails go in)
  let inserted = 0;
  let insertErr: string | null = null;
  if (toInsert.length > 0) {
    const { data: insertData, error: insertError } = await supabase
      .from("contacts")
      .insert(toInsert)
      .select();
    if (insertError) {
      insertErr = insertError.message;
    } else {
      inserted = insertData?.length ?? 0;
    }
  }

  if (insertErr) {
    return NextResponse.json({ error: insertErr }, { status: 500 });
  }

  return NextResponse.json({
    inserted,
    skipped: skipped.length,
    skippedRows: skipped,
    total: cleanedRows.length,
  }, { status: 201 });
}
