import { supabase } from "./supabase";

export type OptinStatus = "Hard Bounced" | "Unsubscribed" | "Subscribed";

/**
 * Recompute `main_contacts.optin_status` for the given emails from the
 * engagement rows in the `contacts` table, using a "worst status wins"
 * aggregate so the master record always reflects the most serious known
 * delivery problem for that email address:
 *
 *   1. "Hard Bounced"   — if ANY contacts row is Hard Bounced
 *   2. "Unsubscribed"   — else if ANY contacts row is Unsubscribed
 *   3. "Subscribed"     — else (the email has at least one contacts row)
 *
 * Emails that have NO rows in `contacts` are left untouched (the user may
 * have set main_contacts.optin_status manually for a main-only record).
 *
 * Non-fatal by design: every caller treats a sync failure as advisory — the
 * primary save (contact row) has already succeeded when this runs.
 *
 * NOTE: the database also has a trigger (trg_contacts_sync_main_optin) that
 * performs the same recomputation inside Postgres. This helper is the
 * application-level belt-and-braces path: it keeps behaviour correct even on
 * deployments where the SQL migration has not been applied yet.
 */
export async function syncMainOptinStatusForEmails(emails: unknown[]): Promise<void> {
  const unique = Array.from(
    new Set(
      (emails ?? [])
        .map((e) => String(e ?? "").trim().toLowerCase())
        .filter(Boolean),
    ),
  );
  if (unique.length === 0) return;

  // 1. Pull every contacts row for these emails and aggregate per email.
  const BATCH = 500;
  interface Agg { hb: boolean; unsub: boolean; any: boolean }
  const aggByEmail = new Map<string, Agg>();

  for (let i = 0; i < unique.length; i += BATCH) {
    const batch = unique.slice(i, i + BATCH);
    const { data, error } = await supabase
      .from("contacts")
      .select("email,optin_status")
      .in("email", batch);
    if (error) {
      console.error("syncMainOptinStatusForEmails: select failed:", error.message);
      return;
    }
    for (const row of data ?? []) {
      const email = String(row.email ?? "").toLowerCase();
      if (!email) continue;
      const agg = aggByEmail.get(email) ?? { hb: false, unsub: false, any: false };
      if (row.optin_status === "Hard Bounced") agg.hb = true;
      else if (row.optin_status === "Unsubscribed") agg.unsub = true;
      agg.any = true;
      aggByEmail.set(email, agg);
    }
  }
  if (aggByEmail.size === 0) return;

  // 2. Derive the worst status per email.
  const updates: Array<{ email: string; optin_status: OptinStatus }> = [];
  for (const [email, agg] of aggByEmail) {
    const status: OptinStatus = agg.hb ? "Hard Bounced" : agg.unsub ? "Unsubscribed" : "Subscribed";
    updates.push({ email, optin_status: status });
  }

  // 3. Push to main_contacts. Every email here has at least one contacts row
  // and contacts.email is an FK to main_contacts.email, so the master row
  // must already exist — upsert (onConflict: email) only updates provided
  // columns and can never create a stray row in practice.
  const { error: upsertError } = await supabase
    .from("main_contacts")
    .upsert(updates, { onConflict: "email" });
  if (upsertError) {
    console.error("syncMainOptinStatusForEmails: upsert failed:", upsertError.message);
  }
}
