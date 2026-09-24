import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET() {
  const { data, error } = await supabase
    .from("main_contacts")
    .select("assigned_to")
    .not("assigned_to", "is", null);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    const arr = (row as { assigned_to?: unknown }).assigned_to;
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
    .map(([assigned_to, count]) => ({ assigned_to, count }))
    .sort((a, b) => b.count - a.count || a.assigned_to.localeCompare(b.assigned_to));

  return NextResponse.json(result);
}
