# Agent 005: Recursive Verifier

A recursive verification framework that generates executable proof about code and design — not opinions. It uses the Claude API to reason about code, generate JavaScript verification scripts, execute them in a sandboxed child process, score the outcomes, and iterate. Three modes, same engine: reason → generate → execute → score → repeat.

## Why This Exists

Traditional code review is opinion-based — a reviewer reads code and says "this looks fine" or "I think this might break." Agent 005 replaces opinions with executable proof. Instead of guessing whether code handles edge cases, it generates test inputs and runs them. Instead of guessing whether a hypothesis about a bug is correct, it writes a proof script and executes it.

The recursive loop means each round learns from the previous one — gaps identified in round 1 become targets in round 2.

## How It Relates to AgentGate

This project reuses the four-layer sandbox architecture from [Agent 004 (Red Team Simulator)](https://github.com/selfradiance/agentgate-red-team-simulator) but repurposes it for constructive verification instead of adversarial attack. It's the same sandbox that survived 100+ adversarial tests, now turned toward something productive.

[AgentGate](https://github.com/selfradiance/agentgate) is the broader ecosystem substrate.

## Three Verification Modes

| Mode | What it does | Input |
|------|-------------|-------|
| **Test** | Generates and runs test cases against a target module | `--file module.ts` |
| **Review** | Generates falsifiable code quality hypotheses and proves/disproves them with executable scripts | `--mode review --file module.ts` |
| **Design** | Takes a Markdown spec, generates behavioral attack scripts to find logic holes before you build | `--mode design --spec spec.md` |

## What's Implemented

- Recursive loop: reason → generate → validate → execute → score (configurable rounds, max 10)
- Four-layer sandbox: Node 22 permission flags, global nullification, IPC-only toolkit, string-level validator (34+ patterns)
- Module host with dedicated child runtime and idle shutdown timer
- Mode-specific reasoners, generators, scorers, and reporters
- Claude API integration for all reasoning and generation steps
- 8 metrics + 9 edge case classes (test mode)
- IPC result serialization handling NaN, Infinity, BigInt, Symbol

## Quick Start

```bash
cd ~/Desktop/projects/agent-005-recursive-verifier
cp .env.example .env  # add ANTHROPIC_API_KEY
npm install

# Test mode — run verification against a module
npx tsx src/cli.ts --file path/to/module.ts --rounds 3

# Review mode — code quality proof
npx tsx src/cli.ts --mode review --file path/to/module.ts --rounds 3

# Design mode — break a spec before building
npx tsx src/cli.ts --mode design --spec path/to/spec.md --rounds 3
```

## Scope / Non-Goals

- Verification only — no code modification
- JavaScript sandbox only — generated scripts are JS, not TypeScript
- Single-module target — no multi-file project analysis
- No AgentGate bond integration in v0.3.0 (standalone verification tool)

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

Complete — v0.3.0 shipped (three verification modes). 149 tests.

## License

MIT
