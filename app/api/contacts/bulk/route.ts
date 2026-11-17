import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { syncMainOptinStatusForEmails } from "@/lib/syncOptinStatus";

export const runtime = "nodejs";

/**
 * POST /api/contacts/bulk
 *
 * CSV bulk upload for engagement data only (email + mailer_id + opens + clicks + optin_status).
 * Identity fields (name/company/designation/phone/city/sector/tags) go to main_contacts
 * via a separate upload or the Main Database tab.
 *
 * Dedup key: (email, mailer_id). If it exists → UPDATE. If new → INSERT.
 * Auto-creates main_contacts rows and mailers as needed.
 */

interface CleanedRow {
  email: string;
  mailer_id: string | null;
  opens: number;
  clicks: number;
  optin_status: string;
}

/** CSV row + which fields the CSV actually provided. On UPDATE, an empty
 * cell means "keep the stored value", not "reset it" — a status-only
 * upload (e.g. Hard Bounced with empty Opens/Clicks) must not wipe
 * engagement data already recorded for the contact. */
interface ParsedRow extends CleanedRow {
  opensProvided: boolean;
  clicksProvided: boolean;
  optinProvided: boolean;
}

function normalizeStr(v: unknown): string {
  if (v == null) return "";
  return String(v).trim().toLowerCase();
}

function normalizeOptinStatusValue(raw: string): string {
  const s = (raw || "").trim().toLowerCase().replace(/[-_\s]+/g, " ");
  if (s === "hard bounced" || s === "hardbounced" || s === "hb" || s === "bounced" || s === "hard") return "Hard Bounced";
  if (s === "unsubscribed" || s === "unsub" || s === "opted out" || s === "opt out" || s === "optout") return "Unsubscribed";
  return "Subscribed";
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { rows } = body;
  if (!Array.isArray(rows) || rows.length === 0) return NextResponse.json({ error: "rows array is required" }, { status: 400 });
  if (rows.length > 500) return NextResponse.json({ error: "Maximum 500 rows per upload" }, { status: 400 });

  // Step 1: Clean rows
  const cleanedRows: ParsedRow[] = [];
  const mailerIdsToEnsure = new Set<string>();
  const emailsToEnsure = new Set<string>();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] as Record<string, unknown>;
    if (!r?.email) return NextResponse.json({ error: `Row ${i + 1} is missing required field: email` }, { status: 400 });
    const optinRaw = r.optin_status ? String(r.optin_status).trim() : "";
    const cleaned: ParsedRow = {
      email: String(r.email).trim().toLowerCase(),
      mailer_id: r.mailer_id ? String(r.mailer_id).trim() : null,
      opens: r.opens == null || r.opens === "" ? 0 : Number(r.opens) || 0,
      clicks: r.clicks == null || r.clicks === "" ? 0 : Number(r.clicks) || 0,
      optin_status: normalizeOptinStatusValue(optinRaw || "Subscribed"),
      opensProvided: r.opens != null && String(r.opens).trim() !== "",
      clicksProvided: r.clicks != null && String(r.clicks).trim() !== "",
      optinProvided: optinRaw !== "",
    };
    if (cleaned.mailer_id) mailerIdsToEnsure.add(cleaned.mailer_id);
    emailsToEnsure.add(cleaned.email);
    cleanedRows.push(cleaned);
  }

  // Step 2: Auto-create mailers
  if (mailerIdsToEnsure.size > 0) {
    const ids = Array.from(mailerIdsToEnsure);
    const { data: ex } = await supabase.from("mailers").select("mailer_id").in("mailer_id", ids);
    const exSet = new Set((ex ?? []).map((m: { mailer_id: string }) => m.mailer_id));
    const toCreate = ids.filter((id) => !exSet.has(id));
    if (toCreate.length > 0) {
      // ignoreDuplicates keeps this safe against a mailer created by a
      // concurrent upload between the SELECT above and this write.
      await supabase.from("mailers").upsert(toCreate.map((id) => ({
        mailer_id: id, subject_line: `(auto-created from CSV upload — edit in Mailers tab)`,
      })), { onConflict: "mailer_id", ignoreDuplicates: true });
    }
  }

  // Step 3: Auto-create main_contacts (FK requirement)
  if (emailsToEnsure.size > 0) {
    const emails = Array.from(emailsToEnsure);
    const { data: ex } = await supabase.from("main_contacts").select("email").in("email", emails);
    const exSet = new Set((ex ?? []).map((m: { email: string }) => m.email.toLowerCase()));
    const toCreate = emails.filter((e) => !exSet.has(e));
    if (toCreate.length > 0) {
      // ignoreDuplicates keeps this safe against an email created by a
      // concurrent upload between the SELECT above and this write.
      await supabase.from("main_contacts").upsert(toCreate.map((e) => ({ email: e })), { onConflict: "email", ignoreDuplicates: true });
    }
  }

  // Step 4: Fetch existing contacts for dedup — only rows whose email is in
  // the CSV, fully paginated.
  //
  // This used to fetch the WHOLE table with no range/limit. Supabase
  // (PostgREST) silently caps any un-paginated query at 1000 rows, so once
  // the table grew past 1000 rows the map below was missing older existing
  // rows, they were treated as "new", and the INSERT in step 7 blew up with:
  //   duplicate key value violates unique constraint "contacts_email_mailer_unique"
  // Filtering by the CSV's emails keeps the fetch small, and paging with
  // .range() returns every matching row no matter how large the table is.
  const emailList = Array.from(emailsToEnsure);
  const existingRows: Array<{
    id: number; email: string; mailer_id: string | null;
    opens: number; clicks: number; optin_status: string | null;
  }> = [];
  const PAGE_SIZE = 1000; // PostgREST hard cap per query
  const EMAIL_BATCH = 200; // keep the .in(...) filter small per request
  for (let b = 0; b < emailList.length; b += EMAIL_BATCH) {
    const batch = emailList.slice(b, b + EMAIL_BATCH);
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data: page, error: pageErr } = await supabase
        .from("contacts")
        .select("id,email,mailer_id,opens,clicks,optin_status")
        .in("email", batch)
        .order("id")
        .range(from, from + PAGE_SIZE - 1);
      if (pageErr) return NextResponse.json({ error: pageErr.message }, { status: 500 });
      existingRows.push(...(page ?? []));
      if (!page || page.length < PAGE_SIZE) break; // last page reached
    }
  }

  const existingByKey = new Map<string, { id: number; opens: number; clicks: number; optin_status: string | null }>();
  for (const c of existingRows) {
    const key = `${normalizeStr(c.email)}|${normalizeStr(c.mailer_id)}`;
    if (!existingByKey.has(key)) {
      existingByKey.set(key, {
        id: c.id,
        opens: c.opens,
        clicks: c.clicks,
        optin_status: c.optin_status,
      });
    }
  }

  // Step 5: Dedup
  const toInsert: CleanedRow[] = [];
  const toUpdate: Array<{ id: number; data: CleanedRow }> = [];
  const skipped: Array<{ email: string; reason: string }> = [];
  for (const row of cleanedRows) {
    const key = `${normalizeStr(row.email)}|${normalizeStr(row.mailer_id)}`;
    const ex = existingByKey.get(key);
    if (ex) {
      // Empty CSV cells keep the stored value instead of resetting it.
      const upd: CleanedRow = {
        email: row.email,
        mailer_id: row.mailer_id,
        opens: row.opensProvided ? row.opens : ex.opens,
        clicks: row.clicksProvided ? row.clicks : ex.clicks,
        optin_status: row.optinProvided ? row.optin_status : (ex.optin_status ?? row.optin_status),
      };
      const isExact = ex.opens === upd.opens && ex.clicks === upd.clicks && normalizeStr(ex.optin_status) === normalizeStr(upd.optin_status);
      if (isExact) {
        skipped.push({ email: row.email, reason: "exact duplicate — no changes needed" });
      } else {
        toUpdate.push({ id: ex.id, data: upd });
        skipped.push({ email: row.email, reason: `updated (opens ${ex.opens}→${upd.opens}, clicks ${ex.clicks}→${upd.clicks})` });
      }
    } else {
      // New row → store the CSV values (empty cells become the defaults).
      toInsert.push({ email: row.email, mailer_id: row.mailer_id, opens: row.opens, clicks: row.clicks, optin_status: row.optin_status });
    }
  }

  // Step 6: De-duplicate intra-CSV by (email, mailer_id)
  const insertByKey = new Map<string, CleanedRow>();
  let intraDupes = 0;
  for (const row of toInsert) {
    const key = `${normalizeStr(row.email)}|${normalizeStr(row.mailer_id)}`;
    if (insertByKey.has(key)) { intraDupes++; skipped.push({ email: row.email, reason: "duplicate (email, mailer_id) in CSV — later row wins" }); }
    insertByKey.set(key, row);
  }

  // Step 7: Insert + Update
  let upsertedCount = 0;
  let upsertErr: string | null = null;
  if (insertByKey.size > 0) {
    // Upsert instead of plain insert: the dedup above is check-then-act, so a
    // row created by a concurrent upload between the SELECT and this write
    // would abort the whole batch with
    //   duplicate key value violates unique constraint "contacts_email_mailer_unique".
    // ON CONFLICT (email, mailer_id) DO UPDATE makes the operation idempotent —
    // re-uploading the same CSV is always safe.
    const { error: insErr } = await supabase
      .from("contacts")
      .upsert(Array.from(insertByKey.values()), { onConflict: "email,mailer_id" });
    if (insErr) upsertErr = insErr.message; else upsertedCount += insertByKey.size;
  }
  if (!upsertErr && toUpdate.length > 0) {
    for (const u of toUpdate) {
      const { error: updErr } = await supabase.from("contacts").update(u.data).eq("id", u.id);
      if (updErr) { upsertErr = updErr.message; break; }
      upsertedCount++;
    }
  }
  if (upsertErr) return NextResponse.json({ error: upsertErr }, { status: 500 });

  // Step 8: Propagate optin_status from the engagement rows to
  // main_contacts (worst status wins) so the Main Contacts view reflects
  // CSV-imported statuses (e.g. Hard Bounced) immediately.
  await syncMainOptinStatusForEmails(cleanedRows.map((r) => r.email));

  return NextResponse.json({
    inserted: insertByKey.size,
    updated: toUpdate.length,
    upserted: upsertedCount,
    skipped: skipped.filter((s) => s.reason.startsWith("exact")).length,
    intraCsvDuplicates: intraDupes,
    skippedRows: skipped,
    total: cleanedRows.length,
  }, { status: 201 });
}
