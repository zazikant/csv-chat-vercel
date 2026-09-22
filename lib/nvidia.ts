/**
 * NVIDIA LLM client — streaming chat completions via NVIDIA's integrate API.
 *
 * Ported from github.com/zazikant/tradingview-notes-app-nvidia  (src/lib/brain/nvidia.ts)
 * to keep behaviour identical across the two apps.
 *
 * Uses raw fetch + SSE parsing so we don't need the @langchain/openai SDK at
 * runtime. The LangGraph nodes in lib/langgraph/nodes.ts call nvidiaChat()
 * (the non-streaming convenience wrapper below), which uses the same
 * streaming primitive under the hood but collects the chunks into a single
 * string before returning.
 *
 * Required env vars (server-only — never expose to the browser):
 *   NVIDIA_API_KEY  — your NVIDIA build API key (https://build.nvidia.com → API key)
 *
 * Gateway: https://integrate.api.nvidia.com/v1/chat/completions
 * Model:   nvidia/nemotron-3-super-120b-a12b (default) — 120B params, fast (~4s),
 *          produces clean content with minimal reasoning. Uses reasoning_effort:'low'.
 *
 * Retry / rate-handling:
 *   - Retryable HTTP statuses: 429, 500, 502, 503, 504
 *   - Retryable error codes: ECONNRESET, ETIMEDOUT, UND_ERR_CONNECT_TIMEOUT
 *   - Per-call timeout: 55s (under Vercel Hobby's 60s Node cap)
 */

const NVIDIA_GATEWAY = "https://integrate.api.nvidia.com/v1/chat/completions";
const NVIDIA_DEFAULT_MODEL = "nvidia/nemotron-3-super-120b-a12b";
const NVIDIA_DEFAULT_TEMPERATURE = 0.3;
const NVIDIA_DEFAULT_TOP_P = 1.0;
// Raised from 4096 to 16384. Nemotron sometimes burns the entire 4096 budget on
// reasoning_content (chain-of-thought) and produces 0 chars of actual content,
// causing the "empty content (reasoning_chars=0)" error. 16k tokens is enough
// for both reasoning + content for our short prompts.
const NVIDIA_DEFAULT_MAX_TOKENS = 16384;
const NVIDIA_DEFAULT_TIMEOUT_MS = 55_000;

export interface NvidiaChatOptions {
  model?: string;
  messages: { role: "system" | "user" | "assistant"; content: string }[];
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  timeoutMs?: number;
  maxRetries?: number;
  /** Fired for every log line — useful for debugging, ignored by LangGraph nodes. */
  onLog?: (line: string) => void;
  /** Fired for every content token as it arrives — ignored by LangGraph nodes. */
  onChunk?: (text: string) => void;
}

export interface NvidiaChatResult {
  content: string;
  reasoning: string;
  model: string;
  elapsedMs: number;
  attempts: number;
}

/**
 * Determines if an error is retryable (timeout, rate limit, or server error).
 *
 * Also treats "empty content" as retryable — Nemotron sometimes burns its
 * entire token budget on reasoning_content and returns 0 chars of actual
 * content. Retrying with the same params usually succeeds.
 */
function isRetryableError(err: unknown): boolean {
  const e = err as { status?: number; statusCode?: number; code?: string; constructor?: { name?: string }; message?: string };
  const status = e?.status || e?.statusCode || 0;
  if ([429, 500, 502, 503, 504].includes(status)) return true;
  if (["ECONNRESET", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT"].includes(e?.code || "")) return true;
  const errName: string = e?.constructor?.name || "";
  if (["APIConnectionError", "APITimeoutError", "ConnectionError"].includes(errName)) return true;
  const msg: string = (e?.message || "").toLowerCase();
  if (msg.includes("timeout") || msg.includes("rate limit") || msg.includes("too many requests") || msg.includes("econnreset")) return true;
  // Empty content from Nemotron is retryable
  if (msg.includes("empty content")) return true;
  return false;
}

/**
 * Streaming chat completion via NVIDIA's integrate API.
 *
 * - 55s per-call timeout (under Vercel Hobby's 60s Node cap)
 * - 1 attempt per call by default (caller can raise maxRetries to retry)
 * - Streams chunks via onChunk callback
 * - Emits structured log lines via onLog callback
 * - Returns full content + reasoning + timing metadata
 *
 * Note: NVIDIA's GPT-OSS / Nemotron models can emit both `delta.content`
 * (the answer) and `delta.reasoning_content` (chain-of-thought). We accumulate
 * both but only stream `content` to the caller. If the model misbehaves and
 * only returns reasoning, we fall back to using reasoning as the content.
 */
export async function nvidiaChatStreamControlled(
  opts: NvidiaChatOptions,
): Promise<NvidiaChatResult> {
  const model = opts.model || NVIDIA_DEFAULT_MODEL;
  const timeoutMs = opts.timeoutMs ?? NVIDIA_DEFAULT_TIMEOUT_MS;
  const maxRetries = opts.maxRetries ?? 1;
  const temperature = opts.temperature ?? NVIDIA_DEFAULT_TEMPERATURE;
  const topP = opts.topP ?? NVIDIA_DEFAULT_TOP_P;
  const maxTokens = opts.maxTokens ?? NVIDIA_DEFAULT_MAX_TOKENS;
  const callStart = Date.now();
  const apiKey = process.env.NVIDIA_API_KEY;

  if (!apiKey) {
    throw new Error(
      "NVIDIA_API_KEY env var is not set. Add it in Vercel → Project Settings → Environment Variables, or in .env.local for local dev.",
    );
  }

  opts.onLog?.(
    `[nvidia] start  model=${model} max_tokens=${maxTokens} temp=${temperature} top_p=${topP} timeout=${timeoutMs}ms`,
  );

  let lastErr: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(NVIDIA_GATEWAY, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          model,
          messages: opts.messages,
          max_tokens: maxTokens,
          temperature,
          top_p: topP,
          stream: true,
          reasoning_effort: "low",
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errText = await response.text();
        const err = new Error(
          `NVIDIA API error (${response.status}): ${errText.slice(0, 300)}`,
        ) as Error & { status: number };
        err.status = response.status;
        throw err;
      }
      if (!response.body) {
        throw new Error("NVIDIA API returned no response body");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let content = "";
      let reasoning = "";
      let ttfbMs: number | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (ttfbMs === null) ttfbMs = Date.now() - callStart;

        buffer += decoder.decode(value, { stream: true });
        let nlIdx: number;
        while ((nlIdx = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, nlIdx).trim();
          buffer = buffer.slice(nlIdx + 1);
          if (!line || !line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (data === "[DONE]") {
            const elapsed = Date.now() - callStart;
            opts.onLog?.(
              `[nvidia] ttfb=${ttfbMs ?? "n/a"}ms  done attempt=${attempt} elapsed=${elapsed}ms content_chars=${content.length} reasoning_chars=${reasoning.length}`,
            );
            if (!content && reasoning) {
              content = reasoning;
              opts.onChunk?.(content);
            }
            if (!content) {
              throw new Error(
                `empty content (reasoning_chars=${reasoning.length})`,
              );
            }
            return { content, reasoning, model, elapsedMs: elapsed, attempts: attempt };
          }
          try {
            const json = JSON.parse(data);
            const delta = json.choices?.[0]?.delta;
            if (delta) {
              if (typeof delta.content === "string" && delta.content) {
                content += delta.content;
                opts.onChunk?.(delta.content);
              }
              if (typeof delta.reasoning_content === "string") {
                reasoning += delta.reasoning_content;
              }
            }
          } catch {
            // Partial JSON across chunks — ignore, will be retried on next read.
          }
        }
      }

      const elapsed = Date.now() - callStart;
      if (!content && reasoning) {
        content = reasoning;
        opts.onChunk?.(content);
      }
      if (!content) {
        throw new Error(
          `empty content (stream ended without [DONE], reasoning_chars=${reasoning.length})`,
        );
      }
      opts.onLog?.(
        `[nvidia] ttfb=${ttfbMs ?? "n/a"}ms  done attempt=${attempt} elapsed=${elapsed}ms content_chars=${content.length} reasoning_chars=${reasoning.length}`,
      );
      return { content, reasoning, model, elapsedMs: elapsed, attempts: attempt };
    } catch (err: unknown) {
      clearTimeout(timeout);
      const e = err as Error;
      const elapsed = Date.now() - callStart;
      lastErr = e;
      if (e.name === "AbortError") {
        opts.onLog?.(
          `[nvidia] TIMEOUT attempt=${attempt} after ${timeoutMs}ms`,
        );
      } else {
        opts.onLog?.(
          `[nvidia] ERROR attempt=${attempt} after ${elapsed}ms: ${e.name}: ${e.message.slice(0, 200)}`,
        );
      }
      if (attempt < maxRetries && isRetryableError(e)) {
        const backoff = 500 * attempt;
        opts.onLog?.(
          `[nvidia] retry  backing off ${backoff}ms before attempt ${attempt + 1}`,
        );
        await new Promise((r) => setTimeout(r, backoff));
      } else if (!isRetryableError(e)) {
        throw e;
      }
    }
  }

  const elapsed = Date.now() - callStart;
  const finalErr = lastErr ?? new Error("unknown error");
  throw new Error(
    `NVIDIA call failed after ${maxRetries} attempts (${elapsed}ms): ${finalErr.name}: ${finalErr.message}`,
  );
}

/**
 * Non-streaming convenience wrapper.
 *
 * Used by the LangGraph nodes in lib/langgraph/nodes.ts. Each node calls
 * this with a single prompt string and gets back the full content. The
 * streaming primitive is still used under the hood (NVIDIA's API streams
 * regardless), but we collect chunks into a single string before returning.
 *
 *   const reply = await nvidiaChat("What is 2+2?");
 *   // → "4"
 *
 * Pass `system` to set a system prompt:
 *
 *   const reply = await nvidiaChat("List 3 fruits", {
 *     system: "You are a helpful assistant. Be concise.",
 *   });
 */
export async function nvidiaChat(
  prompt: string,
  opts?: {
    system?: string;
    history?: { role: "user" | "assistant"; content: string }[];
    model?: string;
    temperature?: number;
    maxTokens?: number;
    timeoutMs?: number;
    maxRetries?: number;
  },
): Promise<string> {
  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [];
  if (opts?.system) messages.push({ role: "system", content: opts.system });
  if (opts?.history && opts.history.length > 0) {
    messages.push(...opts.history.slice(-20));
  }
  messages.push({ role: "user", content: prompt });

  const result = await nvidiaChatStreamControlled({
    messages,
    model: opts?.model,
    temperature: opts?.temperature,
    maxTokens: opts?.maxTokens,
    timeoutMs: opts?.timeoutMs,
    maxRetries: opts?.maxRetries,
  });
  return result.content;
}

export { isRetryableError, NVIDIA_DEFAULT_MODEL };
