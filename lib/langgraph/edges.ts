import { QueryGraphStateType } from "./state";

export function routeAfterIntent(state: QueryGraphStateType): string {
  if (state.queryIntent === "unknown") {
    console.log("🔀 unknown → response_formatter");
    return "response_formatter";
  }
  console.log(`🔀 ${state.queryIntent} → sql_generator`);
  return "sql_generator";
}

export function routeAfterExecution(state: QueryGraphStateType): string {
  if (!state.queryError) {
    console.log("🔀 success → response_formatter");
    return "response_formatter";
  }
  if ((state.retryCount ?? 0) < 3) {
    console.log(`🔀 error, retry attempt ${state.retryCount}`);
    return "error_recovery";
  }
  console.log("🔀 max retries → response_formatter");
  return "response_formatter";
}
