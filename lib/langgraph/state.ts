import { Annotation } from "@langchain/langgraph";

export interface Message {
  role: "user" | "assistant";
  content: string;
}

export interface ContactRow {
  id: number;
  name: string;
  email: string;
  company_name: string;
  phone_number: string;
  city: string;
  designation: string;
  enquiry_received_date: string | null;
  go_no_go_decision: string | null;
  proposal_sent_date: string | null;
  mode_of_submission: string | null;
  proposal_enquiry_for: string | null;
  project_name: string | null;
  proposal_value_inr: number | null;
  quotation_method: string | null;
  department: string | null;
  status: string | null;
  inbound_outbound: string | null;
  existing_new_customer: string | null;
  remarks: string | null;
  type_of_customer: string | null;
  sector: string | null;
  proposal_number: string | null;
}

export type LLMProvider = "openrouter" | "nvidia";

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
  llmProvider: Annotation<LLMProvider>({
    reducer: (_, next) => next,
  }),
  apiKey: Annotation<string>({
    reducer: (_, next) => next,
  }),
  model: Annotation<string>({
    reducer: (_, next) => next,
  }),
  currentRows: Annotation<ContactRow[]>({
    reducer: (_, next) => next,
  }),
});

export type QueryGraphStateType = typeof QueryGraphState.State;
