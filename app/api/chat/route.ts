import { NextRequest, NextResponse } from "next/server";
import { graph } from "@/lib/langgraph/graph";
import { getTableSchema } from "@/lib/langgraph/tools";

export const runtime = "nodejs";
export const maxDuration = 60;  // Vercel Hobby Node cap — NVIDIA calls run with 55s internal timeout

/**
 * POST /api/chat
 *
 * Body: { userQuery, sessionId, currentRows? }
 *
 * Stateless — chat history is NOT persisted to Supabase. The sessionId is
 * only used by the LangGraph state machine internally; no rows are written
 * to a conversation_history table. (Keeps Supabase disk usage minimal.)
 *
 * The LLM is always NVIDIA (nvidia/nemotron-3-super-120b-a12b by default).
 * The API key is read from NVIDIA_API_KEY on the server — never accepted
 * from the request body (avoids leaking the key through the browser).
 */
export async function POST(req: NextRequest) {
  try {
    const { userQuery, sessionId, currentRows, activeTab } = await req.json();

    if (!userQuery?.trim() || !sessionId) {
      return NextResponse.json(
        { error: "userQuery and sessionId are required" },
        { status: 400 }
      );
    }

    const result = await graph.invoke({
      userQuery: userQuery.trim(),
      sessionId,
      conversationHistory: [],
      queryIntent:   "",
      generatedSQL:  "",
      queryResult:   [],
      queryError:    null,
      retryCount:    0,
      finalResponse: "",
      shouldUpdateTable: false,
      tableSchema:   "",
      activeTab: activeTab || "main",
      currentRows: currentRows || [],
    });

    return NextResponse.json({
      response:          result.finalResponse,
      queryResult:       result.queryResult,
      shouldUpdateTable: result.shouldUpdateTable,
      generatedSQL:      result.generatedSQL,
      sessionId,
    });

  } catch (err) {
    console.error("Chat API error:", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
