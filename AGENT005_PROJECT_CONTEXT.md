# Agent 005 Project Context

## Session Date
- 2026-03-25

## Summary
- Hardened sandbox execution against constructor-based escape paths, including obfuscated access via built-in functions.
- Enforced runtime toolkit call budgets in the sandbox instead of relying only on static string counting.
- Reworked `ModuleHost` to execute target exports in a dedicated full-privilege child runtime so synchronous CPU-bound functions can be timed out safely.
- Fixed design-mode transition coverage so exercised state transitions are actually counted from request traces.
- Fixed review-mode finding deduplication so duplicate confirmations no longer re-enter the aggregate findings list.
- Tightened declared Node engine support to `>=22.0.0` to match runtime requirements.

## v0.3.0 Milestones
1. **Build complete** — Three-phase API Design Adversary pipeline: spec extraction → behavioral model generation → adversarial attack generation, with sandbox execution and five-category attribution.
2. **Smoke test** — End-to-end design mode exercised against sample API spec.
3. **8-round Claude Code audit** — Types & schemas, sandbox & designApi security, validator & structural checks, extractor & reasoner prompts, generator & attack quality, scorer & attribution logic, reporter & documentation, dependencies & supply chain. 40+ findings identified and fixed across all rounds.
4. **Codex cold-eyes audit** — Independent review by OpenAI Codex confirming sandbox security boundaries, identifying validator bypass pattern (documented in known limitations).
5. **Claude Code cross-audit** — Full codebase security and code quality review. Consolidated 9 duplicate Anthropic client instances, added depth limits to recursive operations, fixed fence stripping and JSON extraction inconsistencies, hardened sandbox global deletion, replaced eval-based assumption extraction with JSON.parse.
6. **Test count: 149** — 149 tests across 13 files, all passing.

## Files Added
- `src/normalize.ts`
- `src/module-host-runtime.mjs`
- `src/anthropic-client.ts`
- `src/extract-json.ts`
- `src/extractor-design.ts`
- `src/reasoner-design.ts`
- `src/generator-design.ts`
- `src/scorer-design.ts`
- `src/reporter-design.ts` (in `src/sandbox/`)
- `examples/sample-blocking.ts`

## Verification
- `npm test` passing: 149 tests across 13 files.
- Verified `origin/main` was already up to date after the fix set.

## Known Limitations
1. **Patch drift risk** — Model refinement across rounds is tracked via `ChangeJustification` records with classification (`bug_fix`, `suspicious_adaptation`, etc.), but this mitigates drift rather than eliminating it. A model could still paper over real flaws if the LLM generates a `bug_fix` classification for what is actually a `suspicious_adaptation`. Human review of the change log is recommended for high-stakes specs.
2. **Fidelity check is structural not semantic** — The fidelity checker (`checkFidelity`) verifies that every spec endpoint has a handler and every invariant has a corresponding check by searching for string matches in the model code. It does not verify that the handler logic correctly implements the spec rule. Semantic fidelity requires human review of the generated model.
3. **Severity is assisted classification not authoritative** — Finding severity (`critical`, `high`, `medium`, `low`, `informational`) is computed by `categorizeSeverity` based on structural signals (auth bypass, invariant failure count, expectAllowed failure). This is a useful triage heuristic, not a definitive security assessment. The actual business impact of a finding depends on context that the tool cannot evaluate.

## Notes
- `ModuleHost` now uses an idle shutdown timer for its helper runtime to avoid leaving extra child processes around after tests and CLI runs.
- Added regression coverage for timeout recovery, constructor hardening, runtime call caps, invalid `comparePerformance` usage, transition coverage, and review deduplication.
- All dependencies pinned to exact versions (no caret ranges) as of the supply chain audit.
- Shared `anthropic-client.ts` ensures a single Anthropic SDK instance across all 9 modules that call the Claude API.
