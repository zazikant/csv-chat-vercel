import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * POST /api/query
 *
 * Body: { sql: string }
 *
 * Executes a user-pasted SQL query via the run_select_query RPC.
 * Only SELECT statements are allowed (the RPC enforces this).
 *
 * Returns:
 *   200: { rows: [...] }
 *   400: { error: "..." } (invalid input or non-SELECT)
 *   500: { error: "..." } (execution error)
 *
 * This route is used by the SQL Query Box component in the UI so the user
 * can paste their own SQL without going through the AI chat panel.
 */
export async function POST(req: NextRequest) {
  try {
    const { sql } = await req.json();

    if (!sql || typeof sql !== "string" || !sql.trim()) {
      return NextResponse.json({ error: "sql is required" }, { status: 400 });
    }

    // Light client-side guard: only allow SELECT (the RPC enforces this too)
    const normalised = sql.trim().toLowerCase();
    if (!normalised.startsWith("select")) {
      return NextResponse.json(
        { error: "Only SELECT queries are allowed." },
        { status: 400 }
      );
    }

    // Strip trailing semicolon (the RPC adds its own)
    const cleanedSQL = sql.trim().replace(/;$/, "");

    const { data, error } = await supabase.rpc("run_select_query", {
      query_text: cleanedSQL,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    let result = typeof data === "string" ? JSON.parse(data) : data;
    if (result && typeof result === "object" && !Array.isArray(result)) {
      result = Object.values(result)[0];
    }
    const rows = Array.isArray(result) ? result : [];

    return NextResponse.json({ rows });
  } catch (err) {
    console.error("/api/query error:", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
