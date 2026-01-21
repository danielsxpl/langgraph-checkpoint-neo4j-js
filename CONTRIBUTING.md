# Contributing to langgraph-checkpoint-neo4j

Thank you for considering contributing! This project is a learning opportunity and we welcome contributions from developers of all skill levels.

## 🌟 Ways to Contribute

### 1. Report Issues
Found a bug? Have a question? [Open an issue](../../issues/new)

**Good bug reports include:**
- Clear description of the problem
- Steps to reproduce
- Expected vs actual behavior
- Your environment (Node version, Neo4j version, OS)

### 2. Improve Documentation
- Fix typos or unclear explanations
- Add code examples
- Improve API documentation
- Write tutorials or guides

### 3. Add Tests
We need help with testing! Areas that need coverage:
- Unit tests for serialization
- Integration tests with real Neo4j
- Performance benchmarks
- Edge case testing

### 4. Write Examples
Show how to use this in real applications:
- Basic chatbot with memory
- Multi-user conversation system
- Branching conversation explorer
- Migration from SQLite/Postgres

### 5. Fix Bugs or Add Features
Check out [Good First Issues](../../issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) for beginner-friendly tasks.

## 🚀 Getting Started

### Prerequisites
- Node.js ≥ 18
- Bun (recommended) or npm
- Neo4j 5.0+ (for testing)
- Git

### Setup Development Environment

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/langgraph-checkpoint-neo4j-js.git
cd langgraph-checkpoint-neo4j-js

# Install dependencies
bun install

# Build the project
bun run build

# Run tests (when available)
bun test
```

### Project Structure

```
src/
  ├── types.ts           # TypeScript interfaces
  ├── cypher-queries.ts  # All 30 Cypher queries
  ├── base.ts            # Base class with serialization
  ├── saver.ts           # Main Neo4jSaver class
  └── index.ts           # Public exports
```

## 📝 Development Guidelines

### Code Style
- Use TypeScript
- Follow existing code patterns
- Add JSDoc comments for public APIs
- Use descriptive variable names

### Commit Messages
```
type(scope): brief description

Longer explanation if needed
```

Types: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`

Examples:
- `feat(saver): add batch operations support`
- `fix(serialization): handle null values correctly`
- `docs(readme): clarify setup instructions`
- `test(integration): add Neo4j connection tests`

### Pull Request Process

1. **Fork the repository**
2. **Create a branch** from `main`
   ```bash
   git checkout -b feat/my-feature
   ```
3. **Make your changes**
   - Write clear, focused commits
   - Add tests if applicable
   - Update documentation
4. **Build and test**
   ```bash
   bun run build
   bun test
   ```
5. **Push to your fork**
   ```bash
   git push origin feat/my-feature
   ```
6. **Open a Pull Request**
   - Describe what you changed and why
   - Reference any related issues
   - Be patient - we'll review as soon as possible!

## 🤝 Code of Conduct

### Our Promise
We're committed to providing a welcoming and inclusive environment.

### Expected Behavior
- Be respectful and considerate
- Welcome newcomers
- Give and accept constructive feedback gracefully
- Focus on what's best for the project

### Unacceptable Behavior
- Harassment, discrimination, or toxic behavior
- Trolling or inflammatory comments
- Spam or self-promotion

**If you experience or witness unacceptable behavior, please report it to the maintainers.**

## ❓ Questions?

- **General questions**: Open a [Discussion](../../discussions)
- **Bug reports**: Open an [Issue](../../issues)
- **Security issues**: Email directly (see README for contact)

## 🙏 Thank You

Every contribution matters - whether it's a typo fix or a major feature. Thank you for making this project better!

---

**New to open source?** Check out [First Timers Only](https://www.firsttimersonly.com/) for resources!
