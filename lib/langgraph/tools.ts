import { supabase } from "../supabase";
import { ContactRow, Message } from "./state";

export function getTableSchema(): string {
  return `
Table name: contacts
Columns:
  - id                    (bigint, primary key, auto)
  - name                  (text)
  - email                 (text)
  - company_name          (text)
  - phone_number          (text)
  - city                  (text)
  - designation           (text)
  - enquiry_received_date (date)
  - go_no_go_decision     (text)         -- Approved / Not Approved / Pending
  - proposal_sent_date    (date)
  - mode_of_submission    (text)         -- Email, Hard Copy, Ariba Portal, etc.
  - proposal_enquiry_for  (text)         -- Service/scope offered by GEM Engserv
  - project_name          (text)
  - proposal_value_inr    (bigint)
  - quotation_method      (text)         -- Lump Sum, Man-Months, Per Day Fee, etc.
  - department            (text)         -- PMC, QC, Rebar, Design Engineering, etc.
  - status                (text)         -- Won, Loss, Open, Closed
  - inbound_outbound      (text)         -- Inbound (received) / Outbound (proactive)
  - existing_new_customer (text)         -- Existing / New
  - remarks               (text)
  - type_of_customer      (text)         -- Consultant, Contractor, Developer, Manufacturer
  - sector                (text)         -- FMCG, Industrial, Real Estate, Warehousing, etc.
  - proposal_number       (text)
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
