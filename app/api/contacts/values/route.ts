import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const column = searchParams.get("column") || "";

  if (!column) {
    return NextResponse.json({ error: "column is required" }, { status: 400 });
  }

  // Allow listing existing mailer_ids too (for the contact form's autocomplete)
  const allowedColumns = [
    "name", "company", "designation", "phone", "city", "sector",
    "optin_status", "engagement_score", "mailer_id",
  ];

  if (!allowedColumns.includes(column)) {
    return NextResponse.json({ error: "Invalid column" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("contacts")
    .select(column)
    .not(column, "is", null)
    .order(column, { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const raw = data as unknown as Array<Record<string, unknown>> | null;
  const values = [...new Set((raw || []).map((r) => String(r[column])).filter(Boolean))];

  return NextResponse.json({ values });
}
