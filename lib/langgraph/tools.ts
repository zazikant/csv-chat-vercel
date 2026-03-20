import { supabase } from "../supabase";
import { ContactRow, Message } from "./state";

export function getTableSchema(): string {
  return `
Table name: contacts
Columns:
  - id            (bigint, primary key, auto)
  - name          (text)
  - email         (text)
  - company_name  (text)
  - phone_number  (text)
  - city          (text)
  - designation   (text)

Sample rows:
  id | name          | email           | company_name | city      | designation
  1  | Alice Johnson | alice@gmail.com | Acme Corp    | Mumbai    | Manager
  2  | Bob Smith     | bob@yahoo.com   | BrightTech   | Delhi     | Engineer
  3  | Carol White   | carol@gmail.com | Acme Corp    | Mumbai    | Director
`.trim();
}

export async function executeSQL(
  sql: string
): Promise<{ success: boolean; result?: ContactRow[]; error?: string }> {
  try {
    const cleanedSQL = sql.replace(/;$/, "").trim();
    const trimmed = cleanedSQL.toLowerCase();
    if (!trimmed.startsWith("select")) {
      return { success: false, error: "Only SELECT queries are allowed." };
    }

    const { data, error } = await supabase.rpc("run_select_query", {
      query_text: cleanedSQL,
    });

    if (error) return { success: false, error: error.message };

    const result = typeof data === "string" ? JSON.parse(data) : data;
    return { success: true, result: result ?? [] };
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
