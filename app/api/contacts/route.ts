import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

/**
 * Normalize opt-in status to one of the 3 canonical values.
 * Accepts "Hardbounced", "hard-bounced", "HB", "bounced" → "Hard Bounced"
 * Accepts "Unsub", "opted out" → "Unsubscribed"
 * Accepts "sub", "active", "opted in" → "Subscribed"
 */
function normalizeOptinStatus(raw: string | undefined | null): string {
  const s = (raw ?? "").trim().toLowerCase().replace(/[-_\s]+/g, " ");
  if (s === "hard bounced" || s === "hardbounced" || s === "hb" || s === "bounced" || s === "hard") return "Hard Bounced";
  if (s === "unsubscribed" || s === "unsub" || s === "opted out" || s === "opt out" || s === "optout") return "Unsubscribed";
  if (s === "subscribed" || s === "sub" || s === "active" || s === "opted in" || s === "opt in" || s === "optin" || s === "") return "Subscribed";
  return "Subscribed";  // safe default for unrecognized
}

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
 * a stub mailer so the contact FK is satisfied.
 */
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

/** Normalize tags: trim + lowercase + dedupe + drop empties. */
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

export async function POST(req: NextRequest) {
  const body = await req.json();

  if (!body?.email) {
    return NextResponse.json({ error: "email is required" }, { status: 400 });
  }

  // Strip auto-maintained fields - they are managed by the trigger
  for (const f of [
    "last_activity_date","engagement_score","created_at","updated_at",
    "total_sent","total_opens","total_clicks","unsubscribed_count",
    "hardbounced_count",
  ]) {
    delete body[f];
  }

  if (body.opens == null || body.opens === "") body.opens = 0;
  if (body.clicks == null || body.clicks === "") body.clicks = 0;
  body.opens  = Number(body.opens)  || 0;
  body.clicks = Number(body.clicks) || 0;

  // v2: unsubscribed is removed - the optin_status dropdown covers it.
  delete body.unsubscribed;

  // Normalize opt-in status (handles "Hardbounced", "hard-bounced", "HB" etc.)
  if (body.optin_status !== undefined) {
    body.optin_status = normalizeOptinStatus(body.optin_status);
  }

  // v2.2: normalize tags
  body.tags = normalizeTags(body.tags);

  if (body.mailer_id) {
    const ensured = await ensureMailerExists(body.mailer_id);
    if (!ensured.ok) {
      return NextResponse.json({ error: ensured.error || "Failed to ensure mailer exists" }, { status: 400 });
    }
  }

  // Use UPSERT instead of INSERT so that if the email already exists (e.g.,
  // the user clicked "Add Contact" with an email that's already in the DB
  // — which can happen because the form auto-fills fields from existing
  // records), the existing contact is UPDATED rather than throwing
  // "duplicate key value violates unique constraint contacts_pkey".
  const { data, error } = await supabase
    .from("contacts")
    .upsert(body, { onConflict: "email", ignoreDuplicates: false })
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

  for (const f of [
    "last_activity_date","engagement_score","created_at","updated_at",
    "total_sent","total_opens","total_clicks","unsubscribed_count",
    "hardbounced_count",
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

  // Normalize opt-in status (handles "Hardbounced", "hard-bounced", "HB" etc.)
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
