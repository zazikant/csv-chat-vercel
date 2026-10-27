import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { fetchAll } from "@/lib/fetchAll";

function isMissingColumnError(msg: string): boolean {
  return /column .* does not exist|relation .* does not exist|function .* does not exist|Could not find the function/.test(msg);
}

const EXPORT_PAGE_SIZE = 1000;
const EXPORT_MAX_PAGES = 200; // hard cap: 200 × 1000 = 200k rows

interface MailerFilters {
  q: string | null;
  minOpen: number | null;
  minClick: number | null;
  minUnsub: number | null;
  minBounce: number | null;
  sentAfter: string | null;
  sentBefore: string | null;
  hasUnsub: string | null;
  hasBounced: string | null;
}

function parseMailerFilters(sp: URLSearchParams): MailerFilters {
  const num = (v: string | null) => (v !== null && !isNaN(Number(v)) ? Number(v) : null);
  return {
    q:          (sp.get("q")          ?? "").trim() || null,
    minOpen:    num((sp.get("minOpen")    ?? "").trim() || null),
    minClick:   num((sp.get("minClick")   ?? "").trim() || null),
    minUnsub:   num((sp.get("minUnsub")   ?? "").trim() || null),
    minBounce:  num((sp.get("minBounce")  ?? "").trim() || null),
    sentAfter:  (sp.get("sentAfter")  ?? "").trim() || null,
    sentBefore: (sp.get("sentBefore") ?? "").trim() || null,
    hasUnsub:   (sp.get("hasUnsub")   ?? "").trim() || null,
    hasBounced: (sp.get("hasBounced") ?? "").trim() || null,
  };
}

function toRpcArgs(f: MailerFilters, sortBy: string | null, sortDir: "asc" | "desc", page: number, pageSize: number) {
  return {
    p_search: f.q,
    p_min_open_rate: f.minOpen,
    p_min_click_rate: f.minClick,
    p_min_unsubscribe_rate: f.minUnsub,
    p_min_hardbounce_rate: f.minBounce,
    p_sent_after: f.sentAfter,
    p_sent_before: f.sentBefore,
    p_has_unsubscribed: f.hasUnsub === "yes" || f.hasUnsub === "no" ? f.hasUnsub : null,
    p_has_hardbounced: f.hasBounced === "yes" || f.hasBounced === "no" ? f.hasBounced : null,
    p_sort_by: sortBy,
    p_sort_dir: sortDir,
    p_page: page,
    p_page_size: pageSize,
  };
}

/** In-memory filter + sort used by the no-RPC fallback paths. Mirrors search_mailers semantics. */
function filterSortMailersInMemory(
  all: Record<string, unknown>[],
  f: MailerFilters,
  sortBy: string | null,
  sortDir: "asc" | "desc",
): Record<string, unknown>[] {
  const needle = f.q ? f.q.toLowerCase() : null;
  const after = f.sentAfter ? new Date(f.sentAfter).getTime() : null;
  const before = f.sentBefore ? new Date(f.sentBefore).getTime() : null;
  const filtered = all.filter((r) => {
    if (needle) {
      const hay = [r.mailer_id, r.subject_line, r.template_name]
        .filter((v) => v != null)
        .map((v) => String(v).toLowerCase())
        .join(" ");
      if (!hay.includes(needle)) return false;
    }
    if (f.minOpen   !== null && Number(r.open_rate ?? 0)          < f.minOpen)   return false;
    if (f.minClick  !== null && Number(r.click_rate ?? 0)         < f.minClick)  return false;
    if (f.minUnsub  !== null && Number(r.unsubscribe_rate ?? 0)   < f.minUnsub)  return false;
    if (f.minBounce !== null && Number(r.hardbounce_rate ?? 0)    < f.minBounce) return false;
    if (after  !== null && (!r.sent_date || new Date(String(r.sent_date)).getTime() < after))  return false;
    if (before !== null && (!r.sent_date || new Date(String(r.sent_date)).getTime() > before)) return false;
    if (f.hasUnsub === "yes" && Number(r.unsubscribed_count ?? 0) === 0) return false;
    if (f.hasUnsub === "no"  && Number(r.unsubscribed_count ?? 0) > 0)  return false;
    if (f.hasBounced === "yes" && Number(r.hardbounced_count ?? 0) === 0) return false;
    if (f.hasBounced === "no"  && Number(r.hardbounced_count ?? 0) > 0)  return false;
    return true;
  });
  if (sortBy) {
    filtered.sort((a, b) => {
      const av = a[sortBy]; const bv = b[sortBy];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      const cmp = typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
  }
  return filtered;
}

const SORTABLE = new Set([
  "mailer_id", "subject_line", "sent_date", "total_sent", "unique_opens",
  "unique_clicks", "unsubscribed_count", "hardbounced_count",
  "open_rate", "click_rate", "unsubscribe_rate", "hardbounce_rate",
]);

export async function GET(req: NextRequest) {
  const { searchParams: sp } = new URL(req.url);
  const valuesOnly = sp.get("values") === "1";

  if (valuesOnly) {
    // Lightweight endpoint used by the contact form's mailer_id autocomplete.
    // Returns just [{ mailer_id, subject_line }] sorted by mailer_id.
    const { data, error } = await supabase
      .from("mailers")
      .select("mailer_id,subject_line")
      .order("mailer_id", { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json(data ?? []);
  }

  // Server-side paginated path (MailersTable). Without `page`, the legacy
  // full-array shape is returned.
  // `export=1` (instead of page/pageSize): CSV-export mode — ALL filtered
  // rows ({ rows, total, exported: true }), looping the RPC 1000 at a time.
  if (sp.get("export") === "1") {
    const f = parseMailerFilters(sp);
    const sortByRaw = (sp.get("sortBy") ?? "").trim() || null;
    const sortBy = sortByRaw && SORTABLE.has(sortByRaw) ? sortByRaw : null;
    const sortDir = (sp.get("sortDir") ?? "").trim().toLowerCase() === "asc" ? "asc" : "desc";

    let rpcAvailable = true;
    const allRows: Record<string, unknown>[] = [];
    let total = 0;

    for (let pageNum = 1; pageNum <= EXPORT_MAX_PAGES; pageNum++) {
      const { data: rpcRows, error: rpcError } = await supabase.rpc("search_mailers", toRpcArgs(f, sortBy, sortDir, pageNum, EXPORT_PAGE_SIZE));
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
      const all = await fetchAll<Record<string, unknown>>("mailers", [{ column: "sent_date", ascending: false, nullsFirst: false }]);
      const filtered = filterSortMailersInMemory(all, f, sortBy, sortDir);
      return NextResponse.json({ rows: filtered, total: filtered.length, exported: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  if (sp.has("page")) {
    const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(sp.get("pageSize") ?? "25", 10) || 25));
    const f = parseMailerFilters(sp);
    const sortByRaw = (sp.get("sortBy") ?? "").trim() || null;
    const sortBy = sortByRaw && SORTABLE.has(sortByRaw) ? sortByRaw : null;
    const sortDir = (sp.get("sortDir") ?? "").trim().toLowerCase() === "asc" ? "asc" : "desc";

    const rpcArgs = toRpcArgs(f, sortBy, sortDir, page, pageSize);

    const { data: rpcRows, error: rpcError } = await supabase.rpc("search_mailers", rpcArgs);

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

    // Fallback: fetchAll + in-memory filter/sort (older schema without the RPC).
    try {
      const all = await fetchAll<Record<string, unknown>>("mailers", [{ column: "sent_date", ascending: false, nullsFirst: false }]);
      const filtered = filterSortMailersInMemory(all, f, sortBy, sortDir);
      const start = (page - 1) * pageSize;
      return NextResponse.json({ rows: filtered.slice(start, start + pageSize), total: filtered.length, page, pageSize });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  // Legacy: full mailer records as a bare array (ordered sent_date DESC).
  try {
    const rows = await fetchAll(
      "mailers",
      [{ column: "sent_date", ascending: false, nullsFirst: false }],
    );
    return NextResponse.json(rows);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json();

  if (!body?.mailer_id) {
    return NextResponse.json({ error: "mailer_id is required" }, { status: 400 });
  }
  if (!body?.subject_line) {
    return NextResponse.json({ error: "subject_line is required" }, { status: 400 });
  }

  // Strip auto-maintained / generated fields
  for (const f of [
    "total_sent","unique_opens","total_opens","unique_clicks",
    "total_clicks","unsubscribed_count","open_rate","click_rate",
    "unsubscribe_rate","created_at","updated_at",
  ]) {
    delete body[f];
  }

  const { data, error } = await supabase
    .from("mailers")
    .insert(body)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const { mailer_id, ...fields } = body;

  if (!mailer_id) {
    return NextResponse.json({ error: "mailer_id is required" }, { status: 400 });
  }

  // Strip auto-maintained / generated fields
  for (const f of [
    "total_sent","unique_opens","total_opens","unique_clicks",
    "total_clicks","unsubscribed_count","open_rate","click_rate",
    "unsubscribe_rate","created_at","updated_at",
  ]) {
    delete fields[f];
  }

  const { data, error } = await supabase
    .from("mailers")
    .update(fields)
    .eq("mailer_id", mailer_id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest) {
  const body = await req.json();

  if (Array.isArray(body.mailer_ids)) {
    // .select("mailer_id") returns the rows actually deleted so the UI can
    // report an accurate count + not-found list.
    const requested: string[] = body.mailer_ids.map((m: string) => String(m).trim());
    const { data: deletedRows, error } = await supabase
      .from("mailers")
      .delete()
      .in("mailer_id", requested)
      .select("mailer_id");

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const found = new Set((deletedRows ?? []).map((r: { mailer_id: string }) => r.mailer_id));
    const notFound = requested.filter((m) => !found.has(m));
    return NextResponse.json({ success: true, deleted: (deletedRows ?? []).length, notFound });
  }

  const { mailer_id } = body;
  if (!mailer_id) {
    return NextResponse.json({ error: "mailer_id or mailer_ids is required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("mailers")
    .delete()
    .eq("mailer_id", mailer_id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
