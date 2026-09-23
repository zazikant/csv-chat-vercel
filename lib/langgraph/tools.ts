import { supabase } from "../supabase";
import { ContactRow, Message } from "./state";

export function getTableSchema(activeTab?: string): string {
  const tab = activeTab || "main";

  if (tab === "main") {
    return `
You are querying the "Main Database" tab — the master contact list (identity data).
Focus your answers on the main_contacts table.

IMPORTANT: This table has identity data (name, company, tags, sector, source, remarks, optin_status).
It does NOT have mailer_id, opens, clicks, or engagement_score. Those are in the contacts table.
If the user asks about opens/clicks/mailers/engagement, tell them to switch to the Contacts tab.

TABLE: main_contacts (1 row per email — identity data)
Primary key: email (text, lowercase)

Columns:
  - email         text        PK. e.g. "rajesh@contractor.com"
  - name          text        Full name. e.g. "Rajesh Kumar"
  - company       text        Company name. e.g. "ABC Contractors"
  - designation   text        Job title. e.g. "Project Manager"
  - phone         text        Phone number
  - city          text        City
  - sector        text[]       Industry sectors (tag-style). e.g. {real estate, infrastructure}
  - tags          text[]       Free-form tags. e.g. {vip, mumbai}
  - source        text[]       Lead source (tag-style). e.g. {linkedin, referral}
  - optin_status   text        "Subscribed" | "Hard Bounced" | "Unsubscribed"
  - remarks       text        Free-text notes

Common queries:
  Show all: SELECT * FROM main_contacts ORDER BY email;
  By city: SELECT * FROM main_contacts WHERE city ILIKE '%mumbai%';
  By tag (exact): SELECT * FROM main_contacts WHERE 'vip' = ANY(tags);
  By tag (partial match): SELECT * FROM main_contacts WHERE EXISTS (SELECT 1 FROM unnest(tags) AS t WHERE t ILIKE '%structural%');
  By sector (exact): SELECT * FROM main_contacts WHERE 'real estate' = ANY(sector);
  By sector (partial match): SELECT * FROM main_contacts WHERE EXISTS (SELECT 1 FROM unnest(sector) AS s WHERE s ILIKE '%real%');
  By source: SELECT * FROM main_contacts WHERE EXISTS (SELECT 1 FROM unnest(source) AS s WHERE s ILIKE '%link%');
  Unsubscribed: SELECT * FROM main_contacts WHERE optin_status = 'Unsubscribed';
  Hard bounced: SELECT * FROM main_contacts WHERE optin_status = 'Hard Bounced';
  By email: SELECT * FROM main_contacts WHERE email ILIKE '%rajmohan%';

RULES: ALWAYS use SELECT *. Use ILIKE for text matches. For tags/sector/source, use EXISTS + unnest + ILIKE for partial matches (e.g. searching 'structural' should match 'structural audit gujarat'). End with semicolon.
`.trim();
  }

  if (tab === "contacts") {
    return `
You are querying the "Contacts" tab — engagement data (opens/clicks per mailer).
Focus your answers on the contacts table.

IMPORTANT: This table does NOT have name, company, tags, sector, source, or remarks columns.
Those fields live in the main_contacts table. If the user asks about tags, sector, source,
name, or company, tell them to switch to the Main Database tab.

TABLE: contacts (multiple rows per email — one per mailer)
Primary key: id (bigserial). Unique: (email, mailer_id)

Columns:
  - id              bigint      PK (auto)
  - email           text        FK to main_contacts.email
  - mailer_id       text        FK to mailers.mailer_id (nullable)
  - opens           integer     How many times opened (manual)
  - clicks          integer     How many times clicked (manual)
  - optin_status    text        "Subscribed" | "Hard Bounced" | "Unsubscribed"
  - engagement_score text       "HOT" (clicks>0) / "WARM" (opens>0) / "COLD" (auto)

Common queries:
  Show all: SELECT * FROM contacts ORDER BY id DESC;
  HOT contacts: SELECT * FROM contacts WHERE engagement_score = 'HOT';
  In M001: SELECT * FROM contacts WHERE mailer_id = 'M001';
  Unsubscribed: SELECT * FROM contacts WHERE optin_status = 'Unsubscribed';
  By email: SELECT * FROM contacts WHERE email ILIKE '%rajmohan%';

RULES: ALWAYS use SELECT *. End with semicolon. If the user asks about tags/sector/source/name/company, say "That data is in the Main Database tab. Please switch to that tab to search by tags/sector/name."
`.trim();
  }

  // mailers tab
  return `
You are querying the "Mailers" tab — campaign library with auto-maintained counters.
Focus your answers on the mailers table.

TABLE: mailers (1 row per mailer)
Primary key: mailer_id (text)

Columns:
  - mailer_id          text        PK. e.g. "M001"
  - subject_line       text        The email subject line
  - template_name      text
  - sent_date          timestamptz
  - total_sent         integer     Auto: count of contacts with this mailer_id
  - unique_opens       integer     Auto: count where opens > 0
  - total_opens        integer     Auto: sum of opens
  - unique_clicks      integer     Auto: count where clicks > 0
  - total_clicks       integer     Auto: sum of clicks
  - unsubscribed_count integer     Auto: optin_status = 'Unsubscribed'
  - hardbounced_count  integer     Auto: optin_status = 'Hard Bounced'
  - open_rate          numeric     GENERATED: unique_opens / total_sent * 100
  - click_rate         numeric     GENERATED: unique_clicks / total_sent * 100

Common queries:
  Show all: SELECT * FROM mailers ORDER BY mailer_id;
  Best open rate: SELECT * FROM mailers ORDER BY open_rate DESC;
  Best click rate: SELECT * FROM mailers ORDER BY click_rate DESC;
  Highest bounce: SELECT * FROM mailers ORDER BY hardbounce_rate DESC;

RULES: ALWAYS use SELECT *. End with semicolon. "Best subject line" = ORDER BY open_rate DESC.
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
    const { data, error } = await supabase.rpc("run_select_query", { query_text: cleanedSQL });
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

// NOTE: saveMessage() and loadHistory() were removed. Chat is stateless.
