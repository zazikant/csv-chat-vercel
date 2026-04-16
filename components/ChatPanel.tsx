"use client";

import { useState, useRef, useEffect } from "react";
import { ContactRow } from "@/lib/langgraph/state";
import SettingsPanel from "./SettingsPanel";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  sql?: string;
}

interface Settings {
  provider: "openrouter" | "nvidia";
  apiKey: string;
  model: string;
}

interface Props {
  sessionId: string;
  currentRows: ContactRow[];
  onTableUpdate: (rows: ContactRow[]) => void;
}

export default function ChatPanel({ sessionId, currentRows, onTableUpdate }: Props) {
  const [messages, setMessages]   = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        "Hi! Ask me anything about your proposals and enquiries. Try: \"Show all open proposals\" or \"Total value by department\"",
    },
  ]);
  const [input, setInput]         = useState("");
  const [loading, setLoading]     = useState(false);
  const [settings, setSettings]   = useState<Settings>({
    provider: "openrouter",
    apiKey: process.env.NEXT_PUBLIC_OPENROUTER_API_KEY || "",
    model: "z-ai/glm-4.5-air:free",
  });
  const bottomRef                 = useRef<HTMLDivElement>(null);
  const inputRef                  = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendMessage() {
    const query = input.trim();
    if (!query || loading) return;

    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: query }]);
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          userQuery: query, 
          sessionId,
          llmProvider: settings.provider,
          apiKey: settings.apiKey,
          model: settings.model,
          currentRows: [],
        }),
      });

      const data = await res.json();

      if (data.error) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: `Error: ${data.error}` },
        ]);
        return;
      }

      setMessages((prev) => [
        ...prev,
        {
          role:    "assistant",
          content: data.response,
          sql:     data.generatedSQL,
        },
      ]);

      if (data.shouldUpdateTable && data.queryResult) {
        onTableUpdate(data.queryResult);
      }

    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Something went wrong. Please try again." },
      ]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  const suggestions = [
    "Show all proposals",
    "How many Won?",
    "Total value by department",
    "Sort by proposal value",
    "Group by status",
  ];

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="px-4 py-3 border-b border-gray-200 bg-white">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-gray-700">Chat with your data</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {settings.provider === "nvidia" ? "NVIDIA" : "OpenRouter"}
              {settings.model && ` • ${settings.model}`}
            </p>
          </div>
          <SettingsPanel settings={settings} onSettingsChange={setSettings} />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                msg.role === "user"
                  ? "bg-blue-600 text-white rounded-br-sm"
                  : "bg-gray-100 text-gray-800 rounded-bl-sm"
              }`}
            >
              <p>{msg.content}</p>
              {msg.sql && (
                <details className="mt-2">
                  <summary className="text-xs opacity-60 cursor-pointer hover:opacity-80">
                    View SQL
                  </summary>
                  <pre className="mt-1.5 text-xs font-mono opacity-80 whitespace-pre-wrap break-all">
                    {msg.sql}
                  </pre>
                </details>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 rounded-2xl rounded-bl-sm px-4 py-3">
              <div className="flex gap-1 items-center">
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:0ms]" />
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:150ms]" />
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="px-4 pb-2 flex gap-1.5 flex-wrap">
        {suggestions.map((s) => (
          <button
            key={s}
            onClick={() => { setInput(s); inputRef.current?.focus(); }}
            className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 px-2.5 py-1 rounded-full transition-colors whitespace-nowrap"
          >
            {s}
          </button>
        ))}
      </div>

      <div className="px-4 pb-4 pt-1">
        <div className="flex gap-2 items-center border border-gray-200 rounded-xl px-3 py-2 focus-within:border-blue-400 focus-within:ring-1 focus-within:ring-blue-100 transition-all bg-white">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
placeholder="Ask about your proposals..."
              className="flex-1 text-sm outline-none text-gray-700 placeholder-gray-500 bg-transparent"
            disabled={loading}
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || loading}
            className="w-7 h-7 flex items-center justify-center bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200 disabled:cursor-not-allowed rounded-lg transition-colors flex-shrink-0"
          >
            <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
