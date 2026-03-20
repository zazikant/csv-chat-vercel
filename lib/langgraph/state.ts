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
}

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
});

export type QueryGraphStateType = typeof QueryGraphState.State;
