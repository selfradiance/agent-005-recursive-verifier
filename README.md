# Agent 005: Recursive Verifier

A recursive verification framework that generates executable proof — not opinions — about code quality, design correctness, and system resilience.

> **⚠️ Important: Target modules run in the parent process (not sandboxed).** Only the generated test code runs in the sandbox. Use trusted, local modules only. Pure functions work best.

## How It Works

Two modes, same engine: **reason → generate JavaScript code → execute in sandbox → measure outcome → iterate.**

### Test Generation (v0.1.0)

Asks: "What inputs haven't been tested?" Generates test cases, runs them, scores coverage and edge cases, then targets gaps in the next round.

### Code Review (v0.2.0)

Asks: "What could be wrong — and can I prove it?" Claude hypothesizes code quality issues (bugs, edge cases, performance, security), generates proof scripts using `prove()`, executes them in the sandbox, and produces evidence-backed findings.

The review-mode loop per round:
1. **Reasoner** — Claude reads the source code and generates 5–10 falsifiable hypotheses
2. **Generator** — Claude turns hypotheses into proof scripts (each hypothesis gets a `prove()` call)
3. **Validator** — Structural checks ensure the proof code is safe for the sandbox
4. **Executor** — Proof scripts run in a permission-restricted child process
5. **Scorer** — 10 metrics evaluate results: confirmation rate, proof success rate, severity/category breakdowns, deduplication
6. **Adapt** — Prior verdicts and scores feed into the next round's reasoner

## Verification Modes

| Mode | What it verifies | Status |
|------|-----------------|--------|
| Test Generation (v0.1.0) | Behavior — "Does this code do what it should?" | Built |
| Code Reviewer (v0.2.0) | Implementation — "Is this code correct and robust?" | Built |
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
# Test mode (v0.1.0) — test all exported functions, 3 rounds
npx tsx src/cli.ts --file path/to/module.ts

# Code review mode (v0.2.0) — hypothesis-driven proof
npx tsx src/cli.ts --file path/to/module.ts --mode review

# More rounds (max 10)
npx tsx src/cli.ts --file path/to/module.ts --mode review --rounds 5

# Focus on specific functions
npx tsx src/cli.ts --file path/to/module.ts --functions "add,subtract,multiply"

# Show generated code
npx tsx src/cli.ts --file path/to/module.ts --mode review --verbose

# Try it with the sample module
npx tsx src/cli.ts --file examples/sample-math.ts --mode review --rounds 3
```

## Toolkit Methods (12)

Both modes share the same IPC-based sandbox toolkit:

| Method | Purpose |
|--------|---------|
| `callFunction(name, args)` | Call exported function with 5s timeout |
| `callFunctionAsync(name, args)` | Async variant |
| `callFunctionMany(name, argSets)` | Batch-call with array of input sets |
| `getExports()` | List exported function names |
| `getSourceCode()` | Read target module source |
| `assertEqual(actual, expected, label)` | Deep equality check |
| `assertThrows(fnName, args, label)` | Expects function to throw |
| `assertCondition(condition, label)` | Boolean check |
| `measureTime(fnName, args, iterations)` | Timing measurement |
| `comparePerformance(name, small, large, n)` | Hardened timing comparison with warm-up and trending detection |
| `prove(hypothesisId, asyncFn)` | Wraps a proof attempt, produces ProofVerdict (review mode) |
| `log(message)` | Send log to parent |

## Scoring

### Test Mode (v0.1.0)
8 metrics + 9 edge case classes: nullish, zero, negative, empty, large numeric, special chars, NaN, boolean, long string.

### Review Mode (v0.2.0)
10 metrics: hypotheses total, confirmed/refuted/inconclusive counts, confirmation rate, proof success rate, severity breakdown, category breakdown, novel findings, inconclusive by failure mode.

Findings are deduplicated across rounds. The final report groups findings into three tiers: confirmed (strong evidence), confirmed (moderate evidence), and inconclusive leads.

## Sandbox Security

Four layers of defense (ported from Agent 004's red team simulator):
1. **Node 22 permission flags** — filesystem and child process access restricted
2. **Global nullification** — dangerous globals (fetch, eval, require, process, timers) deleted before code runs
3. **IPC-only toolkit** — generated code can only call parent-approved methods via message passing
4. **String-level validator** — blocklist of 34+ patterns, structural checks, nesting limits

## Known Limitations

- Target modules with import-time side effects will execute in the parent (no safety net)
- No callback/function argument support (IPC serialization limitation)
- Sync infinite loops in target code cannot be preempted (15s hard timeout kills the round)
- No code coverage instrumentation (deferred to v0.3.0)
- Sandbox validator bypass via property reconstruction — the string-level validator can be bypassed via property access patterns like `obj["constructor"]` to reconstruct blocked builtins. This is by design: the validator catches accidental bad code from the generator, not adversarial obfuscation. The real security boundaries are global nullification (dangerous globals deleted before generated code runs) and Node 22 permission flags. Identified by Codex audit.

## Tech Stack

- **TypeScript** on **Node.js 22+** (permission flags require 22)
- **Vitest** — 81 tests across 9 files
- **Anthropic Claude API** (`claude-sonnet-4-20250514`) via `@anthropic-ai/sdk`
- **dotenv** for environment config

## Tests

```bash
npm test
# 81 tests across 9 files
```

## License

MIT
