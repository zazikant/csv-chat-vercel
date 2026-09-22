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

  // Validate: every row must have an email (PK)
  const missingEmail = rows.findIndex((r: Record<string, unknown>) => !r?.email);
  if (missingEmail !== -1) {
    return NextResponse.json(
      { error: `Row ${missingEmail + 1} is missing required field: email` },
      { status: 400 }
    );
  }

  // Strip auto-managed / generated fields before insert
  const cleaned = rows.map((r: Record<string, unknown>) => {
    const copy = { ...r };
    for (const f of [
      "total_sent","total_opens","total_clicks","last_activity_date",
      "engagement_score","created_at","updated_at","legacy_id","legacy_remarks",
    ]) {
      delete copy[f];
    }
    return copy;
  });

  const { data, error } = await supabase
    .from("contacts")
    .upsert(cleaned, { onConflict: "email", ignoreDuplicates: false })
    .select();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ inserted: data?.length ?? 0, records: data }, { status: 201 });
}
