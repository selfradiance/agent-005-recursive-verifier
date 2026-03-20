# Agent 005: Recursive Verifier — Agent Conventions

## Project Overview

Agent 005 is a recursive verification framework. It extracts the recursive sandbox architecture from Agent 004 (Red Team Simulator) and repurposes it for constructive verification — generating executable proof about code quality, design correctness, and system resilience.

The core loop: reason → generate JavaScript code → execute in sandbox → measure outcome → iterate.

## Tech Stack

- **Language:** TypeScript
- **Runtime:** Node.js 22+ (permission flags require 22)
- **Testing:** Vitest
- **LLM:** Anthropic Claude API (claude-sonnet-4-20250514) via @anthropic-ai/sdk
- **Sandbox:** Node child process with permission flags + global nullification + IPC toolkit + validator
- **Config:** dotenv
- **Build/Run:** tsx

## Architecture

```
CLI (src/cli.ts)           → Entry point, --mode flag selects verification type
Runner (src/runner.ts)     → Orchestrates the recursive loop per mode
Reasoner (src/reasoner.ts) → Claude API: analyzes results, produces hypotheses
Generator (src/generator.ts) → Claude API: turns hypotheses into executable JS
Sandbox (src/sandbox/)     → Validator, executor, child runner — ported from Agent 004
```

## Key Rules

1. **Never weaken sandbox security.** The four-layer defense (permission flags, global nullification, IPC-only toolkit, string-level validator) must remain intact.
2. **Sandbox code is ported from Agent 004** (`~/Desktop/projects/agent-004-red-team/src/sandbox/`). Do not rewrite from scratch.
3. **Agent 005 is standalone.** It does NOT depend on AgentGate.
4. **Never commit `.env`** — it contains `ANTHROPIC_API_KEY`.
5. **Run all tests** (`npm test`) before committing.
6. **Update `AGENT005_PROJECT_CONTEXT.md`** at the end of every session.

## Coding Conventions

- Use ES modules (`import`/`export`), not CommonJS
- Strict TypeScript — no `any` unless absolutely necessary
- Tests go in `test/` directory, mirroring `src/` structure
- Use Vitest for all tests
- Keep functions small and focused
- Error handling: throw typed errors, don't swallow exceptions

## Commit Conventions

- One concern per commit
- Clear commit messages describing what changed and why
- Push to GitHub after every commit
