import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";

/**
 * POST /api/contacts/bulk
 *
 * Body: { rows: Array<Partial<ContactRow>> }
 *
 * Dedup logic (v3 — multiple rows per email allowed):
 *   - The dedup key is (email, mailer_id). If the CSV has a row with an
 *     (email, mailer_id) that already exists in the DB → UPDATE that row.
 *   - If the (email, mailer_id) is new → INSERT a new row.
 *   - If the (email, mailer_id) already exists and ALL fields match exactly → SKIP.
 *   - If the email is NEW and the 4 identity fields (name+company+designation+phone)
 *     match an existing record with a DIFFERENT email → SKIP ("do nothing").
 *
 *   This allows the same email to appear multiple times (one per mailer).
 *   e.g. anil@godrej.com + M001 and anil@godrej.com + M002 are two separate rows.
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

/** Normalize tags: trim + lowercase + dedupe. */
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

/** Normalize opt-in status to canonical values. */
function normalizeOptinStatusValue(raw: string): string {
  const s = (raw || "").trim().toLowerCase().replace(/[-_\s]+/g, " ");
  if (s === "hard bounced" || s === "hardbounced" || s === "hb" || s === "bounced" || s === "hard") return "Hard Bounced";
  if (s === "unsubscribed" || s === "unsub" || s === "opted out" || s === "opt out" || s === "optout") return "Unsubscribed";
  if (s === "subscribed" || s === "sub" || s === "active" || s === "opted in" || s === "opt in" || s === "optin" || s === "") return "Subscribed";
  return "Subscribed";
}

/**
 * Canonical string for tags comparison: lowercase, trim, dedupe, sort, join with |.
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
      email: String(r.email).trim().toLowerCase(),
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

  // Step 3: Fetch ALL existing contacts (ordered by updated_at desc for identity match)
  const { data: existingContacts, error: fetchErr } = await supabase
    .from("contacts")
    .select("id,email,name,company,designation,phone,mailer_id,tags,opens,clicks,optin_status")
    .order("updated_at", { ascending: false });

  if (fetchErr) {
    return NextResponse.json({ error: `Failed to fetch existing contacts: ${fetchErr.message}` }, { status: 500 });
  }

  // Build lookups:
  // 1. existingByEmailMailer: (email|mailer_id) → existing record (for dedup by email+mailer)
  // 2. existingByIdentity: 4-field key → email (for "do nothing" check)
  const existingByEmailMailer = new Map<string, { id: number; name: string | null; company: string | null; designation: string | null; phone: string | null; mailer_id: string | null; tags: string[] | null; opens: number; clicks: number; optin_status: string | null }>();
  const existingByIdentity = new Map<string, string>();  // identity-key → email
  const existingByEmail = new Map<string, { name: string | null; company: string | null; designation: string | null; phone: string | null }>();

  for (const c of existingContacts ?? []) {
    const email = normalizeStr(c.email);
    const mailerId = normalizeStr(c.mailer_id);
    const emailMailerKey = `${email}|${mailerId}`;

    // Keep the latest record per (email, mailer_id) combination
    if (!existingByEmailMailer.has(emailMailerKey)) {
      existingByEmailMailer.set(emailMailerKey, {
        id: (c as { id: number }).id,
        name: c.name,
        company: c.company,
        designation: c.designation,
        phone: c.phone,
        mailer_id: c.mailer_id,
        tags: c.tags,
        opens: (c as { opens: number }).opens,
        clicks: (c as { clicks: number }).clicks,
        optin_status: c.optin_status,
      });
    }

    // Keep the latest identity fields per email (for auto-fill)
    if (!existingByEmail.has(email)) {
      existingByEmail.set(email, {
        name: c.name,
        company: c.company,
        designation: c.designation,
        phone: c.phone,
      });
    }

    // Build identity key for "do nothing" check
    const identityKey = [
      normalizeStr(c.name),
      normalizeStr(c.company),
      normalizeStr(c.designation),
      normalizeStr(c.phone),
    ].join("|");
    if (!existingByIdentity.has(identityKey) && identityKey !== "|||") {
      existingByIdentity.set(identityKey, c.email);
    }
  }

  // Pre-fill blank name/company/designation/phone from the latest existing
  // record for that email (across ALL mailer rows).
  for (const row of cleanedRows) {
    const existing = existingByEmail.get(normalizeStr(row.email));
    if (!existing) continue;
    if (!row.name        && existing.name)        row.name        = existing.name;
    if (!row.company     && existing.company)     row.company     = existing.company;
    if (!row.designation && existing.designation) row.designation = existing.designation;
    if (!row.phone       && existing.phone)       row.phone       = existing.phone;
  }

  // Step 4: Dedup logic
  const toUpsert: Array<CleanedRow & { _existingId?: number }> = [];
  const skipped: Array<{ email: string; reason: string }> = [];
  let updateCount = 0;
  let insertCount = 0;
  let identitySkipCount = 0;

  for (const row of cleanedRows) {
    const emailMailerKey = `${normalizeStr(row.email)}|${normalizeStr(row.mailer_id)}`;
    const existing = existingByEmailMailer.get(emailMailerKey);

    if (existing) {
      // (email, mailer_id) already exists → check if all fields match
      const isExactMatch =
        normalizeStr(existing.name)        === normalizeStr(row.name)        &&
        normalizeStr(existing.company)     === normalizeStr(row.company)     &&
        normalizeStr(existing.designation)  === normalizeStr(row.designation) &&
        normalizeStr(existing.phone)        === normalizeStr(row.phone)        &&
        existing.opens                      === row.opens                      &&
        existing.clicks                     === row.clicks                     &&
        normalizeStr(existing.optin_status) === normalizeStr(row.optin_status) &&
        normalizeTagsForCompare(existing.tags) === normalizeTagsForCompare(row.tags);

      if (isExactMatch) {
        skipped.push({ email: row.email, reason: "exact duplicate — no changes needed" });
      } else {
        // UPDATE existing row (by id)
        toUpsert.push({ ...row, _existingId: existing.id });
        updateCount++;

        const diffs: string[] = [];
        if (normalizeStr(existing.name)        !== normalizeStr(row.name))        diffs.push(`name ("${existing.name ?? ""}" → "${row.name ?? ""}")`);
        if (normalizeStr(existing.company)     !== normalizeStr(row.company))     diffs.push(`company ("${existing.company ?? ""}" → "${row.company ?? ""}")`);
        if (normalizeStr(existing.designation)  !== normalizeStr(row.designation)) diffs.push(`designation`);
        if (normalizeStr(existing.phone)        !== normalizeStr(row.phone))       diffs.push(`phone`);
        if (existing.opens                      !== row.opens)                     diffs.push(`opens (${existing.opens} → ${row.opens})`);
        if (existing.clicks                     !== row.clicks)                    diffs.push(`clicks (${existing.clicks} → ${row.clicks})`);
        if (normalizeTagsForCompare(existing.tags) !== normalizeTagsForCompare(row.tags)) {
          diffs.push(`tags ([${(existing.tags ?? []).join(", ")}] → [${row.tags.join(", ")}])`);
        }
        skipped.push({ email: row.email, reason: `updated (${diffs.join(", ")})` });
      }
    } else {
      // (email, mailer_id) is new — check if the 4 identity fields match an
      // existing record with a DIFFERENT email. If so, SKIP ("do nothing").
      const identityKey = [
        normalizeStr(row.name),
        normalizeStr(row.company),
        normalizeStr(row.designation),
        normalizeStr(row.phone),
      ].join("|");
      const matchingEmail = existingByIdentity.get(identityKey);
      if (matchingEmail && normalizeStr(matchingEmail) !== normalizeStr(row.email) && identityKey !== "|||") {
        identitySkipCount++;
        skipped.push({
          email: row.email,
          reason: `skipped — same name/company/designation/phone as existing ${matchingEmail} (different email, doing nothing)`,
        });
      } else {
        // Brand new contact — INSERT
        toUpsert.push(row);
        insertCount++;
      }
    }
  }

  // Step 5: De-duplicate toUpsert by (email, mailer_id) — if the CSV itself
  // has multiple rows with the same (email, mailer_id), keep the last one.
  const upsertByKey = new Map<string, CleanedRow & { _existingId?: number }>();
  const intraCsvDupes: { email: string; reason: string }[] = [];
  for (const row of toUpsert) {
    const key = `${normalizeStr(row.email)}|${normalizeStr(row.mailer_id)}`;
    if (upsertByKey.has(key)) {
      intraCsvDupes.push({
        email: row.email,
        reason: "duplicate (email, mailer_id) in CSV — earlier row skipped, later row wins",
      });
    }
    upsertByKey.set(key, row);
  }

  // Step 6: Perform inserts and updates separately (updates need the id)
  let upsertedCount = 0;
  let upsertErr: string | null = null;

  const toInsert: CleanedRow[] = [];
  const toUpdate: Array<{ id: number; data: CleanedRow }> = [];
  for (const row of upsertByKey.values()) {
    if (row._existingId) {
      const { _existingId, ...data } = row;
      toUpdate.push({ id: _existingId, data });
    } else {
      const { _existingId, ...data } = row;
      toInsert.push(data);
    }
  }

  // Insert new rows
  if (toInsert.length > 0) {
    const { error: insErr } = await supabase.from("contacts").insert(toInsert);
    if (insErr) upsertErr = insErr.message;
    else upsertedCount += toInsert.length;
  }

  // Update existing rows (one by one, since each has a different id)
  if (!upsertErr && toUpdate.length > 0) {
    for (const u of toUpdate) {
      const { error: updErr } = await supabase
        .from("contacts")
        .update(u.data)
        .eq("id", u.id);
      if (updErr) { upsertErr = updErr.message; break; }
      upsertedCount++;
    }
  }

  if (upsertErr) {
    return NextResponse.json({ error: upsertErr }, { status: 500 });
  }

  for (const d of intraCsvDupes) skipped.push(d);

  return NextResponse.json({
    inserted: toInsert.length,
    updated: toUpdate.length,
    upserted: upsertedCount,
    skipped: skipped.filter((s) => s.reason.startsWith("exact")).length,
    identitySkipped: identitySkipCount,
    intraCsvDuplicates: intraCsvDupes.length,
    skippedRows: skipped,
    total: cleanedRows.length,
  }, { status: 201 });
}
