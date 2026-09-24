import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

/**
 * GET /api/main-contacts/mail-counts
 *
 * Returns `Record<lowercase_email, count>` of engagement rows per main contact.
 * Powers the "Total Mails Sent" column on the Main Database tab.
 *
 * Single SQL aggregation — replaces the previous client-side loop over all
 * 266 `contacts` rows that ran on every page load.
 */
export const runtime = "nodejs";

export async function GET() {
  try {
    const { data, error } = await supabase
      .from("contacts")
      .select("email, mailer_id")
      .not("mailer_id", "is", null);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const counts: Record<string, number> = {};
    for (const row of data ?? []) {
      const r = row as { email: string | null; mailer_id: string | null };
      if (!r.email || !r.mailer_id) continue;
      const key = r.email.toLowerCase();
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return NextResponse.json(counts);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
