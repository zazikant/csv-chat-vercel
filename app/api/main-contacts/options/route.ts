import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { fetchAll } from "@/lib/fetchAll";

export const runtime = "nodejs";

/**
 * GET /api/main-contacts/options
 *
 * Distinct filter option values for the Main Database Filters panel:
 *   { city: string[], sector: string[], source: string[], tags: string[], assigned_to: string[] }
 *
 * The table view is server-paginated (25 rows/page), so dropdown options can't
 * be derived from the visible page — a tag like "qto" (112 contacts spread
 * across pages) would never show up. This endpoint returns the complete lists
 * (via the get_main_filter_options RPC, one round-trip) so the Filters panel
 * offers every value that exists in the table.
 *
 * Values are trimmed, deduped, and sorted alphabetically.
 */
export async function GET() {
  const { data, error } = await supabase.rpc("get_main_filter_options");

  if (!error && Array.isArray(data)) {
    const out: Record<string, string[]> = {
      city: [],
      sector: [],
      source: [],
      tags: [],
      assigned_to: [],
    };
    for (const row of data as Array<{ kind?: string; value?: string }>) {
      const v = String(row?.value ?? "").trim();
      if (!v) continue;
      const key =
        row?.kind === "city" ? "city" :
        row?.kind === "sector" ? "sector" :
        row?.kind === "source" ? "source" :
        row?.kind === "tag" ? "tags" :
        row?.kind === "assigned_to" ? "assigned_to" : null;
      if (key) out[key].push(v);
    }
    for (const k of Object.keys(out)) out[k] = Array.from(new Set(out[k])).sort();
    return NextResponse.json(out);
  }

  // Fallback if the RPC isn't deployed (older schema): aggregate in JS from
  // just the five filterable columns (much lighter than a full-table fetch).
  try {
    const all = await fetchAll<Record<string, unknown>>(
      "main_contacts",
      [{ column: "email", ascending: true }],
      "city,sector,source,tags,assigned_to",
    );
    const city = new Set<string>();
    const sector = new Set<string>();
    const source = new Set<string>();
    const tags = new Set<string>();
    const assignedTo = new Set<string>();
    const add = (set: Set<string>, val: unknown) => {
      if (typeof val !== "string") return;
      const v = val.trim();
      if (v) set.add(v);
    };
    for (const r of all) {
      add(city, r.city);
      if (Array.isArray(r.sector)) (r.sector as unknown[]).forEach((v) => add(sector, v));
      if (Array.isArray(r.source)) (r.source as unknown[]).forEach((v) => add(source, v));
      if (Array.isArray(r.tags)) (r.tags as unknown[]).forEach((v) => add(tags, v));
      if (Array.isArray(r.assigned_to)) (r.assigned_to as unknown[]).forEach((v) => add(assignedTo, v));
    }
    return NextResponse.json({
      city: Array.from(city).sort(),
      sector: Array.from(sector).sort(),
      source: Array.from(source).sort(),
      tags: Array.from(tags).sort(),
      assigned_to: Array.from(assignedTo).sort(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
