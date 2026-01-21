/**
 * @langchain/langgraph-checkpoint-neo4j
 *
 * Neo4j checkpoint saver for LangGraph.js with branching time-travel support.
 *
 * @example
 * ```typescript
 * import { Neo4jSaver } from "@langchain/langgraph-checkpoint-neo4j";
 *
 * // Create checkpointer
 * const checkpointer = Neo4jSaver.fromConnString({
 *   uri: "bolt://localhost:7687",
 *   user: "neo4j",
 *   password: "password"
 * });
 *
 * // Setup (run once)
 * await checkpointer.setup();
 *
 * // Use with LangGraph
 * const graph = createReactAgent({ ... }).compile({
 *   checkpointer
 * });
 *
 * // Run with thread_id for persistence
 * const config = { configurable: { thread_id: "my-conversation" } };
 * const result = await graph.invoke({ messages: [...] }, config);
 *
 * // Continue conversation (state is automatically restored)
 * const result2 = await graph.invoke({ messages: [...] }, config);
 *
 * // Cleanup
 * await checkpointer.close();
 * ```
 *
 * @packageDocumentation
 */

// Main exports
export { Neo4jSaver } from "./saver.js";

// Base class (for extension)
export { BaseNeo4jSaver } from "./base.js";

// Types
export type {
  Neo4jConfig,
  Neo4jSaverOptions,
  BlobData,
  WriteRecord,
  CheckpointRecord,
  ParsedConfig,
  BranchInfo,
} from "./types.js";

// Cypher queries (for advanced usage)
export * from "./cypher-queries.js";
