# Neo4j Checkpoint Saver for LangGraph.js

> A TypeScript implementation of persistent checkpoint storage for LangGraph agents using Neo4j's graph database.

[![npm version](https://img.shields.io/npm/v/@othmanadi/langgraph-checkpoint-neo4j.svg)](https://www.npmjs.com/package/@othmanadi/langgraph-checkpoint-neo4j)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## What is this?

This package lets your LangGraph agents remember conversations across restarts by storing their state in Neo4j. It's a **TypeScript port** of the Python [langchain-neo4j](https://github.com/langchain-ai/langchain-neo4j) checkpoint saver.

**Key Features:**
- 💾 Persistent agent memory in Neo4j
- 🌳 Graph-native storage using relationships
- 🔀 Branching conversations (time-travel support)
- 📦 Drop-in replacement for other checkpointers
- 🎯 Full TypeScript support

## Why Neo4j?

If you're already using Neo4j in your stack, this gives you:
- **One less database** to manage
- **Visual debugging** - see conversation flow in Neo4j Browser
- **Powerful queries** - leverage Cypher to analyze agent behavior

## Installation

```bash
npm install @othmanadi/langgraph-checkpoint-neo4j neo4j-driver
# or
bun add @othmanadi/langgraph-checkpoint-neo4j neo4j-driver
```

## Quick Start

```typescript
import { Neo4jSaver } from "@othmanadi/langgraph-checkpoint-neo4j";
import { createReactAgent } from "@langchain/langgraph/prebuilt";

// Create checkpointer
const checkpointer = Neo4jSaver.fromConnString({
  uri: "bolt://localhost:7687",
  user: "neo4j",
  password: "your-password",
});

// Run setup once (creates indexes)
await checkpointer.setup();

// Use with your agent
const agent = createReactAgent({
  llm: yourModel,
  tools: yourTools,
}).compile({ checkpointer });

// Conversations now persist!
const config = { configurable: { thread_id: "user-123" } };
await agent.invoke({ messages: [["user", "Hello!"]] }, config);

// Later (even after restart), state is restored
await agent.invoke({ messages: [["user", "What did I say?"]] }, config);

// Cleanup when done
await checkpointer.close();
```

## How It Works

Checkpoints are stored as a graph:

```
(:Thread)─[:HAS_CHECKPOINT]→(:Checkpoint)─[:PREVIOUS]→(:Checkpoint)
    │                           │
    └─[:HAS_BRANCH]→(:Branch)   ├─[:HAS_CHANNEL]→(:ChannelState)
                                └─[:HAS_WRITE]→(:PendingWrite)
```

Each conversation thread has checkpoints linked in a chain. Branches enable "time-travel" - fork from any point without losing history.

## Documentation

- [API Reference](./docs/api.md) (coming soon)
- [Graph Model Details](./docs/graph-model.md) (coming soon)
- [Migration Guide](./docs/migration.md) (coming soon)

## Requirements

- Node.js ≥ 18
- Neo4j ≥ 5.0
- @langchain/langgraph-checkpoint ≥ 0.0.17

## Project Status

**Early Release** - This is a working port of the Python implementation, but:
- ✅ Core functionality complete
- ✅ TypeScript definitions included
- ⚠️ Tests are minimal (help wanted!)
- ⚠️ Not yet battle-tested in production

**We welcome contributors!** See [CONTRIBUTING.md](./CONTRIBUTING.md) for ways to help.

## Roadmap

- [ ] Comprehensive test suite
- [ ] Performance benchmarks vs SQLite/Postgres
- [ ] Example apps
- [ ] Async batch operations
- [ ] Migration tools from other checkpointers

## Comparison with Other Checkpointers

| Feature | Neo4j | SQLite | Postgres | Redis |
|---------|-------|--------|----------|-------|
| Persistent | ✅ | ✅ | ✅ | ⚠️ (if configured) |
| Branching | ✅ | ❌ | ❌ | ❌ |
| Visual Debug | ✅ | ❌ | ❌ | ❌ |
| Setup Complexity | Medium | Low | Medium | Low |
| Best For | Graph-heavy apps | Simple apps | Enterprise | High-speed cache |

## Contributing

We're actively looking for contributors! Ways to help:

1. **Test in your project** - Report issues
2. **Add tests** - Especially integration tests
3. **Write examples** - Show real-world usage
4. **Improve docs** - Clarify confusing parts
5. **Optimize performance** - Benchmark and improve

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## Acknowledgments

This project is a TypeScript port of [langchain-neo4j](https://github.com/langchain-ai/langchain-neo4j) by LangChain, Inc. We're grateful for their excellent Python implementation that made this port possible.

## License

MIT © Ahmad Othman Adi

---

**Questions?** Open a [Discussion](../../discussions) 💬

**Found a bug?** Create an [Issue](../../issues) 🐛

**Want to help?** Check [Good First Issues](../../issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) 🌟
