// =============================================================================
//  Email Campaign Tracker - data types (Schema v2: manual per-contact counters)
// =============================================================================

import { Annotation } from "@langchain/langgraph";

export interface Message {
  role: "user" | "assistant";
  content: string;
}

// ---- contacts -------------------------------------------------------------
// One row per person. Each contact is assigned to AT MOST ONE mailer at a time
// (mailer_id). opens/clicks are manually entered per (contact, mailer).
// The optin_status dropdown covers unsubscribed/bounced state.
// If a contact is unsubscribed, set optin_status = 'Unsubscribed'.
export interface ContactRow {
  email: string;
  name: string | null;
  company: string | null;
  designation: string | null;
  phone: string | null;
  city: string | null;
  sector: string | null;
  optin_status: string | null;      // Subscribed / Hard Bounced / Unsubscribed
  mailer_id: string | null;         // FK to mailers.mailer_id (nullable)
  opens: number;                    // manually entered per (contact, mailer)
  clicks: number;                   // manually entered per (contact, mailer)
  tags: string[];                  // free-form categorization tags
  last_activity_date: string | null;
  engagement_score: string | null;  // HOT / WARM / COLD (auto)
}

// ---- mailers ---------------------------------------------------------------
// All counters below are AUTO-MAINTAINED by a trigger on `contacts` —
// every INSERT/UPDATE/DELETE on contacts recomputes the affected mailer's
// counters from scratch. Never write to these columns directly.
// open_rate / click_rate / unsubscribe_rate are GENERATED ALWAYS columns.
//
// `unsubscribed_count` is computed from contacts where optin_status = 'Unsubscribed'
// AND mailer_id = this mailer.
export interface MailerRow {
  mailer_id: string;
  subject_line: string;
  template_name: string | null;
  sent_date: string | null;
  // auto-maintained:
  total_sent: number;
  unique_opens: number;
  total_opens: number;
  unique_clicks: number;
  total_clicks: number;
  unsubscribed_count: number;  // optin_status='Unsubscribed'
  hardbounced_count: number;   // optin_status='Hard Bounced' (NEW v2.2)
  // generated:
  open_rate: number | null;
  click_rate: number | null;
  unsubscribe_rate: number | null;
  hardbounce_rate: number | null;   // NEW v2.2
}

// ---- LLM provider (NVIDIA only — see lib/nvidia.ts) -------------------
//
// The app uses NVIDIA's integrate API exclusively (model defaults to
// nvidia/nemotron-3-super-120b-a12b). The API key is read server-side
// from NVIDIA_API_KEY — never exposed to the browser.
//
// Ported from github.com/zazikant/tradingview-notes-app-nvidia.

export const QueryGraphState = Annotation.Root({
  userQuery: Annotation<string>({
    reducer: (_, next) => next,
  }),
  sessionId: Annotation<string>({
    reducer: (_, next) => next,
  }),
  queryIntent: Annotation<string>({
    reducer: (_, next) => next,
  }),
  generatedSQL: Annotation<string>({
    reducer: (_, next) => next,
  }),
  queryResult: Annotation<ContactRow[]>({
    reducer: (_, next) => next,
  }),
  queryError: Annotation<string | null>({
    reducer: (_, next) => next,
  }),
  retryCount: Annotation<number>({
    reducer: (_, next) => next,
  }),
  finalResponse: Annotation<string>({
    reducer: (_, next) => next,
  }),
  shouldUpdateTable: Annotation<boolean>({
    reducer: (_, next) => next,
  }),
  tableSchema: Annotation<string>({
    reducer: (_, next) => next,
  }),
  conversationHistory: Annotation<Message[]>({
    reducer: (existing, next) => {
      const merged = [...existing, ...next];
      return merged.slice(-20);
    },
  }),
  currentRows: Annotation<ContactRow[]>({
    reducer: (_, next) => next,
  }),
});

export type QueryGraphStateType = typeof QueryGraphState.State;
