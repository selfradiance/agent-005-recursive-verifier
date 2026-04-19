# Agent 005: Recursive Verifier

Give it a spec before you build. Agent 005 takes an endpoint-based API spec, turns it into an executable behavioral model, attacks that model in a sandbox, and tells you what it found: likely design flaws, ambiguity risks, and coverage gaps.

v0.3.0's flagship public path is design mode.

## Start Here

```bash
cd ~/Desktop/projects/agent-005-recursive-verifier
cp .env.example .env  # add ANTHROPIC_API_KEY
npm install
```

Then start with one of the built-in design-mode examples:

```bash
# Flawed spec — should surface stronger design findings
npx tsx src/cli.ts --mode design --spec examples/sample-api-spec-flawed.md --rounds 3

# Ambiguous spec — should surface ambiguity risks and assumption-heavy findings
npx tsx src/cli.ts --mode design --spec examples/sample-api-spec-ambiguous.md --rounds 3
```

What you should expect to see:

- `sample-api-spec-flawed.md` should push the report toward higher-confidence design problems such as authorization gaps, state inconsistencies, or critical/high findings.
- `sample-api-spec-ambiguous.md` should push the report toward ambiguity-heavy output: low-confidence assumptions, underspecified behavior, and clarification targets.
- Both runs should end with an `API DESIGN ADVERSARY REPORT` summarizing findings, attribution, and coverage across endpoints, roles, transitions, invariants, and rejection paths.

## Flagship Use Case

Design mode is the sharpest entry point for Agent 005 in v0.3.0:

1. Read a markdown/text API spec.
2. Extract endpoints, actors, rules, invariants, transitions, and unknowns.
3. Generate a behavioral model in JavaScript.
4. Generate adversarial request sequences against that model.
5. Report what broke, what stayed ambiguous, and how much of the design surface was exercised.

It does not hit a live API. It attacks the design before implementation exists.

## Scope

Current v0.3.0 scope is intentionally narrow:

- Audits endpoint-based API specs written in markdown or plain text
- Works best when the spec names concrete endpoints, actors, rules, and invariants
- Uses generated JavaScript models and attack sequences inside the sandbox

What it is not:

- Not a general protocol auditor
- Not a whole-system architecture auditor
- Not a live API scanner
- Not a code-modification tool

## Other Modes

Agent 005 still includes two secondary verification paths on the same recursive engine:

- **Test** — generates and runs test cases against a target module: `--file module.ts`
- **Review** — generates falsifiable code-quality hypotheses and proves/disproves them with executable scripts: `--mode review --file module.ts`

Those modes remain available, but design mode is the clearest public "start here" story in v0.3.0.

## Why This Exists

Traditional review is often opinion-based — someone reads code or a spec and says "this looks fine" or "this might break." Agent 005 is built to replace that with executable evidence. Instead of guessing whether an API design is sound, it builds a behavior model, runs adversarial sequences, and scores the outcome.

The recursive loop means each round learns from the previous one: gaps identified in round 1 become targets in round 2.

## What's Implemented

- Recursive loop: reason → generate → validate → execute → score (configurable rounds, max 10)
- Four-layer sandbox: Node 22 permission flags, global nullification, IPC-only toolkit, string-level validator (34+ patterns)
- Design-mode pipeline: spec extraction → behavioral model generation → adversarial attack generation → report
- Mode-specific reasoners, generators, scorers, and reporters
- Claude API integration for all reasoning and generation steps
- Module host with dedicated child runtime and idle shutdown timer for test/review modes
- IPC result serialization handling NaN, Infinity, BigInt, Symbol

## Design Mode Command

```bash
npx tsx src/cli.ts --mode design --spec path/to/spec.md --rounds 3
```

Helpful examples:

```bash
# Intentional flaws
npx tsx src/cli.ts --mode design --spec examples/sample-api-spec-flawed.md

# Intentional ambiguity
npx tsx src/cli.ts --mode design --spec examples/sample-api-spec-ambiguous.md

# More balanced sample
npx tsx src/cli.ts --mode design --spec examples/sample-api-spec.md
```

## How It Relates to AgentGate

This project reuses the four-layer sandbox architecture from [Agent 004 (Red Team Simulator)](https://github.com/selfradiance/agentgate-red-team-simulator) but repurposes it for constructive verification instead of adversarial attack. It is standalone in v0.3.0 and does not require AgentGate to run.

[AgentGate](https://github.com/selfradiance/agentgate) is the broader ecosystem substrate.

## Tests

149 tests across 13 files.

```bash
npm test
```

## Related Projects

- [AgentGate](https://github.com/selfradiance/agentgate) — the core execution engine
- [Agent 004: Red Team Simulator](https://github.com/selfradiance/agentgate-red-team-simulator) — shares the sandbox architecture (adversarial use)
- [Agent 006: Incentive Wargame](https://github.com/selfradiance/agentgate-incentive-wargame) — stress-tests economic rules

## Status

Complete — v0.3.0 shipped. Public flagship path: pre-build API spec auditing via design mode.

## License

MIT
