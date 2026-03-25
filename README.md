# Agent 005: Recursive Verifier

A recursive verification framework that generates executable proof — not opinions — about code quality, design correctness, and system resilience.

> **⚠️ Important: Target modules run in the parent process (not sandboxed).** Only the generated test code runs in the sandbox. Use trusted, local modules only. Pure functions work best.

## How It Works

Three modes, same engine: **reason → generate JavaScript code → execute in sandbox → measure outcome → iterate.**

### Test Generation (v0.1.0)

Asks: "What inputs haven't been tested?" Generates test cases, runs them, scores coverage and edge cases, then targets gaps in the next round.

### Code Review (v0.2.0)

Asks: "What could be wrong — and can I prove it?" Claude hypothesizes code quality issues (bugs, edge cases, performance, security), generates proof scripts using `prove()`, executes them in the sandbox, and produces evidence-backed findings.

### API Design Adversary (v0.3.0)

Asks: "Is this API design sound before I build it?" Takes an API spec (markdown, text, or structured) and attacks it to find flaws before any code is written.

The three-phase pipeline:
1. **Spec Extraction** — Claude parses the raw spec into a normalized summary: endpoints, actors, resources, state variables, business rules, invariants, allowed/forbidden transitions, and unknowns
2. **Behavioral Model Generation** — Claude generates executable JavaScript that simulates the API: state machine, handlers for every endpoint, invariant checkers, and explicit assumptions about spec gaps
3. **Adversarial Attack Generation** — Claude generates attack sequences that probe for authorization bypass, state corruption, boundary violations, ordering dependencies, and assumption weaknesses

Each round refines the model based on findings, then generates new attacks targeting uncovered surface area. The model's change log tracks every modification with classification (`bug_fix`, `suspicious_adaptation`, `ambiguity_clarification`, etc.) to detect when the model papers over real flaws.

**What it finds:**
- Authorization bypass — requests allowed when they should be rejected
- Invariant violations — state corruption through sequences of valid calls
- Spec ambiguities — gaps where the spec doesn't define behavior
- Model defects — bugs in the behavioral model (not the spec)
- Attack defects — invalid attack sequences that don't exercise real paths

Findings are classified into five attribution categories and scored by severity (`critical`/`high`/`medium`/`low`/`informational`). Coverage tracks endpoints, roles, transitions, invariants, and rejection paths exercised.

## Verification Modes

| Mode | What it verifies | Status |
|------|-----------------|--------|
| Test Generation (v0.1.0) | Behavior — "Does this code do what it should?" | Built |
| Code Reviewer (v0.2.0) | Implementation — "Is this code correct and robust?" | Built |
| API Design Adversary (v0.3.0) | Design — "Is this design sound before I build it?" | Built |

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

# API design adversary (v0.3.0) — attack an API spec
npx tsx src/cli.ts --mode design --spec path/to/api-spec.md

# Design mode with more rounds
npx tsx src/cli.ts --mode design --spec path/to/api-spec.md --rounds 5

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

Test and review modes share the same IPC-based sandbox toolkit:

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

## Design API Methods (v0.3.0)

Design mode uses a separate API for attack sequences:

| Method | Purpose |
|--------|---------|
| `api.reset()` | Reset model to initial state |
| `api.request(endpoint, body)` | Call a handler (e.g. `"POST /v1/users"`) |
| `api.expectRejected(response, reason)` | Assert request was denied |
| `api.expectAllowed(response, reason)` | Assert request succeeded |
| `api.assertInvariant(invariantId)` | Check a specific invariant holds |
| `api.annotate(text)` | Add a note to the trace |
| `api.finish()` | Collect and return all results |

## Scoring

### Test Mode (v0.1.0)
8 metrics + 9 edge case classes: nullish, zero, negative, empty, large numeric, special chars, NaN, boolean, long string.

### Review Mode (v0.2.0)
10 metrics: hypotheses total, confirmed/refuted/inconclusive counts, confirmation rate, proof success rate, severity breakdown, category breakdown, novel findings, inconclusive by failure mode.

Findings are deduplicated across rounds. The final report groups findings into three tiers: confirmed (strong evidence), confirmed (moderate evidence), and inconclusive leads.

### Design Mode (v0.3.0)
Per-round scoring: invariant violations, unauthorized access paths, state inconsistencies, spec ambiguities surfaced, unique findings, five-category attribution breakdown. Coverage tracks endpoints, roles, transitions, invariants, and rejection paths as cumulative set unions across rounds.

## Sandbox Security

Four layers of defense (ported from Agent 004's red team simulator):
1. **Node 22 permission flags** — filesystem and child process access restricted
2. **Global nullification** — dangerous globals (fetch, eval, require, process, timers, SharedArrayBuffer, Atomics) deleted before code runs
3. **IPC-only toolkit** — generated code can only call parent-approved methods via message passing
4. **String-level validator** — blocklist of 34+ patterns, structural checks, nesting limits

## Known Limitations

- Target modules with import-time side effects will execute in the parent (no safety net)
- No callback/function argument support (IPC serialization limitation)
- Sync infinite loops in target code cannot be preempted (15s hard timeout kills the round)
- No code coverage instrumentation
- Sandbox validator bypass via property reconstruction — the string-level validator can be bypassed via property access patterns like `obj["constructor"]` to reconstruct blocked builtins. This is by design: the validator catches accidental bad code from the generator, not adversarial obfuscation. The real security boundaries are global nullification and Node 22 permission flags. Identified by Codex audit.
- **Patch drift risk** — Model refinement across rounds is tracked via justification records, but this mitigates drift rather than eliminates it. Human review of the change log is recommended for high-stakes specs.
- **Fidelity check is structural not semantic** — The fidelity checker verifies that handlers and invariant checks exist by string matching, not that they correctly implement the spec. Human review of the generated model is still required.
- **Severity is assisted classification not authoritative** — Finding severity is a triage heuristic based on structural signals, not a definitive security assessment. Business impact depends on context the tool cannot evaluate.

## Tech Stack

- **TypeScript** on **Node.js 22+** (permission flags require 22)
- **Vitest** — 149 tests across 13 files
- **Anthropic Claude API** (`claude-sonnet-4-20250514`) via `@anthropic-ai/sdk`
- **dotenv** for environment config

## Tests

```bash
npm test
# 149 tests across 13 files
```

## License

MIT
