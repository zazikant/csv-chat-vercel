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

export async function GET() {
  // Supabase caps every SELECT to 1000 rows — paginate past it via fetchAll().
  try {
    const rows = await fetchAll("contacts", [{ column: "id", ascending: false }]);
    return NextResponse.json(rows);
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
  if (Array.isArray(body.ids)) {
    const { error } = await supabase.from("contacts").delete().in("id", body.ids);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, deleted: body.ids.length });
  }
  const { id } = body;
  if (!id) return NextResponse.json({ error: "id or ids is required" }, { status: 400 });
  const { error } = await supabase.from("contacts").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
