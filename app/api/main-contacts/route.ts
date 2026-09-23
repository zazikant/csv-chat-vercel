import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

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

function normalizeOptinStatus(raw: string | undefined | null): string {
  const s = (raw ?? "").trim().toLowerCase().replace(/[-_\s]+/g, " ");
  if (s === "hard bounced" || s === "hardbounced" || s === "hb" || s === "bounced" || s === "hard") return "Hard Bounced";
  if (s === "unsubscribed" || s === "unsub" || s === "opted out" || s === "opt out") return "Unsubscribed";
  return "Subscribed";
}

export async function GET() {
  const { data, error } = await supabase
    .from("main_contacts")
    .select("*")
    .order("email", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  if (!body?.email) return NextResponse.json({ error: "email is required" }, { status: 400 });
  body.email = String(body.email).trim().toLowerCase();
  body.tags = normalizeTags(body.tags);
  body.sector = normalizeTags(body.sector);
  body.source = normalizeTags(body.source);
  if (body.optin_status !== undefined) body.optin_status = normalizeOptinStatus(body.optin_status);
  for (const f of ["created_at", "updated_at"]) delete body[f];
  const { data, error } = await supabase
    .from("main_contacts")
    .upsert(body, { onConflict: "email" })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const { email, ...fields } = body;
  if (!email) return NextResponse.json({ error: "email is required" }, { status: 400 });
  for (const f of ["email", "created_at", "updated_at"]) delete fields[f];
  if ("tags" in fields) fields.tags = normalizeTags(fields.tags);
  if ("sector" in fields) fields.sector = normalizeTags(fields.sector);
  if ("source" in fields) fields.source = normalizeTags(fields.source);
  if (fields.optin_status !== undefined) fields.optin_status = normalizeOptinStatus(fields.optin_status);
  const { data, error } = await supabase
    .from("main_contacts")
    .update(fields)
    .eq("email", String(email).toLowerCase())
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest) {
  const body = await req.json();
  if (Array.isArray(body.emails)) {
    const { error } = await supabase
      .from("main_contacts")
      .delete()
      .in("email", body.emails.map((e: string) => e.toLowerCase()));
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, deleted: body.emails.length });
  }
  const { email } = body;
  if (!email) return NextResponse.json({ error: "email or emails is required" }, { status: 400 });
  const { error } = await supabase
    .from("main_contacts")
    .delete()
    .eq("email", String(email).toLowerCase());
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
