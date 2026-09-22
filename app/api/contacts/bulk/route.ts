import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { rows } = body;

  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "rows array is required" }, { status: 400 });
  }

  if (rows.length > 500) {
    return NextResponse.json({ error: "Maximum 500 rows per upload" }, { status: 400 });
  }

  // Validate + clean each row
  const cleaned: Record<string, unknown>[] = [];
  const mailerIdsToEnsure = new Set<string>();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] as Record<string, unknown>;
    if (!r?.email) {
      return NextResponse.json(
        { error: `Row ${i + 1} is missing required field: email` },
        { status: 400 }
      );
    }
    const copy: Record<string, unknown> = { ...r };
    for (const f of [
      "last_activity_date","engagement_score","created_at","updated_at",
      "total_sent","total_opens","total_clicks","unsubscribed_count",
    ]) {
      delete copy[f];
    }
    if (copy.opens == null || copy.opens === "") copy.opens = 0;
    if (copy.clicks == null || copy.clicks === "") copy.clicks = 0;
    copy.opens  = Number(copy.opens)  || 0;
    copy.clicks = Number(copy.clicks) || 0;
    // v2: unsubscribed removed - optin_status dropdown covers it
    delete copy.unsubscribed;
    // Collect mailer_ids to lazily create
    if (typeof copy.mailer_id === "string" && copy.mailer_id.trim()) {
      mailerIdsToEnsure.add(copy.mailer_id.trim());
    }
    cleaned.push(copy);
  }

  // Lazily create any mailers that don't exist yet
  if (mailerIdsToEnsure.size > 0) {
    const ids = Array.from(mailerIdsToEnsure);
    // Fetch existing mailer_ids
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

  const { data, error } = await supabase
    .from("contacts")
    .upsert(cleaned, { onConflict: "email", ignoreDuplicates: false })
    .select();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ inserted: data?.length ?? 0, records: data }, { status: 201 });
}
