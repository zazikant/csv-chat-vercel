import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

/**
 * GET /api/tags
 *
 * Returns the distinct tags used across all contacts, with usage counts.
 * Used by the TagsInput component (smart suggestion bulb icon).
 *
 * Response shape:
 *   [{ tag: "vip", count: 12 }, { tag: "mumbai", count: 8 }, ...]
 *
 * Sorted by count desc (most-used first), then tag asc.
 *
 * Implementation note: Postgres `unnest()` expands the text[] tags column
 * into one row per tag occurrence, then we group + count.
 */
export async function GET() {
  const { data, error } = await supabase.rpc("get_tag_counts");

  if (error) {
    // Fallback if the RPC isn't defined: fetch all tags arrays and aggregate in JS.
    // (Slower but works without the RPC.)
    const { data: contacts, error: selErr } = await supabase
      .from("contacts")
      .select("tags")
      .not("tags", "is", null);

    if (selErr) {
      return NextResponse.json({ error: selErr.message }, { status: 500 });
    }

    const counts = new Map<string, number>();
    for (const row of contacts ?? []) {
      const tags: unknown = (row as { tags?: unknown }).tags;
      if (Array.isArray(tags)) {
        for (const t of tags) {
          if (typeof t === "string") {
            const tag = t.trim().toLowerCase();
            if (!tag) continue;
            counts.set(tag, (counts.get(tag) ?? 0) + 1);
          }
        }
      }
    }

    const result = Array.from(counts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));

    return NextResponse.json(result);
  }

  // RPC succeeded
  const result = (data ?? []) as Array<{ tag: string; count: number }>;
  return NextResponse.json(result);
}
