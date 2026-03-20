# Agent 005: Recursive Verifier

A recursive verification framework that generates executable proof — not opinions — about code quality, design correctness, and system resilience.

> **⚠️ Important: Target modules run in the parent process (not sandboxed).** Only the generated test code runs in the sandbox. Use trusted, local modules only. Pure functions work best.

## How It Works

The core loop: **reason → generate JavaScript code → execute in sandbox → measure outcome → iterate.**

1. **Reasoner** — Claude analyzes your module's source code and produces test hypotheses
2. **Generator** — Claude turns those hypotheses into executable test code
3. **Validator** — Structural checks ensure the generated code is safe for the sandbox
4. **Executor** — Code runs in a permission-restricted child process (Node 22 permission flags, global nullification, IPC-only toolkit)
5. **Scorer** — 8 metrics + edge case detection measure what was tested
6. **Repeat** — Prior round scores feed into the next round's reasoner, targeting gaps

Each round gets smarter about boundary conditions, error paths, and interaction effects.

## Verification Modes

| Mode | What it verifies | Status |
|------|-----------------|--------|
| Test Generation (v0.1.0) | Behavior — "Does this code do what it should?" | Built |
| Code Reviewer (v0.2.0) | Implementation — "Is this code correct and robust?" | Planned |
| API Design Adversary (v0.3.0) | Design — "Is this design sound before I build it?" | Planned |

## Setup

```bash
cp .env.example .env
# Add your ANTHROPIC_API_KEY to .env
npm install
```

Requires **Node.js 22+** (permission flags require 22).

## Usage

```bash
# Basic — test all exported functions, 3 rounds
npx tsx src/cli.ts --file path/to/module.ts

# Focus on specific functions
npx tsx src/cli.ts --file path/to/module.ts --functions "add,subtract,multiply"

# More rounds (max 10)
npx tsx src/cli.ts --file path/to/module.ts --rounds 5

# Show generated test code
npx tsx src/cli.ts --file path/to/module.ts --verbose

# Try it with the sample module
npx tsx src/cli.ts --file examples/sample-math.ts --verbose
```

## Scoring Metrics

Each round produces:
- **Tests generated/passed/failed** — volume and correctness
- **Errors caught** — error path coverage
- **Timeouts** — potential infinite loops or performance issues
- **Invalid tests** — generator quality (bad test, not a target bug)
- **Unique functions tested** — breadth
- **Edge cases covered** — nullish, zero, negative, empty, large numeric, special chars, NaN, type mismatch, boolean, long string (10 classes)

## Sandbox Security

Four layers of defense (ported from Agent 004's red team simulator):
1. **Node 22 permission flags** — filesystem and child process access restricted
2. **Global nullification** — dangerous globals (fetch, eval, require, process, timers) deleted before code runs
3. **IPC-only toolkit** — generated code can only call parent-approved methods via message passing
4. **String-level validator** — blocklist of 34+ patterns, structural checks, nesting limits

## Known Limitations (v0.1.0)

- Target modules with import-time side effects will execute in the parent (no safety net)
- No callback/function argument support (IPC serialization limitation)
- State contamination across rounds (module stays loaded; internal state carries over)
- Sync infinite loops in target code cannot be preempted (15s hard timeout kills the round)
- No code coverage instrumentation (deferred to v0.2.0)

## Tech Stack

- **TypeScript** on **Node.js 22+** (permission flags require 22)
- **Vitest** — 55 tests across 3 files (module-host, validator, scorer)
- **Anthropic Claude API** (`claude-sonnet-4-20250514`) via `@anthropic-ai/sdk`
- **dotenv** for environment config

## Tests

```bash
npm test
# 55 tests across 3 files: module-host (32), validator (15), scorer (8)
```

## License

MIT
