import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET() {
  const { data, error } = await supabase
    .from("main_contacts")
    .select("source")
    .not("source", "is", null);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    const arr = (row as { source?: unknown }).source;
    if (Array.isArray(arr)) {
      for (const s of arr) {
        if (typeof s === "string") {
          const val = s.trim().toLowerCase();
          if (!val) continue;
          counts.set(val, (counts.get(val) ?? 0) + 1);
        }
      }
    }
  }

  const result = Array.from(counts.entries())
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count || a.source.localeCompare(b.source));

  return NextResponse.json(result);
}
