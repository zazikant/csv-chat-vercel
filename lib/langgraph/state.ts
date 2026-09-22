// =============================================================================
//  Email Campaign Tracker - data types
//  Mirrors the new 3-table schema:
//    contacts       - master contact list (PK: email)
//    mailers        - campaign library    (PK: mailer_id)
//    email_journey  - event log           (PK: id)
// =============================================================================

import { Annotation } from "@langchain/langgraph";

export interface Message {
  role: "user" | "assistant";
  content: string;
}

// ---- contacts -------------------------------------------------------------
export interface ContactRow {
  email: string;
  name: string | null;
  company: string | null;
  designation: string | null;
  phone: string | null;
  city: string | null;
  sector: string | null;
  customer_type: string | null;     // Existing / New
  optin_status: string | null;      // Subscribed / Unsubscribed / Bounced / Unknown
  total_sent: number;
  total_opens: number;
  total_clicks: number;
  last_activity_date: string | null;
  engagement_score: string | null;  // HOT / WARM / COLD
}

// ---- mailers ---------------------------------------------------------------
export interface MailerRow {
  mailer_id: string;          // e.g. M001
  subject_line: string;
  template_name: string | null;
  sent_date: string | null;
  total_sent: number;
  delivered: number;
  unique_opens: number;
  total_opens: number;
  unique_clicks: number;
  total_clicks: number;
  bounced: number;
  unsubscribed: number;
  open_rate: number | null;   // computed % (0-100)
  click_rate: number | null;  // computed % (0-100)
}

// ---- email_journey ---------------------------------------------------------
export type JourneyEventType =
  | "SENT"
  | "DELIVERED"
  | "OPENED"
  | "CLICKED"
  | "BOUNCED"
  | "UNSUBSCRIBED";

export interface JourneyRow {
  id: number;
  email: string;
  mailer_id: string;
  subject_line: string | null;
  event_type: JourneyEventType;
  timestamp: string;
  link_clicked: string | null;
  device_info: string | null;
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
