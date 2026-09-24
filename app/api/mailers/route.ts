import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { fetchAll } from "@/lib/fetchAll";

function isMissingColumnError(msg: string): boolean {
  return /column .* does not exist|relation .* does not exist|function .* does not exist|Could not find the function/.test(msg);
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
  if (sp.has("page")) {
    const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(sp.get("pageSize") ?? "25", 10) || 25));
    const q           = (sp.get("q")          ?? "").trim() || null;
    const minOpen     = (sp.get("minOpen")    ?? "").trim() || null;
    const minClick    = (sp.get("minClick")   ?? "").trim() || null;
    const minUnsub    = (sp.get("minUnsub")   ?? "").trim() || null;
    const minBounce   = (sp.get("minBounce")  ?? "").trim() || null;
    const sentAfter   = (sp.get("sentAfter")  ?? "").trim() || null;
    const sentBefore  = (sp.get("sentBefore") ?? "").trim() || null;
    const hasUnsub    = (sp.get("hasUnsub")   ?? "").trim() || null;
    const hasBounced  = (sp.get("hasBounced") ?? "").trim() || null;
    const sortByRaw   = (sp.get("sortBy")     ?? "").trim() || null;
    const sortBy      = sortByRaw && SORTABLE.has(sortByRaw) ? sortByRaw : null;
    const sortDir     = (sp.get("sortDir")    ?? "").trim().toLowerCase() === "asc" ? "asc" : "desc";

    const rpcArgs = {
      p_search: q,
      p_min_open_rate: minOpen !== null && !isNaN(Number(minOpen)) ? Number(minOpen) : null,
      p_min_click_rate: minClick !== null && !isNaN(Number(minClick)) ? Number(minClick) : null,
      p_min_unsubscribe_rate: minUnsub !== null && !isNaN(Number(minUnsub)) ? Number(minUnsub) : null,
      p_min_hardbounce_rate: minBounce !== null && !isNaN(Number(minBounce)) ? Number(minBounce) : null,
      p_sent_after: sentAfter,
      p_sent_before: sentBefore,
      p_has_unsubscribed: hasUnsub === "yes" || hasUnsub === "no" ? hasUnsub : null,
      p_has_hardbounced: hasBounced === "yes" || hasBounced === "no" ? hasBounced : null,
      p_sort_by: sortBy,
      p_sort_dir: sortDir,
      p_page: page,
      p_page_size: pageSize,
    };

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
      const needle = q ? q.toLowerCase() : null;
      const num = (v: string | null) => (v !== null && !isNaN(Number(v)) ? Number(v) : null);
      const mo = num(minOpen), mc = num(minClick), mu = num(minUnsub), mb = num(minBounce);
      const after = sentAfter ? new Date(sentAfter).getTime() : null;
      const before = sentBefore ? new Date(sentBefore).getTime() : null;
      const filtered = all.filter((r) => {
        if (needle) {
          const hay = [r.mailer_id, r.subject_line, r.template_name]
            .filter((v) => v != null)
            .map((v) => String(v).toLowerCase())
            .join(" ");
          if (!hay.includes(needle)) return false;
        }
        if (mo !== null && Number(r.open_rate ?? 0) < mo) return false;
        if (mc !== null && Number(r.click_rate ?? 0) < mc) return false;
        if (mu !== null && Number(r.unsubscribe_rate ?? 0) < mu) return false;
        if (mb !== null && Number(r.hardbounce_rate ?? 0) < mb) return false;
        if (after !== null && (!r.sent_date || new Date(String(r.sent_date)).getTime() < after)) return false;
        if (before !== null && (!r.sent_date || new Date(String(r.sent_date)).getTime() > before)) return false;
        if (hasUnsub === "yes" && Number(r.unsubscribed_count ?? 0) === 0) return false;
        if (hasUnsub === "no" && Number(r.unsubscribed_count ?? 0) > 0) return false;
        if (hasBounced === "yes" && Number(r.hardbounced_count ?? 0) === 0) return false;
        if (hasBounced === "no" && Number(r.hardbounced_count ?? 0) > 0) return false;
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
    const { error } = await supabase
      .from("mailers")
      .delete()
      .in("mailer_id", body.mailer_ids);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true, deleted: body.mailer_ids.length });
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
