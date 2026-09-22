import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET() {
  const { data, error } = await supabase
    .from("mailers")
    .select("*")
    .order("sent_date", { ascending: false, nullsFirst: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
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
    "total_sent","delivered","unique_opens","total_opens","unique_clicks",
    "total_clicks","bounced","unsubscribed","open_rate","click_rate",
    "created_at","updated_at",
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
    "total_sent","delivered","unique_opens","total_opens","unique_clicks",
    "total_clicks","bounced","unsubscribed","open_rate","click_rate",
    "created_at","updated_at",
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
