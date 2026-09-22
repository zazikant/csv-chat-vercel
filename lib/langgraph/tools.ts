import { supabase } from "../supabase";
import { ContactRow, Message } from "./state";

export function getTableSchema(): string {
  return `
Tables: contacts, mailers  (no email_journey — app does not send auto-mailers)

Table: contacts  (master contact list - one row per person)
Columns:
  - email              (text, primary key)        -- Contact email. Required.
  - name               (text)                     -- Contact name
  - company            (text)                     -- Company name
  - designation        (text)                     -- Job title
  - phone              (text)                     -- Phone number
  - city               (text)                     -- City
  - sector             (text)                     -- Industry sector
  - optin_status       (text)                     -- Subscribed / Hard Bounced / Unsubscribed (dropdown)
  - mailer_id          (text, FK to mailers)       -- Which mailer this contact received. NULL = not yet assigned.
  - opens              (integer)                   -- How many times this contact opened the assigned mailer (manual).
  - clicks             (integer)                   -- How many times this contact clicked links in the assigned mailer (manual).
  - tags               (text[])                    -- Free-form tags for categorizing the contact. e.g. {vip, mumbai, contractor}
  - last_activity_date (timestamptz, auto)        -- Set when opens>0 or clicks>0 (auto).
  - engagement_score   (text, auto)               -- HOT (clicks>0) / WARM (opens>0) / COLD (auto).

Table: mailers  (campaign library - one row per mailer blast)
Columns:
  - mailer_id          (text, primary key)         -- e.g. M001, M002
  - subject_line       (text, required)            -- The email subject line
  - template_name      (text)                       -- Which email design was used
  - sent_date          (timestamptz)               -- When the blast was sent
  - total_sent         (integer, auto)              -- count of contacts with this mailer_id (auto)
  - unique_opens       (integer, auto)              -- count of contacts with this mailer_id AND opens>0 (auto)
  - total_opens        (integer, auto)              -- sum of opens across contacts with this mailer_id (auto)
  - unique_clicks      (integer, auto)              -- count of contacts with this mailer_id AND clicks>0 (auto)
  - total_clicks       (integer, auto)              -- sum of clicks across contacts with this mailer_id (auto)
  - unsubscribed_count (integer, auto)              -- count of contacts with this mailer_id AND optin_status='Unsubscribed' (auto)
  - hardbounced_count  (integer, auto)              -- count of contacts with this mailer_id AND optin_status='Hard Bounced' (auto)
  - open_rate          (numeric(5,2), generated)   -- unique_opens  / total_sent * 100 (auto-computed)
  - click_rate         (numeric(5,2), generated)   -- unique_clicks / total_sent * 100 (auto-computed)
  - unsubscribe_rate   (numeric(5,2), generated)   -- unsubscribed_count / total_sent * 100 (auto-computed)
  - hardbounce_rate    (numeric(5,2), generated)   -- hardbounced_count  / total_sent * 100 (auto-computed)

Relationships:
  contacts.mailer_id -> mailers.mailer_id (FK, ON DELETE SET NULL)

How the app works:
  - The app does NOT send mailers automatically.
  - User creates a mailer (M001, M002, ...) in the Mailers tab.
  - User assigns contacts to that mailer (sets mailer_id on each contact).
  - User manually records opens/clicks/unsubscribed per contact.
  - The mailers counters (total_sent, unique_opens, open_rate, etc.) are
    AUTO-MAINTAINED by a trigger whenever a contact is inserted/updated/deleted.
  - Never write directly to total_sent, unique_opens, total_opens,
    unique_clicks, total_clicks, unsubscribed_count, open_rate, click_rate,
    or unsubscribe_rate on the mailers table - they are auto-maintained.

Common queries:
  - Best subject lines:     SELECT * FROM mailers ORDER BY open_rate DESC;
  - Hot contacts:           SELECT * FROM contacts WHERE engagement_score = 'HOT' ORDER BY email;
  - Contacts in M001:       SELECT * FROM contacts WHERE mailer_id = 'M001';
  - Recent activity:        SELECT * FROM contacts WHERE last_activity_date IS NOT NULL ORDER BY last_activity_date DESC;
  - Unsubscribed per mailer: SELECT mailer_id, unsubscribed_count, unsubscribe_rate FROM mailers ORDER BY unsubscribe_rate DESC;
`.trim();
}

export async function executeSQL(
  sql: string
): Promise<{ success: boolean; result?: ContactRow[]; error?: string }> {
  try {
    const cleanedSQL = sql.replace(/;$/, "").replace(/\bpublic\./gi, "").replace(/FROM\s+public\./gi, "FROM ").trim();
    const trimmed = cleanedSQL.toLowerCase();
    if (!trimmed.startsWith("select")) {
      return { success: false, error: "Only SELECT queries are allowed." };
    }

    const { data, error } = await supabase.rpc("run_select_query", {
      query_text: cleanedSQL,
    });

    if (error) return { success: false, error: error.message };

    let result = typeof data === "string" ? JSON.parse(data) : data;
    if (result && typeof result === "object" && !Array.isArray(result)) {
      result = Object.values(result)[0];
    }
    return { success: true, result: Array.isArray(result) ? result : [] };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function loadHistory(sessionId: string): Promise<Message[]> {
  const { data } = await supabase
    .from("conversation_history")
    .select("role, content")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true })
    .limit(20);

  return (data as Message[]) ?? [];
}

export async function saveMessage(
  sessionId: string,
  role: "user" | "assistant",
  content: string
): Promise<void> {
  await supabase
    .from("conversation_history")
    .insert({ session_id: sessionId, role, content });
}
