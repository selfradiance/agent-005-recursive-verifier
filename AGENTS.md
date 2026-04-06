# Agent 005: Recursive Verifier — Agent Conventions

## Project Overview

Agent 005 is a recursive verification framework. It extracts the recursive sandbox architecture from Agent 004 (Red Team Simulator) and repurposes it for constructive verification — generating executable proof about code quality, design correctness, and system resilience.

The core loop: reason → generate JavaScript code → execute in sandbox → measure outcome → iterate.

**Critical product boundary:** Agent 005 sandboxes the GENERATED TEST CODE, not the target module. The user's target module runs in the parent process with full Node.js capability.

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
CLI (src/cli.ts)              → Entry point, arg parsing, startup banner
Runner (src/runner.ts)        → Orchestrates the recursive loop per mode
Reasoner (src/reasoner.ts)    → Claude API: source code + prior results → hypotheses
Generator (src/generator.ts)  → Claude API: hypotheses → executable test code
Scorer (src/scorer.ts)        → 8 metrics + edge case detection
Reporter (src/reporter.ts)    → Claude API: all rounds → final summary report
ModuleHost (src/module-host.ts) → Loads target module, dispatches function calls, normalizes results
Sandbox:
  toolkit-host.ts             → IPC handler: 10 verification toolkit methods
  executor.ts                 → Spawns permission-restricted child, manages lifecycle
  child-runner.js             → Global nullification, IPC toolkit, executes generated JS
  validator.ts                → Blocklist + structural checks before execution
```

## Key Rules

1. **Never weaken sandbox security.** The four-layer defense (permission flags, global nullification, IPC-only toolkit, string-level validator) must remain intact.
2. **Sandbox code originated from Agent 004** (`~/Desktop/projects/agent-004-red-team/src/sandbox/`). Already adapted for verification.
3. **Agent 005 is standalone.** It does NOT depend on AgentGate.
4. **Never commit `.env`** — it contains `ANTHROPIC_API_KEY`.
5. **Run all tests** (`npm test`) before committing.
6. **Update `AGENT005_PROJECT_CONTEXT.md`** at the end of every session.
7. **The validator blocklist must not block toolkit method names.** The `Function(` pattern uses a negative lookbehind so `callFunction(` is allowed.
8. **Change size targets.** Keep diffs under ~100 lines per change. If a change exceeds 300 lines, stop and break it into smaller pieces before proceeding.

## Coding Conventions

- Use ES modules (`import`/`export`), not CommonJS
- Strict TypeScript — no `any` unless absolutely necessary
- Tests go in `test/` directory, mirroring `src/` structure
- Use Vitest for all tests
- Keep functions small and focused
- Error handling: throw typed errors, don't swallow exceptions

## Anti-Rationalization

| Excuse | Rebuttal |
|--------|----------|
| "I'll add tests later" | Tests are not optional. Write them now. |
| "It's just a prototype" | Prototypes become production. Build it right. |
| "This change is too small to break anything" | Small changes cause subtle bugs. Run the tests. |
| "I already know this works" | You don't. Verify it. |
| "Cleaning up this adjacent code will save time" | Stay in scope. File it for later. |
| "The user probably meant X" | Don't assume. Ask. |
| "Skipping the audit since it's straightforward" | Straightforward changes still need verification. |
| "I'll commit everything at the end" | Commit after each verified change. No batching. |

## Commit Conventions

- One concern per commit
- Clear commit messages describing what changed and why
- Push to GitHub after every commit

### Slicing Strategies

- **Vertical slice:** Implement one complete feature top to bottom (route, logic, test) before starting another.
- **Risk-first slice:** Tackle the riskiest or most uncertain piece first to surface problems early.
- **Contract-first slice:** Define the API contract or interface first, then implement behind it.
