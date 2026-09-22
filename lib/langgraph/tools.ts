import { supabase } from "../supabase";
import { ContactRow, Message } from "./state";

export function getTableSchema(): string {
  return `
Tables: contacts, mailers, email_journey

Table: contacts  (master contact list - one row per person)
Columns:
  - email              (text, primary key)        -- Contact email address. Required.
  - name               (text)                     -- Contact person name
  - company            (text)                     -- Company name
  - designation        (text)                     -- Job title
  - phone              (text)                     -- Phone number
  - city               (text)                     -- City
  - sector             (text)                     -- Industry sector
  - customer_type      (text)                     -- Existing / New
  - optin_status       (text)                     -- Subscribed / Unsubscribed / Bounced / Unknown
  - total_sent         (integer, auto)            -- Cumulative SENT events for this email (auto-maintained by trigger)
  - total_opens        (integer, auto)            -- Cumulative OPENED events (auto-maintained)
  - total_clicks       (integer, auto)            -- Cumulative CLICKED events (auto-maintained)
  - last_activity_date (timestamptz, auto)        -- Last OPENED/CLICKED timestamp (auto-maintained)
  - engagement_score   (text, auto)               -- HOT (clicked) / WARM (opened) / COLD (no opens) (auto-maintained)

Table: mailers  (campaign library - one row per mailer blast)
Columns:
  - mailer_id     (text, primary key)             -- e.g. M001, M002
  - subject_line  (text, required)                 -- The email subject line (main field)
  - template_name (text)                           -- Which email design was used
  - sent_date     (timestamptz)                    -- When the blast was sent
  - total_sent    (integer, auto)                  -- Cumulative SENT events (auto-maintained)
  - delivered     (integer, auto)                  -- Cumulative DELIVERED events (auto-maintained)
  - unique_opens  (integer, auto)                  -- Distinct emails that OPENED (auto-maintained)
  - total_opens   (integer, auto)                  -- Total OPENED events (auto-maintained)
  - unique_clicks (integer, auto)                  -- Distinct emails that CLICKED (auto-maintained)
  - total_clicks  (integer, auto)                  -- Total CLICKED events (auto-maintained)
  - bounced       (integer, auto)                  -- Cumulative BOUNCED (auto-maintained)
  - unsubscribed  (integer, auto)                  -- Cumulative UNSUBSCRIBED (auto-maintained)
  - open_rate     (numeric(5,2), generated)       -- unique_opens  / delivered * 100 (auto-computed)
  - click_rate    (numeric(5,2), generated)       -- unique_clicks / delivered * 100 (auto-computed)

Table: email_journey  (event log - one row per email event)
Columns:
  - id           (bigserial, primary key)
  - email        (text, FK to contacts.email)
  - mailer_id    (text, FK to mailers.mailer_id)
  - subject_line (text)                            -- Denormalized for fast search
  - event_type   (text, enum)                      -- SENT / DELIVERED / OPENED / CLICKED / BOUNCED / UNSUBSCRIBED
  - timestamp    (timestamptz, default now())
  - link_clicked (text)                            -- Which link was clicked (if event_type=CLICKED)
  - device_info  (text)                            -- Mobile/Desktop, location

Relationships:
  contacts (1) -> (Many) email_journey
  mailers  (1) -> (Many) email_journey

Notes for SQL generation:
  - All cumulative counters on contacts and mailers are auto-maintained by a trigger
    after every INSERT into email_journey. Never INSERT/UPDATE total_sent/total_opens/
    total_clicks/last_activity_date/engagement_score/unique_opens/etc directly - they
    will be overwritten on the next journey insert.
  - open_rate and click_rate on mailers are GENERATED ALWAYS columns - never write to them.
  - The "best subject line" query is: SELECT * FROM mailers ORDER BY open_rate DESC.
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
