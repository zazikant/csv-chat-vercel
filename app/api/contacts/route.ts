import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET() {
  const { data, error } = await supabase
    .from("contacts")
    .select("*")
    .order("email", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const body = await req.json();

  // email is the PK - require it
  if (!body?.email) {
    return NextResponse.json({ error: "email is required" }, { status: 400 });
  }

  // Strip auto-maintained fields - they are managed by the trigger
  for (const f of [
    "last_activity_date","engagement_score","created_at","updated_at",
  ]) {
    delete body[f];
  }

  // Ensure numeric defaults
  if (body.opens == null || body.opens === "") body.opens = 0;
  if (body.clicks == null || body.clicks === "") body.clicks = 0;
  body.opens  = Number(body.opens)  || 0;
  body.clicks = Number(body.clicks) || 0;
  if (body.unsubscribed == null) body.unsubscribed = false;
  body.unsubscribed = Boolean(body.unsubscribed);

  const { data, error } = await supabase
    .from("contacts")
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
  const { email, ...fields } = body;

  if (!email) {
    return NextResponse.json({ error: "email is required" }, { status: 400 });
  }

  // Strip auto-maintained fields - they are managed by the trigger
  for (const f of [
    "last_activity_date","engagement_score","created_at","updated_at",
  ]) {
    delete fields[f];
  }

  // Coerce numeric/boolean fields if present
  if ("opens" in fields) {
    fields.opens = fields.opens === "" || fields.opens == null ? 0 : Number(fields.opens) || 0;
  }
  if ("clicks" in fields) {
    fields.clicks = fields.clicks === "" || fields.clicks == null ? 0 : Number(fields.clicks) || 0;
  }
  if ("unsubscribed" in fields) {
    fields.unsubscribed = Boolean(fields.unsubscribed);
  }

  const { data, error } = await supabase
    .from("contacts")
    .update(fields)
    .eq("email", email)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest) {
  const body = await req.json();

  if (Array.isArray(body.emails)) {
    const { error } = await supabase
      .from("contacts")
      .delete()
      .in("email", body.emails);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true, deleted: body.emails.length });
  }

  const { email } = body;
  if (!email) {
    return NextResponse.json({ error: "email or emails is required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("contacts")
    .delete()
    .eq("email", email);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
