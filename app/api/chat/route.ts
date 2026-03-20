import { NextRequest, NextResponse } from "next/server";
import { graph } from "@/lib/langgraph/graph";
import { loadHistory } from "@/lib/langgraph/tools";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const { userQuery, sessionId, llmProvider, apiKey, model } = await req.json();

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
      llmProvider: llmProvider || "openrouter",
      apiKey: apiKey || "",
      model: model || "",
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
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
