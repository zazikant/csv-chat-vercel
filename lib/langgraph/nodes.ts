import { nvidiaChat } from "../nvidia";
import { getTableSchema, executeSQL } from "./tools";
import { QueryGraphStateType } from "./state";

/**
 * All LLM calls go through nvidiaChat() (see lib/nvidia.ts).
 *
 * The NVIDIA client uses raw fetch + SSE parsing (no @langchain/openai SDK
 * needed) and reads NVIDIA_API_KEY from the server environment. The model
 * defaults to nvidia/nemotron-3-super-120b-a12b.
 *
 * Ported from github.com/zazikant/tradingview-notes-app-nvidia.
 */

export async function schemaLoaderNode(
  state: QueryGraphStateType
): Promise<Partial<QueryGraphStateType>> {
  const schema = getTableSchema(state.activeTab);
  console.log("📋 [SchemaLoader] Done.");
  return { tableSchema: schema };
}

export async function intentClassifierNode(
  state: QueryGraphStateType
): Promise<Partial<QueryGraphStateType>> {
  const historyText = state.conversationHistory
    .slice(-10)
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n") || "None";

  const prompt = `You are analyzing a query over an email campaign tracker database.

Schema:
${state.tableSchema}

Current UI state:
- ${state.currentRows.length} rows currently visible in the contacts table
${state.currentRows.length > 0 ? `- Currently showing emails: ${state.currentRows.slice(0, 10).map(r => r.email).join(", ")}${state.currentRows.length > 10 ? "..." : ""}` : "- Table is empty or unfiltered"}

Conversation history:
${historyText}

Current user query: "${state.userQuery}"

Classify as exactly ONE of:
- filter      → user wants contacts matching a condition (e.g. optin_status, engagement_score, sector, city)
- count       → user wants a number or count (e.g. "how many hot", "total contacts")
- lookup      → user wants a specific field value for a known contact or company
- aggregate   → user wants group-by / distinct values / statistics / sums
- sort        → user wants results sorted by a field (opens, clicks, date, etc.)
- mailer      → user wants info about a mailer / campaign / subject line performance
- reset       → user wants to see all contacts again (e.g. "show all", "reset", "clear filter")
- unknown     → query cannot be answered from this data

IMPORTANT: If user asks a question about counts or aggregates while data is filtered, they likely want the count from the CURRENTLY VISIBLE data, not the full database. Return "filter" intent in such cases.

Return ONLY the single classification word, nothing else.`;

  const raw = (await nvidiaChat(prompt, { temperature: 0, maxRetries: 2 })).trim().toLowerCase().split(/\s+/)[0];
  const valid = ["filter", "count", "lookup", "aggregate", "sort", "mailer", "reset", "unknown"];
  const intent = valid.includes(raw) ? raw : "unknown";

  console.log(`🎯 [IntentClassifier] Intent: ${intent}`);
  return { queryIntent: intent };
}

export async function sqlGeneratorNode(
  state: QueryGraphStateType
): Promise<Partial<QueryGraphStateType>> {
  const historyText = state.conversationHistory
    .slice(-10)
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n") || "None";

  const prompt = `Generate a SQL SELECT query to answer: "${state.userQuery}"

Schema:
${state.tableSchema}

Conversation history:
${historyText}

Rules:
1. ALWAYS use "SELECT * FROM <table>" — never SELECT COUNT, never specific columns
2. Add WHERE clauses for filters, ORDER BY for sorting
3. End with semicolon
4. Use ILIKE for case-insensitive text comparisons
5. Valid tables: contacts, mailers, email_journey

Examples:
- Show hot contacts → SELECT * FROM contacts WHERE engagement_score ILIKE 'hot' ORDER BY email;
- Show subscribed → SELECT * FROM contacts WHERE optin_status ILIKE 'subscribed' ORDER BY email;
- Show all → SELECT * FROM contacts ORDER BY email;
- Sort by opens → SELECT * FROM contacts ORDER BY total_opens DESC;
- Best mailers → SELECT * FROM mailers ORDER BY open_rate DESC;
- Recent opens → SELECT * FROM email_journey WHERE event_type = 'OPENED' ORDER BY timestamp DESC;`;

  const sql = (await nvidiaChat(prompt, { temperature: 0, maxRetries: 2 }))
    .trim()
    .replace(/```sql|```/gi, "")
    .trim();

  console.log(`💻 [SQLGenerator] SQL: ${sql}`);
  return { generatedSQL: sql, queryError: null, retryCount: state.retryCount ?? 0 };
}

export async function queryExecutorNode(
  state: QueryGraphStateType
): Promise<Partial<QueryGraphStateType>> {
  const result = await executeSQL(state.generatedSQL);

  if (result.success) {
    console.log(`✅ [QueryExecutor] Returned ${result.result?.length ?? 0} rows.`);
    return { queryResult: result.result ?? [], queryError: null };
  } else {
    const retryCount = (state.retryCount ?? 0) + 1;
    console.log(`❌ [QueryExecutor] Error attempt ${retryCount}: ${result.error}`);
    return { queryResult: [], queryError: result.error, retryCount };
  }
}

export async function errorRecoveryNode(
  state: QueryGraphStateType
): Promise<Partial<QueryGraphStateType>> {
  const prompt = `This PostgreSQL query failed. Fix it.

Schema:
${state.tableSchema}

Failed SQL:
${state.generatedSQL}

Error:
${state.queryError}

Original user query: "${state.userQuery}"

Return ONLY the corrected SQL SELECT statement, nothing else. No markdown, no backticks.`;

  const fixedSQL = (await nvidiaChat(prompt, { temperature: 0, maxRetries: 2 }))
    .trim()
    .replace(/```sql|```/gi, "")
    .trim();

  console.log(`🔧 [ErrorRecovery] Fixed: ${fixedSQL}`);
  return { generatedSQL: fixedSQL, queryError: null };
}

export async function responseFormatterNode(
  state: QueryGraphStateType
): Promise<Partial<QueryGraphStateType>> {
  if (state.queryIntent === "unknown") {
    const msg =
      "I can only answer questions about the email campaign tracker data — contacts, mailers, and email journey events (opens, clicks, bounces). Please rephrase your question.";
    return {
      finalResponse: msg,
      shouldUpdateTable: false,
      conversationHistory: [
        { role: "user", content: state.userQuery },
        { role: "assistant", content: msg },
      ],
    };
  }

  if (state.queryError && (state.retryCount ?? 0) >= 3) {
    const msg =
      "I wasn't able to process that query after multiple attempts. Try rephrasing it or simplifying the request.";
    return {
      finalResponse: msg,
      shouldUpdateTable: false,
      conversationHistory: [
        { role: "user", content: state.userQuery },
        { role: "assistant", content: msg },
      ],
    };
  }

  const returnsRows =
    (state.queryIntent === "filter" ||
    state.queryIntent === "lookup" ||
    state.queryIntent === "sort" ||
    state.queryIntent === "reset" ||
    state.queryIntent === "mailer" ||
    state.queryIntent === "count" ||
    state.queryIntent === "aggregate") &&
    Array.isArray(state.queryResult) &&
    state.queryResult.length > 0;

  const shouldUpdateTable = returnsRows;

  const resultSummary =
    state.queryResult && state.queryResult.length > 0
      ? `${state.queryResult.length} record(s) returned.`
      : "No matching records found.";

  const prompt = `You are a helpful data assistant for an email campaign tracker database.

User question: "${state.userQuery}"
SQL that was run: ${state.generatedSQL}
Result summary: ${resultSummary}
Full result: ${JSON.stringify(state.queryResult?.slice(0, 5), null, 2)}

Current UI state:
- ${state.currentRows.length} rows currently visible in the contacts table
${state.currentRows.length > 0 ? `- Currently showing emails: ${state.currentRows.slice(0, 10).map(r => r.email).join(", ")}${state.currentRows.length > 10 ? "..." : ""}` : "- Table is empty or unfiltered"}

Write a short, friendly, conversational response (1–3 sentences).
- For filters: mention how many results were found and what filter was applied.
- For counts: state the number clearly and whether it's from visible data or full database.
- For aggregates: summarise the key insight.
- For reset: confirm the full list is showing.
- Do NOT list all the data — the table on screen already shows it.`;

  const final = (await nvidiaChat(prompt, { temperature: 0.3, maxRetries: 2 })).trim();

  console.log("💬 [ResponseFormatter] Done. shouldUpdateTable:", returnsRows);
  return {
    finalResponse: final,
    shouldUpdateTable: returnsRows,
    conversationHistory: [
      { role: "user", content: state.userQuery },
      { role: "assistant", content: final },
    ],
  };
}
