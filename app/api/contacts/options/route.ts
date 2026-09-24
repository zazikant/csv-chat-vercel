import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { fetchAll } from "@/lib/fetchAll";

export const runtime = "nodejs";

/**
 * GET /api/contacts/options
 *
 * Complete filter option lists for the Contacts tab Filters panel:
 *   { mailers: string[] }  — distinct mailer_id values actually in use
 *
 * The Contacts table view is server-paginated (25 rows/page), so dropdown
 * options can't be derived from the visible page. Backed by the
 * get_contacts_filter_options RPC (one round-trip); falls back to a
 * single-column fetchAll aggregation if the RPC isn't deployed.
 */
export async function GET() {
  const { data, error } = await supabase.rpc("get_contacts_filter_options");

  if (!error && Array.isArray(data)) {
    const mailers = (data as Array<{ mailer_id?: string }>)
      .map((r) => String(r?.mailer_id ?? "").trim())
      .filter(Boolean);
    return NextResponse.json({ mailers: Array.from(new Set(mailers)).sort() });
  }

  try {
    const all = await fetchAll<Record<string, unknown>>(
      "contacts",
      [{ column: "mailer_id", ascending: true }],
      "mailer_id",
    );
    const set = new Set<string>();
    for (const r of all) {
      if (typeof r.mailer_id === "string" && r.mailer_id.trim()) set.add(r.mailer_id.trim());
    }
    return NextResponse.json({ mailers: Array.from(set).sort() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
