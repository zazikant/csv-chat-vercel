import { supabase } from "../supabase";
import { ContactRow, Message } from "./state";

export function getTableSchema(): string {
  return `
Table name: contacts
Columns:
  - id                    (bigint, primary key, auto)
  - name                  (text)           -- Contact person name
  - email                 (text)           -- Contact email address
  - company_name          (text)           -- Client company name
  - phone_number          (text)           -- Contact phone number
  - city                  (text)           -- City location of the project/company
  - designation           (text)           -- Contact person's job title
  - enquiry_received_date (date)           -- Date the enquiry was received
  - go_no_go_decision     (text)           -- Go/No-Go decision: Approved / Not Approved / Pending
  - proposal_sent_date    (date)           -- Date the proposal was sent to client
  - mode_of_submission    (text)           -- How proposal was submitted: Email / Hard Copy / Ariba Portal / etc.
  - proposal_enquiry_for  (text)           -- Service/scope being offered by GEM Engserv
  - project_name          (text)          -- Name/title of the project
  - proposal_value_inr    (numeric)        -- Proposal value in Indian Rupees (₹)
  - quotation_method      (text)           -- Pricing model: Lump Sum / Man-Months / Per Day Fee / Percentage / etc.
  - department            (text)           -- Department: PMC / QC / Rebar / Design Engineering / EAS / TA / etc.
  - status                (text)           -- Proposal status: Won / Loss / Open / Closed
  - inbound_outbound      (text)           -- Lead source: Inbound (enquiry received) / Outbound (proactive outreach)
  - existing_new_customer (text)           -- Customer type: Existing / New
  - remarks               (text)           -- Additional notes/comments
  - type_of_customer      (text)           -- Customer category: Consultant / Contractor / Developer / Manufacturer / etc.
  - sector                (text)           -- Industry sector: FMCG / Industrial / Real Estate / Warehousing / etc.
  - proposal_number       (text)           -- GEM proposal/reference number (e.g., GEM/001/2025-26/R0)
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
