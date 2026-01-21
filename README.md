# @langchain/langgraph-checkpoint-neo4j

Neo4j checkpoint saver for LangGraph.js with branching time-travel support.

This is a TypeScript port of the [langchain-neo4j](https://github.com/langchain-ai/langchain-neo4j) Python package's checkpoint saver.

## Features

- **Persistent Agent Memory**: Store and retrieve LangGraph checkpoints in Neo4j
- **Graph-Native Data Model**: Leverages Neo4j relationships for efficient traversal
- **Branching Time-Travel**: Fork conversations from any checkpoint without losing history
- **Full TypeScript Support**: Complete type definitions included

## Installation

```bash
npm install @langchain/langgraph-checkpoint-neo4j neo4j-driver
```

## Quick Start

```typescript
import { Neo4jSaver } from "@langchain/langgraph-checkpoint-neo4j";
import { createReactAgent } from "@langchain/langgraph/prebuilt";

// Create checkpointer
const checkpointer = Neo4jSaver.fromConnString({
  uri: "bolt://localhost:7687",
  user: "neo4j",
  password: "password",
});

// Setup indexes (run once)
await checkpointer.setup();

// Use with LangGraph
const graph = createReactAgent({
  llm: model,
  tools: [tool1, tool2],
}).compile({
  checkpointer,
});

// Run with thread_id for persistence
const config = { configurable: { thread_id: "my-conversation" } };
const result = await graph.invoke({ messages: [["user", "Hello!"]] }, config);

// Continue conversation (state is automatically restored)
const result2 = await graph.invoke(
  { messages: [["user", "What did I just say?"]] },
  config
);

// Cleanup when done
await checkpointer.close();
```

## Neo4j Graph Data Model

The checkpointer uses a graph model with nodes and relationships:

```
                         ┌─────────────────────────────────────┐
                         │                                     │
                         ▼                                     │
(:Thread)──[HAS_CHECKPOINT]──►(:Checkpoint)──[PREVIOUS]────────┘
    │                              │
    │                    ┌─────────┼─────────┐
    │                    │         │         │
    ▼                    ▼         ▼         ▼
[HAS_BRANCH]       [HAS_CHANNEL] [HAS_WRITE] [ON_BRANCH]
    │                    │         │         │
    ▼                    ▼         ▼         │
(:Branch)◄────────(:ChannelState) (:PendingWrite)
    │                                        │
    └────────────[HEAD]──────────────────────┘
```

### Node Types

| Node | Description | Key Properties |
|------|-------------|----------------|
| `Thread` | Conversation thread | `thread_id`, `checkpoint_ns` |
| `Checkpoint` | Point-in-time state | `checkpoint_id`, `checkpoint`, `metadata`, `created_at` |
| `ChannelState` | Channel value storage | `channel`, `version`, `type`, `blob` |
| `PendingWrite` | Fault-tolerant writes | `task_id`, `channel`, `blob`, `idx` |
| `Branch` | Conversation branch | `branch_id`, `name`, `fork_point_id`, `created_at` |

## API Reference

### `Neo4jSaver`

Main class for checkpoint persistence.

#### `Neo4jSaver.fromConnString(config)`

Create a checkpointer from connection parameters.

```typescript
const checkpointer = Neo4jSaver.fromConnString({
  uri: "bolt://localhost:7687",
  user: "neo4j",
  password: "password",
  database: "neo4j", // optional
});
```

#### `checkpointer.setup()`

Create indexes and constraints. Call once before using.

```typescript
await checkpointer.setup();
```

#### `checkpointer.close()`

Close the Neo4j connection when done.

```typescript
await checkpointer.close();
```

## Requirements

- Node.js >= 18.0.0
- Neo4j >= 5.0
- @langchain/langgraph-checkpoint >= 0.0.17

## License

MIT

## Author

Ahmad Othman Adi

## Acknowledgments

This project is a TypeScript port of the Neo4j checkpoint saver from [langchain-neo4j](https://github.com/langchain-ai/langchain-neo4j) by LangChain, Inc.
