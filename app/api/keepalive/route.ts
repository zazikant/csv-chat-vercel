import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

/**
 * GET /api/keepalive
 *
 * Pings the Supabase database to prevent it from pausing on the free tier.
 * Called automatically by Vercel Cron every 5 minutes (see vercel.json).
 *
 * Also runs the cleanup_old_data() RPC to keep the database healthy.
 */
export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET() {
  const start = Date.now();

  try {
    // 1. Simple query to keep the database warm
    const { error: pingError } = await supabase
      .from("main_contacts")
      .select("email")
      .limit(1);

    if (pingError) {
      return NextResponse.json(
        { ok: false, error: pingError.message, elapsedMs: Date.now() - start },
        { status: 500 }
      );
    }

    // 2. Run cleanup (drops stale tables, updates stats)
    // Non-fatal if it fails — the ping is the important part
    let cleanupResult = null;
    try {
      const { data, error: cleanupError } = await supabase.rpc("cleanup_old_data");
      if (!cleanupError) {
        cleanupResult = data;
      }
    } catch {
      // cleanup_old_data RPC might not exist — that's OK
    }

    return NextResponse.json({
      ok: true,
      timestamp: new Date().toISOString(),
      elapsedMs: Date.now() - start,
      cleanup: cleanupResult,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "unknown", elapsedMs: Date.now() - start },
      { status: 500 }
    );
  }
}
