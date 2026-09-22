import { supabase } from "../supabase";
import { ContactRow, Message } from "./state";

/**
 * Human-readable schema description passed to the NVIDIA LLM in every prompt.
 *
 * IMPORTANT: this is the ONLY thing the LLM knows about the database. Keep
 * it complete, explicit, and example-driven. The LLM uses this to:
 *   1. Classify the user's intent (intentClassifierNode)
 *   2. Generate a SELECT query (sqlGeneratorNode)
 *   3. Recover from query errors (errorRecoveryNode)
 *
 * If the LLM hallucinates columns or writes wrong SQL, the fix is usually
 * here — make the description clearer.
 */
export function getTableSchema(): string {
  return `
You are querying an "Email Campaign Tracker" database with TWO tables.
The app does NOT send emails automatically — it tracks them manually.

═══════════════════════════════════════════════════════════════════════
TABLE 1: contacts  (master contact list — MULTIPLE ROWS PER EMAIL ALLOWED)
═══════════════════════════════════════════════════════════════════════
Primary key: id (bigserial, auto-incrementing)
Email is NOT unique — the same email can appear multiple times (one row per mailer).
Unique constraint: (email, mailer_id) — prevents exact duplicates.

User-editable columns (these are what the user types in the form):
  - email              text        REQUIRED. PK. e.g. "rajesh@contractor.com"
  - name               text        Full name. e.g. "Rajesh Kumar"
  - company            text        Company name. e.g. "ABC Contractors"
  - designation        text        Job title. e.g. "Project Manager"
  - phone              text        Phone number. e.g. "+91 9876543210"
  - city               text        e.g. "Mumbai"
  - sector             text        Industry. e.g. "Real Estate", "Infrastructure"
  - optin_status        text        EXACTLY one of: "Subscribed" | "Hard Bounced" | "Unsubscribed"
  - mailer_id          text        FK -> mailers.mailer_id (or NULL if not yet assigned to a mailer)
  - opens              integer     How many times this contact opened the assigned mailer. Manual count. Default 0.
  - clicks             integer    How many times this contact clicked links in the assigned mailer. Manual count. Default 0.
  - tags               text[]      Free-form tags for categorization. Array of lowercase strings. e.g. {"vip", "mumbai", "contractor"}

Auto-maintained columns (NEVER write to these — they are set by a trigger):
  - last_activity_date  timestamptz  Set to now() when opens>0 or clicks>0.
  - engagement_score    text         "HOT" if clicks>0, "WARM" if opens>0, "COLD" otherwise.
  - created_at          timestamptz  Row creation time.
  - updated_at          timestamptz  Last modification time.

═══════════════════════════════════════════════════════════════════════
TABLE 2: mailers  (campaign library — one row per mailer blast)
═══════════════════════════════════════════════════════════════════════
Primary key: mailer_id (text, e.g. "M001", "M002")

User-editable columns:
  - mailer_id          text       REQUIRED. PK. e.g. "M001"
  - subject_line       text       REQUIRED. The email subject line.
  - template_name      text       Which email design was used (optional).
  - sent_date          timestamptz  When the mailer was sent (optional).

Auto-maintained columns (NEVER write — recomputed by trigger on contacts):
  - total_sent          integer   Count of contacts where contacts.mailer_id = this mailer's mailer_id.
  - unique_opens        integer   Count of contacts where mailer_id matches AND opens > 0.
  - total_opens         integer   Sum of opens across all contacts with this mailer_id.
  - unique_clicks       integer   Count of contacts where mailer_id matches AND clicks > 0.
  - total_clicks        integer   Sum of clicks across all contacts with this mailer_id.
  - unsubscribed_count  integer   Count of contacts where mailer_id matches AND optin_status = 'Unsubscribed'.
  - hardbounced_count   integer   Count of contacts where mailer_id matches AND optin_status = 'Hard Bounced'.

Generated columns (NEVER write — derived from the auto-maintained counters):
  - open_rate           numeric(5,2)   = unique_opens / total_sent * 100  (e.g. 50.00 = 50%)
  - click_rate          numeric(5,2)   = unique_clicks / total_sent * 100
  - unsubscribe_rate    numeric(5,2)   = unsubscribed_count / total_sent * 100
  - hardbounce_rate     numeric(5,2)   = hardbounced_count / total_sent * 100

═══════════════════════════════════════════════════════════════════════
RELATIONSHIP: contacts.mailer_id -> mailers.mailer_id
═══════════════════════════════════════════════════════════════════════
- One mailer can have MANY contacts (each contact has at most ONE mailer_id).
- Deleting a mailer sets contacts.mailer_id to NULL on all assigned contacts (ON DELETE SET NULL).
- Every INSERT / UPDATE / DELETE on contacts recomputes the affected mailer's counters automatically.

═══════════════════════════════════════════════════════════════════════
COMMON QUERIES — use these as templates
═══════════════════════════════════════════════════════════════════════
Show all contacts:
  SELECT * FROM contacts ORDER BY email;

Show HOT contacts (clicked something):
  SELECT * FROM contacts WHERE engagement_score = 'HOT' ORDER BY email;

Show WARM contacts (opened but didn't click):
  SELECT * FROM contacts WHERE engagement_score = 'WARM' ORDER BY email;

Show contacts subscribed to mailer M001:
  SELECT * FROM contacts WHERE mailer_id = 'M001' AND optin_status = 'Subscribed';

Show unsubscribed contacts:
  SELECT * FROM contacts WHERE optin_status = 'Unsubscribed';

Show hard bounced contacts:
  SELECT * FROM contacts WHERE optin_status = 'Hard Bounced';

Show contacts tagged "vip":
  SELECT * FROM contacts WHERE 'vip' = ANY(tags);

Show contacts with multiple tags:
  SELECT * FROM contacts WHERE tags @> ARRAY['vip','mumbai'];

Show mailers ranked by open rate (best subject lines):
  SELECT * FROM mailers ORDER BY open_rate DESC;

Show mailers ranked by click rate:
  SELECT * FROM mailers ORDER BY click_rate DESC;

Show mailers with highest hard bounce rate:
  SELECT * FROM mailers ORDER BY hardbounce_rate DESC;

Show contacts in mailer M001 who haven't opened:
  SELECT * FROM contacts WHERE mailer_id = 'M001' AND opens = 0;

Show mailer M001 performance summary:
  SELECT mailer_id, total_sent, unique_opens, total_opens, unique_clicks, total_clicks,
         unsubscribed_count, hardbounced_count, open_rate, click_rate, unsubscribe_rate, hardbounce_rate
  FROM mailers WHERE mailer_id = 'M001';

═══════════════════════════════════════════════════════════════════════
RULES
═══════════════════════════════════════════════════════════════════════
- ALWAYS use SELECT * — never SELECT COUNT or specific columns. The UI displays the rows.
- Use ILIKE for case-insensitive text matches on contacts (e.g. WHERE name ILIKE '%rajesh%').
- For tags (text[]), use: WHERE 'tagname' = ANY(tags) or WHERE tags @> ARRAY['tag1','tag2'].
- End every SQL statement with a semicolon.
- The "best subject line" question = ORDER BY open_rate DESC.
- "Hot leads" = engagement_score = 'HOT'.
- "Bounced contacts" = optin_status = 'Hard Bounced'.
- Never write to total_sent, unique_opens, total_opens, unique_clicks, total_clicks,
  unsubscribed_count, hardbounced_count, open_rate, click_rate, unsubscribe_rate,
  hardbounce_rate, last_activity_date, engagement_score, created_at, updated_at.
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

// NOTE: saveMessage() and loadHistory() were removed.
// Chat history is NOT persisted to Supabase — each chat session is stateless.
// This keeps disk usage to the minimum (only contacts + mailers tables).
// If you need chat history, the conversation state lives only in the
// browser (ChatPanel component's React state).
