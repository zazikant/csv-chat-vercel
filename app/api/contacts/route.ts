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

/**
 * If the payload references a mailer_id that doesn't exist yet, lazily create
 * a stub mailer so the contact FK is satisfied. The user can fill in
 * subject_line / sent_date later in the Mailers tab.
 *
 * This avoids the "violates foreign key constraint contacts_mailer_id_fkey"
 * error when a user types a new mailer_id directly in the contact form
 * without first going to the Mailers tab.
 */
async function ensureMailerExists(mailerId: string): Promise<{ ok: boolean; error?: string }> {
  if (!mailerId) return { ok: true };
  const trimmed = mailerId.trim();
  if (!trimmed) return { ok: true };

  // Check if it already exists
  const { data: existing, error: selErr } = await supabase
    .from("mailers")
    .select("mailer_id")
    .eq("mailer_id", trimmed)
    .maybeSingle();

  if (selErr) return { ok: false, error: selErr.message };
  if (existing) return { ok: true };

  // Lazily create a stub mailer with subject_line = mailer_id (placeholder)
  const { error: insErr } = await supabase
    .from("mailers")
    .insert({
      mailer_id: trimmed,
      subject_line: `(auto-created from contact form — edit in Mailers tab)`,
      template_name: null,
      sent_date: null,
    });

  if (insErr) return { ok: false, error: insErr.message };
  return { ok: true };
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
    // v2 removed these but strip anyway in case caller sends them
    "total_sent","total_opens","total_clicks","unsubscribed_count",
  ]) {
    delete body[f];
  }

  // Ensure numeric defaults
  if (body.opens == null || body.opens === "") body.opens = 0;
  if (body.clicks == null || body.clicks === "") body.clicks = 0;
  body.opens  = Number(body.opens)  || 0;
  body.clicks = Number(body.clicks) || 0;

  // v2: unsubscribed is removed - the optin_status dropdown covers it.
  // Strip it in case an old client still sends it.
  delete body.unsubscribed;

  // If a mailer_id is provided, ensure that mailer exists (lazy create)
  if (body.mailer_id) {
    const ensured = await ensureMailerExists(body.mailer_id);
    if (!ensured.ok) {
      return NextResponse.json({ error: ensured.error || "Failed to ensure mailer exists" }, { status: 400 });
    }
  }

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
    "total_sent","total_opens","total_clicks","unsubscribed_count",
  ]) {
    delete fields[f];
  }

  // Coerce numeric fields if present
  if ("opens" in fields) {
    fields.opens = fields.opens === "" || fields.opens == null ? 0 : Number(fields.opens) || 0;
  }
  if ("clicks" in fields) {
    fields.clicks = fields.clicks === "" || fields.clicks == null ? 0 : Number(fields.clicks) || 0;
  }

  // v2: unsubscribed is removed - the optin_status dropdown covers it.
  delete fields.unsubscribed;

  // If mailer_id is changing, ensure the new mailer exists (lazy create)
  if (fields.mailer_id) {
    const ensured = await ensureMailerExists(fields.mailer_id);
    if (!ensured.ok) {
      return NextResponse.json({ error: ensured.error || "Failed to ensure mailer exists" }, { status: 400 });
    }
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
