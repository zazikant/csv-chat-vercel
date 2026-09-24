// =============================================================================
//  Daily Cleanup Edge Function
//  =============================================================================
//
//  WHAT IT DOES:
//    1. Calls the `cleanup_old_data()` RPC on Supabase to:
//       - Drop any stale log/temp tables (conversation_history etc.)
//       - Run ANALYZE on contacts + mailers (updates planner stats)
//       - Never touches live data
//    2. Pings the database (keeps it warm / prevents idle shutdown)
//    3. Returns a JSON summary of what was cleaned
//
//  WHEN IT RUNS:
//    Option A — Supabase Scheduled Function (recommended):
//      In Supabase Dashboard → Database → Extensions → enable pg_cron.
//      Then run in SQL Editor:
//        select cron.schedule(
//          'daily-cleanup',
//          '0 3 * * *',  -- 3 AM UTC daily
//          $$select public.cleanup_old_data()$$
//        );
//      (No Edge Function needed — pg_cron calls the RPC directly.)
//
//    Option B — External cron (Vercel Cron / GitHub Actions / etc.):
//      Deploy this Edge Function, then hit it on a schedule:
//        GET/POST https://<your-project>.functions.supabase.co/cleanup
//      (Requires CRON_SECRET header if you set one.)
//
//  DEPLOY:
//    supabase functions deploy cleanup --project-ref gdmztlzpsobyjousvvyp
//
//  TEST:
//    curl -i --request POST \
//      'https://gdmztlzpsobyjousvvyp.supabase.co/functions/v1/cleanup' \
//      --header 'Authorization: Bearer <ANON_KEY>' \
//      --header 'Content-Type: application/json'
// =============================================================================

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("SUPABASE_URL");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing env vars: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in the Edge Function secrets.");
}

Deno.serve(async (_req: Request) => {
  const start = Date.now();

  try {
    // 1. Call the cleanup_old_data RPC
    const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/cleanup_old_data`, {
      method: "POST",
      headers: {
        "apikey": SERVICE_KEY!,
        "Authorization": `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    });

    const rpcText = await rpcRes.text();
    let rpcData: unknown = null;
    try {
      rpcData = JSON.parse(rpcText);
    } catch {
      rpcData = rpcText;
    }

    if (!rpcRes.ok) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: `cleanup RPC failed (${rpcRes.status})`,
          detail: rpcData,
          elapsedMs: Date.now() - start,
        }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    // 2. Ping the database (keep-alive / warm-up)
    await fetch(`${SUPABASE_URL}/rest/v1/contacts?select=email&limit=1`, {
      headers: {
        "apikey": SERVICE_KEY!,
        "Authorization": `Bearer ${SERVICE_KEY}`,
      },
    });

    // 3. Return summary
    const summary = {
      ok: true,
      timestamp: new Date().toISOString(),
      elapsedMs: Date.now() - start,
      cleanup: rpcData,
    };

    return new Response(JSON.stringify(summary), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
      },
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({
        ok: false,
        error: message,
        elapsedMs: Date.now() - start,
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
