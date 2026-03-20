# Agent 005 v0.1.0 Design Spec — Recursive Test Generation (FINAL)

**Date:** 2026-03-20
**Status:** LOCKED — audited by ChatGPT, Gemini, and Grok. Ready to build.
**Purpose:** Complete build specification for v0.1.0. Hand this to Claude Code.

---

## What We're Building

A CLI tool that takes a JavaScript/TypeScript module, recursively generates test cases using Claude, runs them in a sandboxed child process, scores the results, reasons about gaps, and iterates. Each round targets what previous rounds missed.

The sandbox is ported from Agent 004 (Red Team Simulator) — four layers of defense: Node 22 permission flags, global nullification, IPC-only toolkit, and a string-level validator. The child process is logic-only. The parent controls all effects.

---

## Critical Product Boundary (Front and Center)

**Agent 005 sandboxes the GENERATED TEST CODE, not the target module.**

The user's target module runs in the parent process with full Node.js capability. If the target module has import-time side effects (starts a server, writes to disk, connects to a database), those will execute when the parent loads it.

This must appear in:
- The CLI startup banner
- The README (prominently, not as a footnote)
- The --help text

Wording for CLI banner:
```
⚠️  Target module runs in the parent process (not sandboxed).
    Use trusted, local modules only. Pure functions work best.
```

---

## Toolkit API (10 methods)

All methods execute in the parent process via IPC. The child calls them; the parent does the work and returns structured results.

| Method | Purpose | Returns |
|--------|---------|---------|
| `toolkit.callFunction(fnName, args)` | Call an exported function with given arguments | `{ result, error, threwError, errorMessage, timeMs, status }` |
| `toolkit.callFunctionAsync(fnName, args)` | Same but awaits async functions / Promises | `{ result, error, threwError, errorMessage, timeMs, status }` |
| `toolkit.getExports()` | List all exported names from the target module | `string[]` |
| `toolkit.getSourceCode()` | Get the full source code of the target module | `string` |
| `toolkit.assertEqual(actual, expected, label)` | Deep equality assertion (uses `util.isDeepStrictEqual`) | `{ passed, actual, expected, label, status }` |
| `toolkit.assertThrows(fnName, args, label)` | Assert that calling a function throws | `{ passed, threwError, errorMessage, label, status }` |
| `toolkit.assertType(value, expectedType, label)` | Type check assertion | `{ passed, actualType, expectedType, label, status }` |
| `toolkit.assertCondition(condition, label, details?)` | Boolean condition assertion (for non-equality tests) | `{ passed, label, details, status }` |
| `toolkit.measureTime(fnName, args, iterations)` | Run function N times, return timing stats | `{ min, max, avg, median, iterations, status }` |
| `toolkit.log(message)` | Send a log message to the parent | `void` |

### callFunction / callFunctionAsync Behavior

**Mandatory 5-second timeout per call.** Uses `AbortController` or `Promise.race`. If the call times out, returns `{ result: null, error: 'TIMEOUT', threwError: false, errorMessage: 'Function execution exceeded 5000ms', timeMs: 5000, status: 'timeout' }`.

**Sync infinite loop limitation (documented):** A CPU-bound sync infinite loop in target code cannot be interrupted by `Promise.race`. The 5-second timeout works for async functions and most sync functions, but a tight sync loop will block the parent's event loop until the 15-second child process timeout kills the entire round. This is a documented v0.1.0 limitation. Fix in v0.2.0: run target execution in a worker thread.

### assertEqual Implementation

Uses Node.js built-in `util.isDeepStrictEqual` for deep comparison of objects, arrays, Maps, Sets, Dates, etc. (per Gemini's recommendation).

### measureTime Behavior

- Runs `iterations` calls (default 10, max 1000)
- Returns min, max, avg, median in milliseconds
- No warmup runs in v0.1.0
- Results are **advisory** — the reasoner prompt explicitly tells Claude that small timing differences (<1ms) are noise, not signal
- Async functions supported (each iteration awaits the result)

### Intentionally Excluded from v0.1.0

- No `toolkit.sleep(ms)` — not needed for test generation (callFunctionAsync handles async)
- No `toolkit.getExportTypes()` — deriving TypeScript types at runtime is non-trivial. Deferred to v0.2.0.
- No callback/function argument support — serializing functions across IPC is a rabbit hole. Deferred to v0.2.0. If target functions require callbacks, the reasoner notes it as "untestable in v0.1.0."
- No `require()`, `import()`, `fetch()`, `eval()`, `Function()` — sandbox stays locked

---

## Result Shape and Status Classification

Every toolkit method that can fail returns a `status` field. This is the foundation for distinguishing bugs from bad tests.

### Status Values

| Status | Meaning | Counts as |
|--------|---------|-----------|
| `passed` | Assertion passed or function returned successfully | Test passed |
| `failed_assertion` | Assertion did not hold (actual ≠ expected, condition false, etc.) | Possible bug OR bad test expectation |
| `execution_error` | Target function threw an unexpected error | Possible bug OR bad test input |
| `timeout` | Target function exceeded 5-second timeout | Possible infinite loop in target |
| `invalid_test` | Generated test called a non-existent function, passed wrong arg count, etc. | Bad generated test (not a target bug) |

### How the Reporter Uses This

The final report separates results into three buckets:

1. **Confirmed behavior** — tests that passed (target works as expected)
2. **Bug candidates** — `failed_assertion` or `execution_error` results where the test logic looks sound (reasoner evaluates this)
3. **Test quality issues** — `invalid_test` or `timeout` results that indicate the generated test was flawed, not the target

The reasoner sees all three buckets and adjusts its hypotheses accordingly. If Round 1 had many `invalid_test` results, the reasoner knows the generator struggled and should simplify its hypotheses.

---

## Result Serialization Policy

All values crossing IPC (function return values, error objects, assertion arguments) must be serializable to JSON. The parent normalizes non-serializable values before sending to the child.

### Normalization Rules

| Type | Normalized to |
|------|---------------|
| `string`, `number`, `boolean`, `null` | As-is |
| `undefined` | `"[undefined]"` (string marker) |
| Plain objects, arrays | As-is (deep copy) |
| `Date` | ISO string via `.toISOString()` |
| `Map` | `{ __type: "Map", entries: [...] }` |
| `Set` | `{ __type: "Set", values: [...] }` |
| `BigInt` | `{ __type: "BigInt", value: "123n" }` |
| `Symbol` | `{ __type: "Symbol", description: "..." }` |
| `Function` | `{ __type: "Function", name: "fnName" }` |
| Circular objects | `{ __type: "Circular", preview: "..." }` (first 200 chars of JSON.stringify attempt) |
| Class instances | `{ __type: "Instance", className: "...", properties: {...} }` (own enumerable properties) |
| `Error` | `{ __type: "Error", name: "TypeError", message: "...", stack: "..." }` |

The `__type` prefix is a convention — generated test code can check `result.__type === "Map"` to understand what came back.

---

## Async Failure Normalization

All three failure modes produce the same result shape:

| Failure mode | `threwError` | `errorMessage` | `status` |
|-------------|-------------|----------------|----------|
| Sync `throw` | `true` | Error message string | `execution_error` |
| Async rejection (Promise) | `true` | Rejection reason string | `execution_error` |
| Timeout (5s exceeded) | `false` | `"Function execution exceeded 5000ms"` | `timeout` |

The reasoner and scoring function never need to distinguish sync throws from async rejections — they look identical in the result.

---

## Target Code Loading (Parent-Side Module Host)

### How It Works

1. CLI receives `--file path/to/module.ts`
2. Parent resolves the path to absolute
3. If `.ts` file: parent uses the `tsx` loader (already the project's runtime) to import it
4. Parent calls `import(absolutePath)` and captures the module's exports
5. Module exports are stored in memory for the duration of the run
6. `toolkit.callFunction("add", [2, 3])` → parent calls `module.add(2, 3)` → normalizes result → sends via IPC

### What's In Scope for v0.1.0

- ✅ Trusted, local JavaScript and TypeScript modules
- ✅ Modules that export functions (named exports and default export)
- ✅ Modules with dependencies (parent has full Node.js resolution)
- ✅ Modules with native dependencies (parent runs with full capability)

### What's Out of Scope for v0.1.0 (Documented Limitations)

- ❌ Modules with import-time side effects (no safety net — runs in parent)
- ❌ Callback-heavy APIs (toolkit doesn't support function arguments)
- ❌ Class-instance orchestration beyond exported functions
- ❌ Modules that require specific environment variables (document: user should set them before running)
- ❌ State contamination across rounds (module stays loaded; internal state carries over)

### Error Handling on Load

The `import()` call is wrapped in try/catch. If the module fails to load:
- Print clear error message: `"Failed to load target module: <error>"`
- Exit with code 1
- Do not proceed to test generation

### State Contamination (Documented Limitation)

If the target module has internal state (a counter, a cache, a singleton), Round 1's tests mutate that state and Round 2 sees dirty state. The module stays loaded ("hot") in memory across rounds.

For v0.1.0: documented limitation. Advise users to test pure/stateless functions first.
For v0.2.0: explore cache-busting the `import()` or running each round in a fresh worker.

---

## Scoring Function (8 Metrics + Edge Case Detection)

### Metrics

| Metric | How measured | Why it matters |
|--------|-------------|----------------|
| **Tests generated** (count) | Count of toolkit assertion/call invocations | Volume |
| **Tests passed** (count) | Results with `status: 'passed'` | Confirmed behavior |
| **Tests failed** (count) | Results with `status: 'failed_assertion'` | Bug candidates |
| **Errors caught** (count) | Results with `status: 'execution_error'` | Error path coverage |
| **Timeouts** (count) | Results with `status: 'timeout'` | Performance issues |
| **Invalid tests** (count) | Results with `status: 'invalid_test'` | Generator quality |
| **Unique functions tested** (count) | Distinct `fnName` values | Breadth |
| **Functions not tested** (list) | `getExports()` minus functions tested | Gaps for next round |

### Edge Case Detection (Hardcoded Boundary List)

The parent scans all `args` passed to `callFunction` / `callFunctionAsync` / `assertThrows` and flags matches against a predefined boundary list:

| Edge class | Matches |
|------------|---------|
| `nullish` | `null`, `undefined` |
| `zero` | `0`, `0.0`, `-0` |
| `negative` | Any number < 0 |
| `empty` | `""`, `[]`, `{}` |
| `large_numeric` | `Number.MAX_SAFE_INTEGER`, `Number.MAX_VALUE`, `Infinity`, `-Infinity` |
| `long_string` | Any string > 1000 characters |
| `special_chars` | Strings containing `<`, `>`, `"`, `'`, `\`, `\n`, `\0`, or unicode above U+FFFF |
| `boolean` | `true`, `false` (when passed to non-boolean params) |
| `NaN` | `NaN` |
| `type_mismatch` | String passed where number expected (heuristic — based on function name or prior calls) |

Result: `edgeCaseClassesCovered` count (how many of the above classes appeared at least once).

This is a **tagged-input classification metric** (per ChatGPT's framing) — useful for the reasoner, but not presented as rigorous coverage.

---

## Validator Shape (Locked)

Generated code must pass these structural checks:

| Check | Rule |
|-------|------|
| Function signature | Exactly one `async function generatedTests(toolkit)` |
| Max code size | 10KB |
| Max toolkit calls | 20 (count of `toolkit.` references in code) |
| No unbounded loops | Max 3 nesting levels for loops |
| Required return shape | Must return `{ testsRun, testsPassed, testsFailed, results }` |
| Blocklist | Same 34+ patterns from Agent 004 (require, import, process, eval, fetch, etc.) |
| No dangerous globals | Same nullification list from Agent 004 |

Changes from Agent 004:
- Function name: `novelAttack(toolkit)` → `generatedTests(toolkit)`
- Return shape: `{ caught, reason }` → `{ testsRun, testsPassed, testsFailed, results }` where `results` is an array of `{ label, status, details }`

---

## CLI Interface

### Commands

```bash
# Basic usage
npx tsx src/cli.ts --file path/to/module.ts

# Specify functions to test
npx tsx src/cli.ts --file path/to/module.ts --functions "add,subtract,multiply"

# Control rounds (default 3, max 10)
npx tsx src/cli.ts --file path/to/module.ts --rounds 5

# Show generated test code before execution
npx tsx src/cli.ts --file path/to/module.ts --verbose
```

### Flags

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--file <path>` | Yes | — | Path to target .ts or .js module |
| `--functions <names>` | No | all exports | Comma-separated function names to focus on |
| `--rounds <n>` | No | 3 | Number of recursive rounds (hard cap: 10) |
| `--verbose` | No | false | Show generated test code before execution |

### Round Cap

`--rounds` is hard-capped at 10 regardless of user input. If the user passes `--rounds 50`, it silently caps to 10 and prints a note: `"Rounds capped at 10 (maximum for v0.1.0)."` Prevents accidental Claude API bills.

### Module Size Limit

If the target module source exceeds 8000 tokens (~32KB), the CLI warns and truncates for the reasoner prompt:
```
⚠️  Target module is large (47KB). Reasoner will see first 8000 tokens.
    Use --functions to narrow scope for better results.
```

The parent still loads the full module for execution — only the reasoner's view is truncated.

### Startup Banner

```
═══════════════════════════════════════════════════════════
  AGENT 005 — RECURSIVE VERIFIER v0.1.0
  Mode: Test Generation
  Target: src/utils/parser.ts (7 exports)
  Rounds: 3
  ⚠️  Target module runs unsandboxed. Trusted code only.
═══════════════════════════════════════════════════════════
```

---

## Reasoner Prompt Design

### Round 1 Prompt

```
You are analyzing a JavaScript/TypeScript module to generate test hypotheses.

TARGET MODULE SOURCE CODE:
<source>
[full source code, capped at 8000 tokens]
</source>

EXPORTED FUNCTIONS:
[list from getExports()]

YOUR TASK:
Produce 3-8 test hypotheses. Each hypothesis must be falsifiable using ONLY the
available toolkit methods (callFunction, assertEqual, assertThrows, assertCondition,
assertType, measureTime).

For each hypothesis, specify:
1. function — which exported function to test
2. behavior — what specific behavior to verify
3. inputs — exact arguments to pass
4. expected — expected output or behavior
5. rationale — what bug or gap this test would catch

FOCUS ON (in priority order):
1. Happy path — does the function work with normal inputs?
2. Edge cases — empty inputs, zero, null, negative numbers, boundary values
3. Error paths — what inputs should cause errors?
4. Type coercion — what happens with wrong types?

CONSTRAINT: Prefer tests where expected behavior is explicit in the code, type
annotations, naming, thrown errors, or obvious arithmetic/string semantics.
Do NOT invent product requirements. Test what the code actually does.

Return JSON:
{
  "hypotheses": [
    {
      "function": "add",
      "behavior": "handles negative numbers correctly",
      "inputs": [-5, 3],
      "expected": -2,
      "rationale": "Negative numbers are a common edge case for arithmetic"
    }
  ]
}
```

### Round 2+ Prompt

Same as Round 1, plus appended section:

```
PRIOR ROUND RESULTS:
<results>
Round 1 scoring:
- Tests: 8 generated, 6 passed, 1 failed_assertion, 1 execution_error
- Functions tested: add, subtract, multiply, parse (4 of 7)
- Untested: validateInput, handleError, formatOutput
- Edge case classes covered: nullish, zero, empty (3 of 10)
- Bug candidates: parse("") returned undefined instead of throwing

Detailed results:
[structured result array from prior round]
</results>

FOCUS THIS ROUND ON:
- Functions not yet tested (validateInput, handleError, formatOutput)
- Edge case classes not yet covered (negative, large_numeric, special_chars, etc.)
- Investigating bug candidates from prior rounds
- Deeper testing of functions that only had happy-path coverage
- If prior round had many invalid_test results, simplify your hypotheses
```

### Generator Prompt

```
You are generating test code for a JavaScript/TypeScript module.
The code will run in a sandbox with ONLY these toolkit methods:

- toolkit.callFunction(fnName, args) → { result, error, threwError, errorMessage, timeMs, status }
- toolkit.callFunctionAsync(fnName, args) → same shape, for async functions
- toolkit.getExports() → string[]
- toolkit.getSourceCode() → string
- toolkit.assertEqual(actual, expected, label) → { passed, actual, expected, label, status }
- toolkit.assertThrows(fnName, args, label) → { passed, threwError, errorMessage, label, status }
- toolkit.assertType(value, expectedType, label) → { passed, actualType, expectedType, label, status }
- toolkit.assertCondition(condition, label, details?) → { passed, label, details, status }
- toolkit.measureTime(fnName, args, iterations) → { min, max, avg, median, iterations, status }
- toolkit.log(message) → void

HYPOTHESES TO IMPLEMENT:
[hypotheses from reasoner]

Generate a single async function:

async function generatedTests(toolkit) {
  const results = [];

  // For each test, wrap in try/catch so one failure doesn't crash the rest
  try {
    const r = await toolkit.callFunction("add", [2, 3]);
    results.push(await toolkit.assertEqual(r.result, 5, "add(2,3) should equal 5"));
  } catch (e) {
    results.push({ label: "add(2,3) should equal 5", status: "execution_error", details: e.message });
  }

  // ... more tests ...

  const passed = results.filter(r => r.status === "passed").length;
  const failed = results.filter(r => r.status !== "passed").length;

  return {
    testsRun: results.length,
    testsPassed: passed,
    testsFailed: failed,
    results
  };
}

CONSTRAINTS:
- Use ONLY toolkit methods. No require, import, fetch, process, eval.
- Every assertion must have a descriptive label.
- Wrap each test in try/catch (one crash must not abort all tests).
- Return the structured results object.
- For measureTime: small differences (<1ms) are noise, not signal. Only flag >10x differences.
- Handle errors gracefully.
```

---

## Deferred to Future Versions

| Item | Version | Rationale |
|------|---------|-----------|
| Code coverage % (Istanbul/c8) | v0.2.0 | Requires instrumenting target module |
| Mutation testing | v0.3.0 | Requires modifying + re-running target code |
| `getExportTypes()` / type metadata | v0.2.0 | Deriving TS types at runtime is non-trivial |
| Callback / function argument support | v0.2.0 | IPC serialization complexity |
| `toolkit.sleep(ms)` | v0.2.0 | Not needed for test generation |
| State contamination fix | v0.2.0 | Cache-bust import() or fresh worker per round |
| Sync infinite loop preemption | v0.2.0 | Worker thread isolation |
| Report persistence (JSON + HTML) | v0.2.0 | Nice-to-have, not a design blocker |
| `--dir` directory scanning | v0.2.0 | One file at a time for v0.1.0 |
| Auto .env loading from target directory | v0.2.0 | Document limitation for now |
| `--safe-mode` for side-effect protection | v0.2.0 | Requires intercepting imports |
| `--timeout-ms` per-call override | v0.2.0 | 5s default is fine for v0.1.0 |

---

## Build Order (Baby Steps)

These are the steps Claude Code should follow, in order:

1. **Port sandbox from Agent 004** — child-runner.js, executor.ts, validator.ts (already done — copied to repo)
2. **Build toolkit-host.ts** — new verification toolkit with all 10 methods, IPC handlers, 5s timeout, result normalization
3. **Build module-host.ts** — parent-side module loader (import via tsx, export discovery, callFunction dispatch)
4. **Update validator.ts** — new function signature, new return shape, updated structural checks
5. **Build reasoner.ts** — Claude API call with source code + prior results → hypotheses
6. **Build generator.ts** — Claude API call with hypotheses → executable test code
7. **Build scorer.ts** — 8 metrics + edge case detection from toolkit results
8. **Build runner.ts** — recursive loop (reasoner → generator → validator → executor → scorer → next round)
9. **Build cli.ts** — argument parsing, startup banner, streaming output, module size check, round cap
10. **Build reporter.ts** — Claude API call with all rounds → final summary report
11. **Create sample target module** — `examples/sample-math.ts` with add, subtract, divide (for testing)
12. **Write tests** — unit tests for toolkit, validator, scorer; integration test for full loop
13. **End-to-end verification** — run against sample module, verify 3-round recursive loop works
14. **README + AGENTS.md** — document everything, include product boundary warning prominently

---

## File Structure (Expected)

```
agent-005-recursive-verifier/
├── src/
│   ├── cli.ts                    # Entry point, arg parsing, startup banner
│   ├── runner.ts                 # Recursive loop orchestration
│   ├── reasoner.ts               # Claude API: source → hypotheses
│   ├── generator.ts              # Claude API: hypotheses → test code
│   ├── scorer.ts                 # 8 metrics + edge case detection
│   ├── reporter.ts               # Claude API: all rounds → final report
│   ├── module-host.ts            # Parent-side target module loader + dispatcher
│   └── sandbox/
│       ├── child-runner.js       # Ported from Agent 004 (global nullification, IPC)
│       ├── executor.ts           # Ported from Agent 004 (child process lifecycle)
│       ├── toolkit-host.ts       # NEW — verification toolkit IPC handlers
│       └── validator.ts          # Updated from Agent 004 (new signature + return shape)
├── examples/
│   └── sample-math.ts            # Simple target module for testing
├── test/
│   ├── toolkit-host.test.ts
│   ├── module-host.test.ts
│   ├── validator.test.ts
│   ├── scorer.test.ts
│   ├── reasoner.test.ts
│   ├── generator.test.ts
│   └── runner.test.ts
├── package.json
├── tsconfig.json
├── .gitignore
├── .env.example                  # ANTHROPIC_API_KEY
├── AGENTS.md
├── README.md
├── LICENSE                       # MIT
└── AGENT005_PROJECT_CONTEXT.md
```

---

## Audit Trail

| Auditor | Key contributions | Items deferred |
|---------|-------------------|----------------|
| **Gemini** | Result serializability gap, state contamination risk, `util.isDeepStrictEqual` for assertEqual, hardcoded edge case list, `toolkit.sleep(ms)` | sleep (not needed), getReputation/getBondStatus (wrong project), state contamination fix (v0.2.0) |
| **ChatGPT** | Bug vs. bad test classification (sharpest catch), 6 missing decisions (A-F), async failure normalization, trusted-target product boundary, `assertCondition` method, validator shape lock, measureTime noise policy | getExportTypes (v0.2.0), sync loop preemption (v0.2.0), --timeout-ms flag (v0.2.0) |
| **Grok** | Max rounds cap (10), error recovery per round (try/catch per test), output artifact suggestion, module size limit warning | Output artifact (v0.2.0), fresh worker per round (v0.2.0) |

**Consensus across all three:**
- All 5 core decisions approved
- No callbacks for v0.1.0
- Mandatory 5-second per-call timeout
- Heuristic-based edge case detection
- No piped input
- Non-serializable values need normalization policy
