import { supabase } from "./supabase";

/**
 * Supabase hard-caps every SELECT to 1000 rows, regardless of `.limit()` or
 * `.range()`. To return more than 1000 rows to the client we have to paginate
 * with `.range(from, to)` until a page comes back short.
 *
 * Usage:
 *   const rows = await fetchAll("main_contacts", [
 *     { column: "created_date", ascending: false, nullsFirst: false },
 *     { column: "created_at",   ascending: false, nullsFirst: false },
 *     { column: "email",        ascending: true },
 *   ]);
 *
 * Returned rows preserve the requested order across all pages.
 */

export interface OrderSpec {
  column: string;
  ascending?: boolean;     // default true
  nullsFirst?: boolean;    // default false
}

const PAGE_SIZE = 1000; // matches Supabase's hard cap

export async function fetchAll<T = Record<string, unknown>>(
  table: string,
  order: OrderSpec[] = [{ column: "id", ascending: true }],
  select: string = "*"
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  // Hard upper bound of 200,000 rows to prevent runaway loops on pathological
  // data. Adjust if you ever legitimately need more.
  while (from < 200_000) {
    let query = supabase.from(table).select(select);
    for (const o of order) {
      query = query.order(o.column, {
        ascending: o.ascending ?? true,
        nullsFirst: o.nullsFirst ?? false,
      });
    }
    const { data, error } = await query.range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as T[]));
    if (data.length < PAGE_SIZE) break; // last page
    from += PAGE_SIZE;
  }
  return all;
}
