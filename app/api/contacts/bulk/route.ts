import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";

/**
 * POST /api/contacts/bulk
 *
 * Body: { rows: Array<Partial<ContactRow>> }
 *
 * Dedup logic (per user spec v2.4):
 *   For each row in the upload:
 *     - If email does NOT exist in DB        → INSERT (new contact)
 *     - If email exists AND all 6 fields match exactly → SKIP (no change needed)
 *     - If email exists AND any field differs → UPDATE (replace existing with new values)
 *
 *   The 6 fields checked: name, company, designation, email, phone, mailer_id
 *   (case-insensitive, trimmed for comparison).
 *
 *   This is UPSERT behavior: existing contacts are updated with new values
 *   from the CSV, except when nothing has changed (exact duplicate).
 *
 * Response: { inserted, updated, skipped, skippedRows, total }
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

/**
 * Server-side normalization of opt-in status.
 * Accepts variants like "Hardbounced" / "hard-bounced" / "bounced" / "HB"
 * and normalizes to one of the 3 canonical values: "Subscribed", "Hard Bounced",
 * "Unsubscribed". Used both by the bulk upload endpoint AND by the per-row
 * POST/PUT endpoints so the value is always consistent regardless of source.
 */
function normalizeOptinStatusValue(raw: string): string {
  const s = (raw || "").trim().toLowerCase().replace(/[-_\s]+/g, " ");
  if (s === "hard bounced" || s === "hardbounced" || s === "hb" || s === "bounced" || s === "hard") {
    return "Hard Bounced";
  }
  if (s === "unsubscribed" || s === "unsub" || s === "opted out" || s === "opt out" || s === "optout") {
    return "Unsubscribed";
  }
  if (s === "subscribed" || s === "sub" || s === "active" || s === "opted in" || s === "opt in" || s === "optin" || s === "") {
    return "Subscribed";
  }
  // Unrecognized — default to Subscribed (safe default) but log it
  console.warn(`[bulk] unrecognized optin_status "${raw}" — defaulting to "Subscribed"`);
  return "Subscribed";
}

/**
 * Normalize tags for comparison: lowercase, trim, dedupe, SORT.
 * Returns a canonical string representation so two arrays with the same
 * tags in different orders (and different cases) compare equal.
 *
 * Examples:
 *   ["VIP", "mumbai"]            -> "mumbai|vip"
 *   ["mumbai", "vip"]            -> "mumbai|vip"   (same — order doesn't matter)
 *   ["VIP"]                       -> "vip"           (case-insensitive)
 *   []                            -> ""
 */
function normalizeTagsForCompare(tags: unknown): string {
  if (!Array.isArray(tags)) return "";
  const cleaned: string[] = [];
  const seen = new Set<string>();
  for (const t of tags) {
    if (typeof t !== "string") continue;
    const tag = t.trim().toLowerCase();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    cleaned.push(tag);
  }
  cleaned.sort();
  return cleaned.join("|");
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
      optin_status: normalizeOptinStatusValue(r.optin_status ? String(r.optin_status).trim() : "Subscribed"),
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
    .select("email,name,company,designation,phone,mailer_id,tags")
    .in("email", allEmails);

  if (fetchErr) {
    return NextResponse.json({ error: `Failed to fetch existing contacts: ${fetchErr.message}` }, { status: 500 });
  }

  // Build a dedup lookup: email → array of existing contact rows (typically 1)
  const existingByEmail = new Map<string, Array<{ name: string | null; company: string | null; designation: string | null; phone: string | null; mailer_id: string | null; tags: string[] | null }>>();
  for (const c of existingContacts ?? []) {
    const email = normalizeStr(c.email);
    if (!existingByEmail.has(email)) existingByEmail.set(email, []);
    existingByEmail.get(email)!.push({
      name: c.name,
      company: c.company,
      designation: c.designation,
      phone: c.phone,
      mailer_id: c.mailer_id,
      tags: c.tags,
    });
  }

  // Pre-fill blank name/company/designation/phone on rows that match an
  // existing email. This is helpful when uploading CSVs with sparse data:
  // the user only needs to type the email + the new fields (opens/clicks/
  // mailer_id), and name/company/designation/phone get filled from the
  // latest existing record for that email.
  for (const row of cleanedRows) {
    const matches = existingByEmail.get(normalizeStr(row.email)) ?? [];
    if (matches.length === 0) continue;  // new email, nothing to fill from
    const existing = matches[0];  // use the first (typically only) match
    if (!row.name        && existing.name)        row.name        = existing.name;
    if (!row.company     && existing.company)     row.company     = existing.company;
    if (!row.designation && existing.designation) row.designation = existing.designation;
    if (!row.phone       && existing.phone)       row.phone       = existing.phone;
  }

  // Step 4: Apply dedup — split rows into "insert" (new email), "update"
  // (existing email with different fields), and "skip" (exact duplicate).
  // Both insert and update rows go into the upsert payload (Supabase's
  // upsert with onConflict=email will INSERT new emails and UPDATE existing
  // ones in a single call).
  const toUpsert: CleanedRow[] = [];
  const skipped: Array<{ email: string; reason: string }> = [];
  let updateCount = 0;
  let insertCount = 0;
  for (const row of cleanedRows) {
    const existingMatches = existingByEmail.get(normalizeStr(row.email)) ?? [];
    if (existingMatches.length === 0) {
      // Email is new — will be INSERTed
      toUpsert.push(row);
      insertCount++;
      continue;
    }
    // Email already exists — check if it's an exact match (same 6 fields + tags)
    // Tags are compared using normalizeTagsForCompare() so that case differences
    // (VIP vs vip) and order differences ([vip, mumbai] vs [mumbai, vip]) don't
    // count as "different" — they're considered the same tags.
    const isExactMatch = existingMatches.some((e) =>
      normalizeStr(e.name)        === normalizeStr(row.name)        &&
      normalizeStr(e.company)     === normalizeStr(row.company)     &&
      normalizeStr(e.designation)  === normalizeStr(row.designation) &&
      normalizeStr(e.phone)        === normalizeStr(row.phone)        &&
      normalizeStr(e.mailer_id)   === normalizeStr(row.mailer_id)   &&
      normalizeTagsForCompare(e.tags) === normalizeTagsForCompare(row.tags)
    );
    if (isExactMatch) {
      skipped.push({
        email: row.email,
        reason: "exact duplicate — no changes needed",
      });
    } else {
      // Email exists with different fields — UPDATE the existing record
      // with the new values from the CSV.
      toUpsert.push(row);
      updateCount++;

      // Build a diff summary for the response (purely informational)
      const diffs: string[] = [];
      const ex = existingMatches[0];
      if (normalizeStr(ex.name)       !== normalizeStr(row.name))       diffs.push(`name ("${ex.name ?? ""}" → "${row.name ?? ""}")`);
      if (normalizeStr(ex.company)    !== normalizeStr(row.company))     diffs.push(`company ("${ex.company ?? ""}" → "${row.company ?? ""}")`);
      if (normalizeStr(ex.designation) !== normalizeStr(row.designation)) diffs.push(`designation ("${ex.designation ?? ""}" → "${row.designation ?? ""}")`);
      if (normalizeStr(ex.phone)      !== normalizeStr(row.phone))       diffs.push(`phone ("${ex.phone ?? ""}" → "${row.phone ?? ""}")`);
      if (normalizeStr(ex.mailer_id)  !== normalizeStr(row.mailer_id))   diffs.push(`mailer_id ("${ex.mailer_id ?? ""}" → "${row.mailer_id ?? ""}")`);
      if (normalizeTagsForCompare(ex.tags) !== normalizeTagsForCompare(row.tags)) {
        diffs.push(`tags ([${(ex.tags ?? []).join(", ")}] → [${row.tags.join(", ")}])`);
      }
      // Stash the diff in the skipped array too (as an "updated" entry) so the UI can show it
      skipped.push({
        email: row.email,
        reason: `updated (${diffs.join(", ")})`,
      });
    }
  }

  // Step 5: Upsert (insert new + update existing in one call)
  let upsertedCount = 0;
  let upsertErr: string | null = null;
  if (toUpsert.length > 0) {
    const { data: upsertData, error: upsertError } = await supabase
      .from("contacts")
      .upsert(toUpsert, { onConflict: "email", ignoreDuplicates: false })
      .select();
    if (upsertError) {
      upsertErr = upsertError.message;
    } else {
      upsertedCount = upsertData?.length ?? 0;
    }
  }

  if (upsertErr) {
    return NextResponse.json({ error: upsertErr }, { status: 500 });
  }

  return NextResponse.json({
    inserted: insertCount,
    updated: updateCount,
    upserted: upsertedCount,  // total rows actually written (= insertCount + updateCount, modulo errors)
    skipped: skipped.filter((s) => s.reason.startsWith("exact")).length,
    skippedRows: skipped,
    total: cleanedRows.length,
  }, { status: 201 });
}
