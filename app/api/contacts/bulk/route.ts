import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

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
  const cleanedRows: CleanedRow[] = [];
  const mailerIdsToEnsure = new Set<string>();
  const emailsToEnsure = new Set<string>();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] as Record<string, unknown>;
    if (!r?.email) return NextResponse.json({ error: `Row ${i + 1} is missing required field: email` }, { status: 400 });
    const cleaned: CleanedRow = {
      email: String(r.email).trim().toLowerCase(),
      mailer_id: r.mailer_id ? String(r.mailer_id).trim() : null,
      opens: r.opens == null || r.opens === "" ? 0 : Number(r.opens) || 0,
      clicks: r.clicks == null || r.clicks === "" ? 0 : Number(r.clicks) || 0,
      optin_status: normalizeOptinStatusValue(r.optin_status ? String(r.optin_status).trim() : "Subscribed"),
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
      await supabase.from("mailers").insert(toCreate.map((id) => ({
        mailer_id: id, subject_line: `(auto-created from CSV upload — edit in Mailers tab)`,
      })));
    }
  }

  // Step 3: Auto-create main_contacts (FK requirement)
  if (emailsToEnsure.size > 0) {
    const emails = Array.from(emailsToEnsure);
    const { data: ex } = await supabase.from("main_contacts").select("email").in("email", emails);
    const exSet = new Set((ex ?? []).map((m: { email: string }) => m.email.toLowerCase()));
    const toCreate = emails.filter((e) => !exSet.has(e));
    if (toCreate.length > 0) {
      await supabase.from("main_contacts").insert(toCreate.map((e) => ({ email: e })));
    }
  }

  // Step 4: Fetch existing contacts for dedup
  const { data: existing } = await supabase
    .from("contacts")
    .select("id,email,mailer_id,opens,clicks,optin_status")
    .order("updated_at", { ascending: false });

  const existingByKey = new Map<string, { id: number; opens: number; clicks: number; optin_status: string | null }>();
  for (const c of existing ?? []) {
    const key = `${normalizeStr(c.email)}|${normalizeStr(c.mailer_id)}`;
    if (!existingByKey.has(key)) {
      existingByKey.set(key, {
        id: (c as { id: number }).id,
        opens: (c as { opens: number }).opens,
        clicks: (c as { clicks: number }).clicks,
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
      const isExact = ex.opens === row.opens && ex.clicks === row.clicks && normalizeStr(ex.optin_status) === normalizeStr(row.optin_status);
      if (isExact) {
        skipped.push({ email: row.email, reason: "exact duplicate — no changes needed" });
      } else {
        toUpdate.push({ id: ex.id, data: row });
        skipped.push({ email: row.email, reason: `updated (opens ${ex.opens}→${row.opens}, clicks ${ex.clicks}→${row.clicks})` });
      }
    } else {
      toInsert.push(row);
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
    const { error: insErr } = await supabase.from("contacts").insert(Array.from(insertByKey.values()));
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
