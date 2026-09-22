import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

/**
 * Normalize opt-in status to one of the 3 canonical values.
 */
function normalizeOptinStatus(raw: string | undefined | null): string {
  const s = (raw ?? "").trim().toLowerCase().replace(/[-_\s]+/g, " ");
  if (s === "hard bounced" || s === "hardbounced" || s === "hb" || s === "bounced" || s === "hard") return "Hard Bounced";
  if (s === "unsubscribed" || s === "unsub" || s === "opted out" || s === "opt out" || s === "optout") return "Unsubscribed";
  if (s === "subscribed" || s === "sub" || s === "active" || s === "opted in" || s === "opt in" || s === "optin" || s === "") return "Subscribed";
  return "Subscribed";
}

/** Normalize tags: trim + lowercase + dedupe. */
function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags) {
    if (typeof t !== "string") continue;
    const tag = t.trim().toLowerCase();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

export async function GET() {
  const { data, error } = await supabase
    .from("contacts")
    .select("*")
    .order("id", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}

/** If the payload references a mailer_id that doesn't exist yet, lazily create a stub. */
async function ensureMailerExists(mailerId: string): Promise<{ ok: boolean; error?: string }> {
  if (!mailerId) return { ok: true };
  const trimmed = mailerId.trim();
  if (!trimmed) return { ok: true };

  const { data: existing, error: selErr } = await supabase
    .from("mailers")
    .select("mailer_id")
    .eq("mailer_id", trimmed)
    .maybeSingle();

  if (selErr) return { ok: false, error: selErr.message };
  if (existing) return { ok: true };

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

  if (!body?.email) {
    return NextResponse.json({ error: "email is required" }, { status: 400 });
  }

  // Strip auto-maintained fields
  for (const f of [
    "id", "last_activity_date", "engagement_score", "created_at", "updated_at",
    "total_sent", "total_opens", "total_clicks", "unsubscribed_count", "hardbounced_count",
  ]) {
    delete body[f];
  }

  // Normalize email to lowercase
  body.email = String(body.email).trim().toLowerCase();

  if (body.opens == null || body.opens === "") body.opens = 0;
  if (body.clicks == null || body.clicks === "") body.clicks = 0;
  body.opens  = Number(body.opens)  || 0;
  body.clicks = Number(body.clicks) || 0;

  delete body.unsubscribed;

  if (body.optin_status !== undefined) {
    body.optin_status = normalizeOptinStatus(body.optin_status);
  }

  body.tags = normalizeTags(body.tags);

  if (body.mailer_id) {
    const ensured = await ensureMailerExists(body.mailer_id);
    if (!ensured.ok) {
      return NextResponse.json({ error: ensured.error || "Failed to ensure mailer exists" }, { status: 400 });
    }
  }

  // Check if a row with the same (email, mailer_id) already exists.
  // If so, UPDATE it. If not, INSERT a new row.
  // This allows the same email to appear multiple times (one per mailer).
  const mailerId = body.mailer_id || null;

  let existingId: number | null = null;
  if (mailerId) {
    const { data: existing } = await supabase
      .from("contacts")
      .select("id")
      .eq("email", body.email)
      .eq("mailer_id", mailerId)
      .maybeSingle();
    if (existing) {
      existingId = (existing as { id: number }).id;
    }
  }

  if (existingId) {
    // UPDATE existing row with same (email, mailer_id)
    const { data, error } = await supabase
      .from("contacts")
      .update(body)
      .eq("id", existingId)
      .select()
      .single();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json(data, { status: 200 });
  }

  // INSERT a new row
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
  const { id, ...fields } = body;

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  // Strip auto-maintained + immutable fields
  for (const f of [
    "id", "last_activity_date", "engagement_score", "created_at", "updated_at",
    "total_sent", "total_opens", "total_clicks", "unsubscribed_count", "hardbounced_count",
  ]) {
    delete fields[f];
  }

  if ("opens" in fields) {
    fields.opens = fields.opens === "" || fields.opens == null ? 0 : Number(fields.opens) || 0;
  }
  if ("clicks" in fields) {
    fields.clicks = fields.clicks === "" || fields.clicks == null ? 0 : Number(fields.clicks) || 0;
  }

  delete fields.unsubscribed;

  if (fields.optin_status !== undefined) {
    fields.optin_status = normalizeOptinStatus(fields.optin_status);
  }

  if ("tags" in fields) {
    fields.tags = normalizeTags(fields.tags);
  }

  if (fields.mailer_id) {
    const ensured = await ensureMailerExists(fields.mailer_id);
    if (!ensured.ok) {
      return NextResponse.json({ error: ensured.error || "Failed to ensure mailer exists" }, { status: 400 });
    }
  }

  const { data, error } = await supabase
    .from("contacts")
    .update(fields)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest) {
  const body = await req.json();

  // Support both {ids: [1,2,3]} and {id: 1}
  if (Array.isArray(body.ids)) {
    const { error } = await supabase
      .from("contacts")
      .delete()
      .in("id", body.ids);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true, deleted: body.ids.length });
  }

  const { id } = body;
  if (!id) {
    return NextResponse.json({ error: "id or ids is required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("contacts")
    .delete()
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
