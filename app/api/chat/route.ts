import { NextRequest, NextResponse } from "next/server";
import { graph } from "@/lib/langgraph/graph";
import { loadHistory } from "@/lib/langgraph/tools";

export const runtime = "nodejs";
export const maxDuration = 60;  // Vercel Hobby Node cap — NVIDIA calls run with 55s internal timeout

/**
 * POST /api/chat
 *
 * Body: { userQuery, sessionId, currentRows? }
 *
 * The LLM is always NVIDIA (nvidia/nemotron-3-super-120b-a12b by default).
 * The API key is read from NVIDIA_API_KEY on the server — never accepted
 * from the request body (avoids leaking the key through the browser).
 *
 * See lib/nvidia.ts for the NVIDIA client (ported from
 * github.com/zazikant/tradingview-notes-app-nvidia).
 */
export async function POST(req: NextRequest) {
  try {
    const { userQuery, sessionId, currentRows } = await req.json();

    if (!userQuery?.trim() || !sessionId) {
      return NextResponse.json(
        { error: "userQuery and sessionId are required" },
        { status: 400 }
      );
    }

    const history = await loadHistory(sessionId);

    const result = await graph.invoke({
      userQuery: userQuery.trim(),
      sessionId,
      conversationHistory: history,
      queryIntent:   "",
      generatedSQL:  "",
      queryResult:   [],
      queryError:    null,
      retryCount:    0,
      finalResponse: "",
      shouldUpdateTable: false,
      tableSchema:   "",
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
