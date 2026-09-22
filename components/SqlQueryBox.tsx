"use client";

import { useState } from "react";

interface Props {
  onRun: (rows: Record<string, unknown>[]) => void;
}

/**
 * SQL Query Box — a small input where the user can paste their own SQL
 * SELECT query and run it directly (without going through the AI chat).
 *
 * Behavior:
 * - Empty input: placeholder shows example query
 * - Press Run (or Ctrl+Enter): POST to /api/query
 * - On success: calls onRun(rows) so the parent can update the table view
 * - On error: shows the error inline
 * - Click "Fill example": pre-fills with "SELECT * FROM contacts ORDER BY email;"
 *
 * Security: only SELECT queries are allowed (enforced both client-side
 * and server-side via the run_select_query RPC).
 */
export default function SqlQueryBox({ onRun }: Props) {
  const [sql, setSql] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [rowCount, setRowCount] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);

  async function runQuery() {
    if (!sql.trim() || loading) return;
    setLoading(true);
    setError("");
    setRowCount(null);
    try {
      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Query failed");
      }
      const rows = (data.rows ?? []) as Record<string, unknown>[];
      setRowCount(rows.length);
      onRun(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Query failed");
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      runQuery();
    }
  }

  function fillExample() {
    setSql("SELECT * FROM contacts ORDER BY email;");
    setExpanded(true);
  }

  return (
    <div className="border-b border-gray-200 bg-gradient-to-r from-purple-50 to-blue-50/40">
      <div className="px-4 py-2 flex items-center justify-between">
        <button
          onClick={() => setExpanded((s) => !s)}
          className="flex items-center gap-2 text-xs font-medium text-gray-700 hover:text-gray-900 transition-colors"
          title="Toggle SQL query box"
        >
          <svg className="w-3.5 h-3.5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
          </svg>
          SQL Query
          {rowCount !== null && (
            <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full">
              {rowCount} row{rowCount !== 1 ? "s" : ""}
            </span>
          )}
        </button>
        {!expanded && (
          <button
            onClick={() => setExpanded(true)}
            className="text-xs text-gray-500 hover:text-gray-700"
          >
            Paste &amp; run a SELECT query →
          </button>
        )}
      </div>
      {expanded && (
        <div className="px-4 pb-3 space-y-2">
          <div className="flex gap-2">
            <textarea
              value={sql}
              onChange={(e) => setSql(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={3}
              placeholder="SELECT * FROM contacts WHERE engagement_score = 'HOT' ORDER BY email;"
              className="flex-1 px-3 py-2 text-xs font-mono text-gray-900 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-100 focus:border-purple-300 placeholder-gray-400 bg-white resize-y"
              spellCheck={false}
            />
            <div className="flex flex-col gap-1">
              <button
                onClick={runQuery}
                disabled={!sql.trim() || loading}
                className="px-3 py-1.5 text-xs bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 whitespace-nowrap"
              >
                {loading ? (
                  <>
                    <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Running
                  </>
                ) : (
                  <>
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Run
                  </>
                )}
              </button>
              <button
                onClick={fillExample}
                className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                title="Fill example query"
              >
                Example
              </button>
            </div>
          </div>
          {error && (
            <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600 font-mono">
              {error}
            </div>
          )}
          <p className="text-[11px] text-gray-400">
            Only SELECT queries. Press <kbd className="px-1 py-0.5 bg-gray-100 rounded text-gray-600">Ctrl+Enter</kbd> to run. The result replaces the table below.
          </p>
        </div>
      )}
    </div>
  );
}
