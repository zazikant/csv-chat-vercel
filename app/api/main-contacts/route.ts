import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { fetchAll } from "@/lib/fetchAll";
import { normalizePhone } from "@/lib/normalizePhone";

export const runtime = "nodejs";

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

function isMissingColumnError(msg: string): boolean {
  return /column .* does not exist|relation .* does not exist/.test(msg);
}

const EXPORT_PAGE_SIZE = 1000;
const EXPORT_MAX_PAGES = 200; // hard cap: 200 × 1000 = 200k rows

/** In-memory filter used by the no-RPC fallback paths. Mirrors search_main_contacts semantics. */
function filterMainContactsInMemory(
  all: Record<string, unknown>[],
  filters: { q: string | null; optin: string | null; city: string | null; sector: string | null; source: string | null; tag: string | null; assigned: string | null },
): Record<string, unknown>[] {
  const needle = filters.q ? filters.q.toLowerCase() : null;
  return all.filter((r) => {
    if (filters.optin   && r.optin_status !== filters.optin) return false;
    if (filters.city    && r.city         !== filters.city)  return false;
    if (filters.sector  && !(Array.isArray(r.sector)      && (r.sector      as string[]).includes(filters.sector))) return false;
    if (filters.source  && !(Array.isArray(r.source)      && (r.source      as string[]).includes(filters.source))) return false;
    if (filters.tag     && !(Array.isArray(r.tags)        && (r.tags        as string[]).includes(filters.tag)))    return false;
    if (filters.assigned&& !(Array.isArray(r.assigned_to) && (r.assigned_to as string[]).includes(filters.assigned))) return false;
    if (needle) {
      const hay = [r.name, r.company, r.designation, r.email, r.city, r.phone, r.remarks, r.location]
        .filter((v) => v != null)
        .map((v) => String(v).toLowerCase())
        .join(" ");
      const inArrays =
        (Array.isArray(r.tags)        && (r.tags        as string[]).some((t) => t.toLowerCase().includes(needle))) ||
        (Array.isArray(r.sector)      && (r.sector      as string[]).some((t) => t.toLowerCase().includes(needle))) ||
        (Array.isArray(r.source)      && (r.source      as string[]).some((t) => t.toLowerCase().includes(needle))) ||
        (Array.isArray(r.assigned_to) && (r.assigned_to as string[]).some((t) => t.toLowerCase().includes(needle)));
      if (!hay.includes(needle) && !inArrays) return false;
    }
    return true;
  });
}

/**
 * Server-side paginated + filtered + searched list of main_contacts.
 *
 * Query params (all optional):
 *   page, pageSize, q, optin, city, sector, source, tag, assigned
 *
 * Returns { rows: MainContactRow[], total: number, page: number, pageSize: number }.
 *
 * When the search RPC is unavailable (column mismatch on old schemas),
 * we fall back to a `fetchAll` + filter pipeline so the page still renders.
 *
 * `export=1` (instead of page/pageSize): CSV-export mode — returns ALL rows
 * matching the same filters ({ rows, total, exported: true }), looping the
 * RPC 1000 rows at a time so the CSV matches the on-screen total exactly.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q       = (sp.get("q")        ?? "").trim() || null;
  const optin   = (sp.get("optin")    ?? "").trim() || null;
  const city    = (sp.get("city")     ?? "").trim() || null;
  const sector  = (sp.get("sector")   ?? "").trim() || null;
  const source  = (sp.get("source")   ?? "").trim() || null;
  const tag     = (sp.get("tag")      ?? "").trim() || null;
  const assigned= (sp.get("assigned") ?? "").trim() || null;

  // ---- CSV export mode: ALL filtered rows, no pagination ----------------
  if (sp.get("export") === "1") {
    let rpcAvailable = true;
    const allRows: Record<string, unknown>[] = [];
    let total = 0;

    for (let pageNum = 1; pageNum <= EXPORT_MAX_PAGES; pageNum++) {
      const { data: rpcRows, error: rpcError } = await supabase.rpc("search_main_contacts" as never, {
        p_search: q,
        p_optin_status: optin,
        p_city: city,
        p_sector: sector,
        p_source: source,
        p_tag: tag,
        p_assigned_to: assigned,
        p_page: pageNum,
        p_page_size: EXPORT_PAGE_SIZE,
      } as never);
      if (rpcError || !Array.isArray(rpcRows)) {
        if (rpcError && !isMissingColumnError(rpcError.message)) {
          return NextResponse.json({ error: rpcError.message }, { status: 500 });
        }
        rpcAvailable = false;
        break;
      }
      if (rpcRows.length > 0) {
        total = Number((rpcRows[0] as Record<string, unknown>)._total_count ?? 0);
      }
      for (const r of rpcRows) {
        const { _total_count: _ignored, ...rest } = r as Record<string, unknown>;
        void _ignored;
        allRows.push(rest);
      }
      if (allRows.length >= total || rpcRows.length < EXPORT_PAGE_SIZE) break;
    }

    if (rpcAvailable) {
      return NextResponse.json({ rows: allRows, total, exported: true });
    }

    try {
      const all = await fetchAll<Record<string, unknown>>(
        "main_contacts",
        [
          { column: "created_date", ascending: false, nullsFirst: false },
          { column: "created_at",   ascending: false, nullsFirst: false },
          { column: "email",        ascending: true },
        ],
      );
      const filtered = filterMainContactsInMemory(all, { q, optin, city, sector, source, tag, assigned });
      return NextResponse.json({ rows: filtered, total: filtered.length, exported: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(sp.get("pageSize") ?? "25", 10) || 25));

  // Try the RPC path first — single round-trip, server-side filter+count.
  const rpcArgs = {
    p_search: q,
    p_optin_status: optin,
    p_city: city,
    p_sector: sector,
    p_source: source,
    p_tag: tag,
    p_assigned_to: assigned,
    p_page: page,
    p_page_size: pageSize,
  };

  const { data: rpcRows, error: rpcError } = await supabase.rpc("search_main_contacts" as never, rpcArgs as never);

  if (!rpcError && Array.isArray(rpcRows)) {
    // Strip the synthetic _total_count from each row; we use the first row's value.
    const totalFromFirst = rpcRows.length > 0 ? Number((rpcRows[0] as Record<string, unknown>)._total_count ?? 0) : 0;
    const rows = rpcRows.map((r) => {
      const { _total_count: _ignored, ...rest } = r as Record<string, unknown>;
      void _ignored;
      return rest;
    });
    return NextResponse.json({
      rows,
      total: totalFromFirst || rows.length,
      page,
      pageSize,
    });
  }

  // If the RPC isn't deployed yet (older schema), fall back to fetchAll+filter.
  // This keeps the UI functional while the migration is being applied.
  if (rpcError && !isMissingColumnError(rpcError.message)) {
    // Real error (network, auth, etc.) — surface it.
    return NextResponse.json({ error: rpcError.message }, { status: 500 });
  }

  try {
    const all = await fetchAll<Record<string, unknown>>(
      "main_contacts",
      [
        { column: "created_date", ascending: false, nullsFirst: false },
        { column: "created_at",   ascending: false, nullsFirst: false },
        { column: "email",        ascending: true },
      ],
    );
    const filtered = filterMainContactsInMemory(all, { q, optin, city, sector, source, tag, assigned });
    const total = filtered.length;
    const start = (page - 1) * pageSize;
    const rows = filtered.slice(start, start + pageSize);
    return NextResponse.json({ rows, total, page, pageSize });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  // merge_arrays=true → UNION array fields (tags, source, sector, assigned_to)
  // with existing DB values instead of replacing them. Used by the GEM
  // chatbot so it can add "chatbot"/"gem-chatbot" tags without wiping
  // pre-existing tags.
  const mergeArrays = req.nextUrl.searchParams.get("merge_arrays") === "true";
  if (!body?.email) return NextResponse.json({ error: "email is required" }, { status: 400 });
  body.email = String(body.email).trim().toLowerCase();
  if (body.tags !== undefined) body.tags = normalizeArray(body.tags);
  if (body.sector !== undefined) body.sector = normalizeArray(body.sector);
  if (body.source !== undefined) body.source = normalizeArray(body.source);
  if (body.assigned_to !== undefined) body.assigned_to = normalizeArray(body.assigned_to);
  if (body.optin_status !== undefined) body.optin_status = normalizeOptinStatus(body.optin_status);
  // Phone: expand scientific notation from Excel exports
  // (e.g. "9.71529E+11" → "971529000000"). Empty string is preserved
  // (so the user can intentionally clear the field).
  if (body.phone !== undefined && body.phone !== null && body.phone !== "") {
    const expanded = normalizePhone(body.phone);
    if (expanded !== null) body.phone = expanded;
  }
  // created_date is server-managed (set once on INSERT, never updated).
  // Strip it from incoming payloads to prevent client override.
  for (const f of ["created_at", "updated_at", "created_date"]) delete body[f];

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
        if (mergeArrays) {
          // UNION: merge new values into existing array (dedup, preserve order)
          const existingArr = Array.isArray(existingRow[k]) ? (existingRow[k] as string[]) : [];
          const newArr = Array.isArray(v) ? v : [];
          const seen = new Set(existingArr.map((s) => String(s).toLowerCase()));
          const union = [...existingArr];
          for (const item of newArr) {
            if (!seen.has(String(item).toLowerCase())) {
              union.push(item);
              seen.add(String(item).toLowerCase());
            }
          }
          merged[k] = union;
        } else {
          // Always use the new value — if user cleared all tags, the array is []
          // and we should write [] to the DB (clearing the field).
          // The old merge logic (skip if empty) prevented intentional clearing.
          merged[k] = Array.isArray(v) ? v : [];
        }
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

  // Email doesn't exist — INSERT new record.
  // Set created_date to today (YYYY-MM-DD, India timezone).
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const insertPayload = { ...body, created_date: today };
  const { data: insertData, error: insertError } = await supabase
    .from("main_contacts")
    .insert(insertPayload)
    .select();
  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });
  const insertResult = Array.isArray(insertData) && insertData.length > 0 ? insertData[0] : insertData;
  return NextResponse.json(insertResult, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  // merge_arrays=true → UNION array fields (tags, source, sector, assigned_to)
  // with existing DB values instead of replacing them. Used by the GEM
  // chatbot so it can add "chatbot"/"gem-chatbot" tags without wiping
  // pre-existing tags.
  const mergeArrays = req.nextUrl.searchParams.get("merge_arrays") === "true";
  const { email: lookupEmail, ...fields } = body;
  if (!lookupEmail) return NextResponse.json({ error: "email is required" }, { status: 400 });

  for (const f of ["created_at", "updated_at", "created_date"]) delete fields[f];

  // Normalize array fields
  if (fields.tags !== undefined) fields.tags = normalizeArray(fields.tags);
  if (fields.sector !== undefined) fields.sector = normalizeArray(fields.sector);
  if (fields.source !== undefined) fields.source = normalizeArray(fields.source);
  if (fields.assigned_to !== undefined) fields.assigned_to = normalizeArray(fields.assigned_to);
  if (fields.optin_status !== undefined) fields.optin_status = normalizeOptinStatus(fields.optin_status);
  // Phone: expand scientific notation from Excel exports
  if (fields.phone !== undefined && fields.phone !== null && fields.phone !== "") {
    const expanded = normalizePhone(fields.phone);
    if (expanded !== null) fields.phone = expanded;
  }

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

    // For array fields (tags, sector, source, assigned_to):
    if (k === "tags" || k === "sector" || k === "source" || k === "assigned_to") {
      if (mergeArrays) {
        // UNION: merge new values into existing array (dedup, preserve order)
        const existingArr = Array.isArray(existingRow[k]) ? (existingRow[k] as string[]) : [];
        const newArr = Array.isArray(v) ? v : [];
        const seen = new Set(existingArr.map((s) => String(s).toLowerCase()));
        const union = [...existingArr];
        for (const item of newArr) {
          if (!seen.has(String(item).toLowerCase())) {
            union.push(item);
            seen.add(String(item).toLowerCase());
          }
        }
        mergedFields[k] = union;
      } else {
        // Always use the new value — if user cleared all tags, write [] to DB.
        mergedFields[k] = Array.isArray(v) ? v : [];
      }
      continue;
    }

    // Text fields: if the new value is empty string, CLEAR the field.
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
    // Chunk the deletes — Supabase's .in() filter bails on very large arrays
    // (URL length + query planner limits). 500 per batch is a safe ceiling.
    // `.select("email")` returns the rows actually deleted so the UI can
    // report an accurate count + not-found list.
    const BATCH = 500;
    const emails = body.emails.map((e: string) => String(e).toLowerCase()).filter(Boolean);
    if (emails.length === 0) return NextResponse.json({ error: "emails array is empty" }, { status: 400 });
    const requested = new Set<string>(emails);
    let deletedCount = 0;
    const foundEmails = new Set<string>();
    const errors: string[] = [];
    for (let i = 0; i < emails.length; i += BATCH) {
      const batch = emails.slice(i, i + BATCH);
      const { data: deletedRows, error } = await supabase
        .from("main_contacts")
        .delete()
        .in("email", batch)
        .select("email");
      if (error) {
        errors.push(`Batch ${Math.floor(i / BATCH) + 1}: ${error.message}`);
      } else {
        deletedCount += (deletedRows ?? []).length;
        for (const r of deletedRows ?? []) foundEmails.add(String(r.email).toLowerCase());
      }
    }
    const notFound = Array.from(requested).filter((e) => !foundEmails.has(e));
    if (errors.length > 0) {
      return NextResponse.json(
        { error: `Some batches failed: ${errors.join("; ")}`, deleted: deletedCount, notFound },
        { status: 500 }
      );
    }
    return NextResponse.json({ success: true, deleted: deletedCount, notFound });
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
