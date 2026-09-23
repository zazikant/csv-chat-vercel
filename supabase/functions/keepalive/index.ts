// =============================================================================
//  Supabase Edge Function: keepalive
//  =============================================================================
//
//  Deploy:
//    supabase functions deploy keepalive --project-ref <your-project-ref>
//
//  Set secrets:
//    supabase secrets set SUPABASE_URL=https://<your-project-ref>.supabase.co
//    supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
//
//  Schedule (run in Supabase SQL Editor after enabling pg_cron):
//    SELECT cron.schedule('keepalive', '*/5 * * * *',
//      $$SELECT net.http_get('https://<your-project-ref>.supabase.co/functions/v1/keepalive')$$);
//
//  Or schedule via Supabase Dashboard → Edge Functions → keepalive → Schedule
// =============================================================================

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

Deno.serve(async (_req: Request) => {
  const start = Date.now();

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return new Response(
      JSON.stringify({ ok: false, error: "Missing secrets" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    // 1. Ping the database
    const pingRes = await fetch(
      `${SUPABASE_URL}/rest/v1/main_contacts?select=email&limit=1`,
      {
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
        },
      }
    );

    if (!pingRes.ok) {
      return new Response(
        JSON.stringify({ ok: false, error: `Ping failed: ${pingRes.status}`, elapsedMs: Date.now() - start }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // 2. Run cleanup RPC (non-fatal)
    let cleanupResult = null;
    try {
      const cleanupRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/cleanup_old_data`, {
        method: "POST",
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          "Content-Type": "application/json",
        },
        body: "{}",
      });
      if (cleanupRes.ok) {
        cleanupResult = await cleanupRes.json();
      }
    } catch {
      // RPC might not exist — that's OK
    }

    return new Response(
      JSON.stringify({
        ok: true,
        timestamp: new Date().toISOString(),
        elapsedMs: Date.now() - start,
        cleanup: cleanupResult,
      }),
      { headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ ok: false, error: message, elapsedMs: Date.now() - start }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
