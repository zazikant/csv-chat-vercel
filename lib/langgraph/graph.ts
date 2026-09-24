import { StateGraph, END, START } from "@langchain/langgraph";
import { QueryGraphState } from "./state";
import {
  schemaLoaderNode,
  intentClassifierNode,
  sqlGeneratorNode,
  queryExecutorNode,
  errorRecoveryNode,
  responseFormatterNode,
} from "./nodes";
import { routeAfterIntent, routeAfterExecution } from "./edges";

const builder = new StateGraph(QueryGraphState)
  .addNode("schema_loader",     schemaLoaderNode)
  .addNode("intent_classifier", intentClassifierNode)
  .addNode("sql_generator",     sqlGeneratorNode)
  .addNode("query_executor",    queryExecutorNode)
  .addNode("error_recovery",    errorRecoveryNode)
  .addNode("response_formatter",responseFormatterNode)

  .addEdge(START,               "schema_loader")
  .addEdge("schema_loader",     "intent_classifier")
  .addEdge("sql_generator",     "query_executor")
  .addEdge("error_recovery",    "query_executor")
  .addEdge("response_formatter", END)

  .addConditionalEdges("intent_classifier", routeAfterIntent, {
    sql_generator:      "sql_generator",
    response_formatter: "response_formatter",
  })
  .addConditionalEdges("query_executor", routeAfterExecution, {
    response_formatter: "response_formatter",
    error_recovery:     "error_recovery",
  });

export const graph = builder.compile();
