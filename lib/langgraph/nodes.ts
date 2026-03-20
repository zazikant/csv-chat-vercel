import { ChatOpenAI } from "@langchain/openai";
import { getTableSchema, executeSQL, saveMessage } from "./tools";
import { QueryGraphStateType } from "./state";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

function getLLM(state: QueryGraphStateType): BaseChatModel {
  if (state.llmProvider === "nvidia") {
    return new ChatOpenAI({
      model: state.model || "openai/gpt-oss-120b",
      apiKey: state.apiKey || "",
      configuration: {
        baseURL: "https://integrate.api.nvidia.com/v1",
      } as Record<string, unknown>,
      temperature: 0,
    });
  }
  return new ChatOpenAI({
    model: state.model || "z-ai/glm-4.5-air:free",
    apiKey: state.apiKey || "",
    configuration: {
      baseURL: "https://openrouter.ai/api/v1",
    } as Record<string, unknown>,
    temperature: 0,
  });
}

export async function schemaLoaderNode(
  _state: QueryGraphStateType
): Promise<Partial<QueryGraphStateType>> {
  const schema = getTableSchema();
  console.log("📋 [SchemaLoader] Done.");
  return { tableSchema: schema };
}

export async function intentClassifierNode(
  state: QueryGraphStateType
): Promise<Partial<QueryGraphStateType>> {
  const llm = getLLM(state);
  const historyText = state.conversationHistory
    .slice(-10)
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n") || "None";

  const prompt = `You are analyzing a query over a contacts database table.

Schema:
${state.tableSchema}

Conversation history:
${historyText}

Current user query: "${state.userQuery}"

Classify as exactly ONE of:
- filter      → user wants rows matching a condition
- count       → user wants a number or count
- lookup      → user wants a specific field value for a known person
- aggregate   → user wants group-by / distinct values / statistics
- reset       → user wants to see all contacts again (e.g. "show all", "reset", "clear filter")
- unknown     → query cannot be answered from this data

Return ONLY the single classification word, nothing else.`;

  const response = await llm.invoke(prompt);
  const raw = response.content.toString().trim().toLowerCase().split(/\s+/)[0];
  const valid = ["filter", "count", "lookup", "aggregate", "reset", "unknown"];
  const intent = valid.includes(raw) ? raw : "unknown";

  console.log(`🎯 [IntentClassifier] Intent: ${intent}`);
  return { queryIntent: intent };
}

export async function sqlGeneratorNode(
  state: QueryGraphStateType
): Promise<Partial<QueryGraphStateType>> {
  const llm = getLLM(state);
  const historyText = state.conversationHistory
    .slice(-10)
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n") || "None";

  const prompt = `You are a PostgreSQL expert. Generate a SQL SELECT query to answer the user's question.

Table schema:
${state.tableSchema}

Conversation history (use for follow-up context like "those", "them", "same filter"):
${historyText}

Current query: "${state.userQuery}"
Intent: ${state.queryIntent}

Rules:
1. Return ONLY a valid SQL SELECT statement — no markdown, no backticks, no explanation.
2. Always query from table "contacts".
3. Use ILIKE for case-insensitive text comparisons (e.g. WHERE city ILIKE 'mumbai').
4. For "reset" or "show all" intent: return SELECT * FROM contacts ORDER BY id;
5. For count queries: return SELECT COUNT(*) as count FROM contacts WHERE ...;
6. For aggregate queries: use GROUP BY appropriately.
7. Always end with a semicolon.

Examples:
SELECT * FROM contacts WHERE city ILIKE 'mumbai';
SELECT COUNT(*) as count FROM contacts WHERE email ILIKE '%gmail%';
SELECT * FROM contacts WHERE designation ILIKE 'engineer' ORDER BY name;
SELECT company_name, COUNT(*) as total FROM contacts GROUP BY company_name ORDER BY total DESC;`;

  const response = await llm.invoke(prompt);
  const sql = response.content
    .toString()
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
  const llm = getLLM(state);
  const prompt = `This PostgreSQL query failed. Fix it.

Schema:
${state.tableSchema}

Failed SQL:
${state.generatedSQL}

Error:
${state.queryError}

Original user query: "${state.userQuery}"

Return ONLY the corrected SQL SELECT statement, nothing else. No markdown, no backticks.`;

  const response = await llm.invoke(prompt);
  const fixedSQL = response.content
    .toString()
    .trim()
    .replace(/```sql|```/gi, "")
    .trim();

  console.log(`🔧 [ErrorRecovery] Fixed: ${fixedSQL}`);
  return { generatedSQL: fixedSQL, queryError: null };
}

export async function responseFormatterNode(
  state: QueryGraphStateType
): Promise<Partial<QueryGraphStateType>> {
  const llm = getLLM(state);

  if (state.queryIntent === "unknown") {
    const msg =
      "I can only answer questions about the contacts data — names, emails, companies, phones, cities, and designations. Please rephrase your question.";
    await saveMessage(state.sessionId, "user", state.userQuery);
    await saveMessage(state.sessionId, "assistant", msg);
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
    await saveMessage(state.sessionId, "user", state.userQuery);
    await saveMessage(state.sessionId, "assistant", msg);
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
    state.queryIntent === "filter" ||
    state.queryIntent === "lookup" ||
    state.queryIntent === "reset";

  const resultSummary =
    state.queryResult && state.queryResult.length > 0
      ? `${state.queryResult.length} record(s) returned.`
      : "No matching records found.";

  const prompt = `You are a helpful data assistant for a contacts database.

User question: "${state.userQuery}"
SQL that was run: ${state.generatedSQL}
Result summary: ${resultSummary}
Full result: ${JSON.stringify(state.queryResult?.slice(0, 5), null, 2)}

Write a short, friendly, conversational response (1–3 sentences).
- For filters: mention how many results were found and what filter was applied.
- For counts: state the number clearly.
- For aggregates: summarise the key insight.
- For reset: confirm the full list is showing.
- Do NOT list all the data — the table on screen already shows it.`;

  const response = await llm.invoke(prompt);
  const final = response.content.toString().trim();

  await saveMessage(state.sessionId, "user", state.userQuery);
  await saveMessage(state.sessionId, "assistant", final);

  console.log("💬 [ResponseFormatter] Done.");
  return {
    finalResponse: final,
    shouldUpdateTable: returnsRows,
    conversationHistory: [
      { role: "user", content: state.userQuery },
      { role: "assistant", content: final },
    ],
  };
}
