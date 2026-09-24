import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { fetchAll } from "@/lib/fetchAll";

function normalizeOptinStatus(raw: string | undefined | null): string {
  const s = (raw ?? "").trim().toLowerCase().replace(/[-_\s]+/g, " ");
  if (s === "hard bounced" || s === "hardbounced" || s === "hb" || s === "bounced" || s === "hard") return "Hard Bounced";
  if (s === "unsubscribed" || s === "unsub" || s === "opted out" || s === "opt out" || s === "optout") return "Unsubscribed";
  if (s === "subscribed" || s === "sub" || s === "active" || s === "opted in" || s === "opt in" || s === "optin" || s === "") return "Subscribed";
  return "Subscribed";
}

async function ensureMailerExists(mailerId: string): Promise<{ ok: boolean; error?: string }> {
  if (!mailerId) return { ok: true };
  const trimmed = mailerId.trim();
  if (!trimmed) return { ok: true };
  const { data: existing } = await supabase.from("mailers").select("mailer_id").eq("mailer_id", trimmed).maybeSingle();
  if (existing) return { ok: true };
  const { error } = await supabase.from("mailers").insert({
    mailer_id: trimmed,
    subject_line: `(auto-created — edit in Mailers tab)`,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

function isMissingColumnError(msg: string): boolean {
  return /column .* does not exist|relation .* does not exist|function .* does not exist|Could not find the function/.test(msg);
}

/**
 * GET /api/contacts
 *
 * Without `page` param: legacy shape — the full table as a bare array
 * (ordered by id DESC). Kept for any older consumers.
 *
 * With `page` param: server-side paginated + filtered + searched —
 *   ?page&pageSize&q&optin&engagement&mailer  (mailer='(none)' = unassigned)
 * Returns { rows, total, page, pageSize } via the search_contacts RPC
 * (single round-trip: filter + count(*) OVER() + LIMIT/OFFSET).
 * Falls back to fetchAll + in-memory filter if the RPC isn't deployed.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (!sp.has("page")) {
    // Legacy: full table as a bare array.
    try {
      const rows = await fetchAll("contacts", [{ column: "id", ascending: false }]);
      return NextResponse.json(rows);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(sp.get("pageSize") ?? "25", 10) || 25));
  const q          = (sp.get("q")         ?? "").trim() || null;
  const optin      = (sp.get("optin")     ?? "").trim() || null;
  const engagement = (sp.get("engagement") ?? "").trim() || null;
  const mailer     = (sp.get("mailer")    ?? "").trim() || null;

  const rpcArgs = {
    p_search: q,
    p_optin_status: optin,
    p_engagement: engagement,
    p_mailer_id: mailer,
    p_page: page,
    p_page_size: pageSize,
  };

  const { data: rpcRows, error: rpcError } = await supabase.rpc("search_contacts", rpcArgs);

  if (!rpcError && Array.isArray(rpcRows)) {
    const totalFromFirst = rpcRows.length > 0 ? Number((rpcRows[0] as Record<string, unknown>)._total_count ?? 0) : 0;
    const rows = rpcRows.map((r) => {
      const { _total_count: _ignored, ...rest } = r as Record<string, unknown>;
      void _ignored;
      return rest;
    });
    return NextResponse.json({ rows, total: totalFromFirst || rows.length, page, pageSize });
  }

  if (rpcError && !isMissingColumnError(rpcError.message)) {
    return NextResponse.json({ error: rpcError.message }, { status: 500 });
  }

  // Fallback: fetchAll + in-memory filter (older schema without the RPC).
  try {
    const all = await fetchAll<Record<string, unknown>>("contacts", [{ column: "id", ascending: false }]);
    const needle = q ? q.toLowerCase() : null;
    const filtered = all.filter((r) => {
      if (optin      && r.optin_status    !== optin)      return false;
      if (engagement && r.engagement_score !== engagement) return false;
      if (mailer === "(none)") { if (r.mailer_id) return false; }
      else if (mailer && r.mailer_id !== mailer) return false;
      if (needle) {
        const hay = [r.email, r.mailer_id, r.optin_status, r.engagement_score]
          .filter((v) => v != null)
          .map((v) => String(v).toLowerCase())
          .join(" ");
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    const start = (page - 1) * pageSize;
    return NextResponse.json({ rows: filtered.slice(start, start + pageSize), total: filtered.length, page, pageSize });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  if (!body?.email) return NextResponse.json({ error: "email is required" }, { status: 400 });
  body.email = String(body.email).trim().toLowerCase();

  // Auto-create the main_contacts row if it doesn't exist yet
  // (the contacts table has a FK to main_contacts.email)
  const { data: mainExisting } = await supabase
    .from("main_contacts")
    .select("email")
    .eq("email", body.email)
    .maybeSingle();
  if (!mainExisting) {
    await supabase.from("main_contacts").insert({ email: body.email });
  }

  for (const f of ["id", "last_activity_date", "engagement_score", "created_at", "updated_at"]) delete body[f];
  body.opens = Number(body.opens) || 0;
  body.clicks = Number(body.clicks) || 0;
  if (body.optin_status !== undefined) body.optin_status = normalizeOptinStatus(body.optin_status);

  if (body.mailer_id) {
    const ensured = await ensureMailerExists(body.mailer_id);
    if (!ensured.ok) return NextResponse.json({ error: ensured.error }, { status: 400 });
  }

  // Check if (email, mailer_id) already exists → UPDATE; otherwise INSERT
  let existingId: number | null = null;
  if (body.mailer_id) {
    const { data: ex } = await supabase
      .from("contacts")
      .select("id")
      .eq("email", body.email)
      .eq("mailer_id", body.mailer_id)
      .maybeSingle();
    if (ex) existingId = (ex as { id: number }).id;
  }

  if (existingId) {
    const { data, error } = await supabase.from("contacts").update(body).eq("id", existingId).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data, { status: 200 });
  }

  const { data, error } = await supabase.from("contacts").insert(body).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const { id, ...fields } = body;
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  for (const f of ["id", "last_activity_date", "engagement_score", "created_at", "updated_at"]) delete fields[f];
  if ("opens" in fields) fields.opens = Number(fields.opens) || 0;
  if ("clicks" in fields) fields.clicks = Number(fields.clicks) || 0;
  if (fields.optin_status !== undefined) fields.optin_status = normalizeOptinStatus(fields.optin_status);
  if (fields.mailer_id) {
    const ensured = await ensureMailerExists(fields.mailer_id);
    if (!ensured.ok) return NextResponse.json({ error: ensured.error }, { status: 400 });
  }
  const { data, error } = await supabase.from("contacts").update(fields).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest) {
  const body = await req.json();
  if (Array.isArray(body.emails)) {
    // Bulk delete by email (BulkDeleteModal). The UI is server-paged and no
    // longer holds the full table, so email→id mapping happens here instead
    // of in the browser. Deletes every engagement row for those emails
    // (mailer counters recompute automatically via the AFTER DELETE trigger).
    const BATCH = 500;
    const emails = body.emails.map((e: string) => String(e).trim().toLowerCase()).filter(Boolean);
    if (emails.length === 0) return NextResponse.json({ error: "emails array is empty" }, { status: 400 });
    let deletedCount = 0;
    const errors: string[] = [];
    for (let i = 0; i < emails.length; i += BATCH) {
      const batch = emails.slice(i, i + BATCH);
      const { error } = await supabase.from("contacts").delete().in("email", batch);
      if (error) errors.push(`Batch ${Math.floor(i / BATCH) + 1}: ${error.message}`);
      else deletedCount += batch.length;
    }
    if (errors.length > 0) {
      return NextResponse.json({ error: `Some batches failed: ${errors.join("; ")}`, deleted: deletedCount }, { status: 500 });
    }
    return NextResponse.json({ success: true, deleted: deletedCount });
  }
  if (Array.isArray(body.ids)) {
    const { error } = await supabase.from("contacts").delete().in("id", body.ids);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, deleted: body.ids.length });
  }
  const { id } = body;
  if (!id) return NextResponse.json({ error: "id, ids, or emails is required" }, { status: 400 });
  const { error } = await supabase.from("contacts").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
