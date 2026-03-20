# Agent 005: Recursive Verifier — Project Context

**Last updated:** 2026-03-20 (Session 1)
**Status:** Pre-build — idea selection complete, repo not yet initialized
**Owner:** James Toole
**Planned repo:** https://github.com/selfradiance/agent-005-recursive-verifier
**Local folder:** ~/Desktop/projects/agent-005-recursive-verifier
**Skill level:** Beginner — James has no prior coding experience. He directs AI coding agents (Claude Code) to build the project. Explain everything simply. Take baby steps.

---

## What This Is

Agent 005 is a recursive verification framework. It extracts the recursive sandbox architecture from Agent 004 (Red Team Simulator) and repurposes it for constructive verification — generating executable proof about code quality and design correctness, not opinions.

The core loop: reason → generate JavaScript code → execute in sandbox → measure outcome → iterate.

The sandbox is the engine. The verification modes are the applications.

---

## How It Relates to AgentGate and Agent 004

Agent 004 built the recursive sandbox to red-team AgentGate. The sandbox has four layers of defense: Node 22 permission flags, global nullification, IPC-only toolkit, and a string-level validator. The child process is logic-only (no network, no filesystem, no DOM). The parent controls all effects. This architecture survived 130 tests, triple audits, and four stages of development.

Agent 005 reuses this sandbox for construction instead of destruction. Unlike Agents 001–004, Agent 005 does **not** require AgentGate to run. It is a standalone tool. However, it can be pointed at AgentGate's codebase as a verification target — a satisfying loop where the tool born from AgentGate's red team now verifies AgentGate itself.

---

## The Three Stages

### v0.1.0 — Recursive Test Generation

You give it a module or function. Claude analyzes the code, generates test cases as executable JavaScript, runs them in the sandbox, checks coverage and edge cases, then reasons about what's still untested. Each round targets gaps from the previous round.

**Scoring function:** Test compilation (binary), code coverage (%), edge cases exercised (count), error paths hit (count), mutation testing survival rate.

**Why it's first:** Tightest scoring function of any idea. Lowest ambiguity. Fastest path to proving the framework works.

### v0.2.0 — Recursive Code Reviewer

You point it at code. Claude hypothesizes quality issues (bugs, performance, security, edge cases), then generates JavaScript proof scripts that verify each hypothesis in the sandbox. Produces concrete evidence — failing inputs, timing data, counterexamples — not opinions.

**Scoring function:** Hypotheses confirmed vs. refuted (ratio), bugs proven with counterexamples (count), performance regressions detected (measurable).

**Scoping constraint:** Initially targets only provable hypotheses — failing edge cases, exception paths, regex misbehavior, performance regressions, property violations. Fuzzy "code quality" judgments stay out until the proof engine is solid.

### v0.3.0 — API Design Adversary (The Flagship)

You feed it an API specification. The agent attacks the *design*, not a live API. Claude generates a JavaScript simulation of the API's behavior model, runs adversarial request sequences against it in the sandbox, and checks for invariant violations, unauthorized access paths, and state inconsistencies.

**Scoring function:** Invariant violations (count), unauthorized access paths (count), state inconsistencies (count) — all binary, all measurable.

**Article hook:** "Agent 004 caught bugs in my code. Agent 005 caught bugs in my thinking."

---

## The Narrative Arc

| Stage | What it verifies | Direction |
|-------|-----------------|-----------|
| v0.1.0 — Test Generation | Behavior | "Does this code do what it should?" |
| v0.2.0 — Code Reviewer | Implementation | "Is this code correct and robust?" |
| v0.3.0 — API Design Adversary | Design | "Is this design sound before I build it?" |

Progression: **verify behavior → verify implementation → verify design**. Concrete to abstract, post-hoc to pre-hoc.

---

## Tech Stack (Expected)

Identical to Agent 004 — the sandbox is a direct port.

- **Language:** TypeScript
- **Runtime:** Node.js 22+ (permission flags require 22)
- **Testing:** Vitest
- **LLM:** Anthropic Claude API (claude-sonnet-4-20250514) via @anthropic-ai/sdk
- **Sandbox:** Node child process with permission flags + global nullification + IPC toolkit + validator
- **Config:** dotenv
- **Coding tool:** Claude Code

---

## Key Files

*To be populated as files are created.*

| File | Purpose |
|------|---------|
| AGENT005_PROJECT_BRIEF.md | Idea selection audit document — how we chose these three stages |
| AGENT005_PROJECT_CONTEXT.md | This file — living project context for all sessions |
| (future) src/sandbox/ | Ported from Agent 004 — child runner, executor, toolkit host, validator |
| (future) src/cli.ts | Entry point |
| (future) src/reasoner.ts | Claude API — analyzes prior results, produces hypotheses |
| (future) src/generator.ts | Claude API — turns hypotheses into executable JS |
| (future) AGENTS.md | Conventions for AI coding agents |
| (future) README.md | Public-facing documentation |
| (future) LICENSE | MIT License |

---

## Architecture (Expected)

```
┌─────────────────────────────────┐
│  CLI (src/cli.ts)               │  ← Entry point, --mode flag selects verification type
├─────────────────────────────────┤
│  Runner (src/runner.ts)         │  ← Orchestrates the recursive loop per mode
├─────────────────────────────────┤
│  Reasoner (src/reasoner.ts)     │  ← Claude API: analyzes results, produces hypotheses
├─────────────────────────────────┤
│  Generator (src/generator.ts)   │  ← Claude API: turns hypotheses into executable JS
├─────────────────────────────────┤
│  Validator (src/sandbox/        │  ← Blocklist + structural checks + novelty gate
│           validator.ts)         │
├─────────────────────────────────┤
│  Executor (src/sandbox/         │  ← Spawns permission-restricted child, manages lifecycle
│           executor.ts)          │
├─────────────────────────────────┤
│  Child Runner (src/sandbox/     │  ← Global nullification, IPC toolkit, executes generated JS
│               child-runner.js)  │
├─────────────────────────────────┤
│  Claude API (external)          │  ← Reasoning + code generation
└─────────────────────────────────┘
```

---

## Future Work (Separate Repo)

**Incentive Wargame (Agent 006 candidate):** Simulate multi-agent economies — define rules for an incentive system, define player archetypes, generate strategy code, run N rounds in sandbox, measure hard metrics (Gini coefficient, abuse rate, system collapse). All three auditors ranked this as the strongest outside-the-box idea. Different enough from verification to warrant its own repo and identity.

---

## Completed Milestones

1. ✅ Session 1: Idea selection process — three rounds of external audits (Gemini, ChatGPT, Grok) plus internal analysis. ~15 raw candidates filtered to 6 finalists, then ranked by three auditors. Consensus: Test Generation → Code Reviewer → API Design Adversary as the three stages. Content Optimization and Contract Exploit Finder cut. Incentive Wargame deferred to separate repo. Project brief written (AGENT005_PROJECT_BRIEF.md). Project context created (this file). Folder created at ~/Desktop/projects/agent-005-recursive-verifier.

---

## Known Issues / Tech Debt

*None yet — project has not started building.*

---

## Idea Selection Audit Trail

| Round | Auditors | Purpose | Key outcome |
|-------|----------|---------|-------------|
| 1 | Gemini, ChatGPT, Grok (independent) | Brainstorm outside-the-box ideas | ~15 raw candidates, filtered by sandbox-essential constraint |
| 2 | Claude (Session 1) | Evaluate all candidates, add 3 new ideas | Top 6 finalists selected, audit document written |
| 3 | Gemini, ChatGPT, Grok (structured audit) | Rank 6 finalists, recommend build order, identify cuts | Consensus: API Adversary is flagship, Content Opt cut, single repo with stages |
| 4 | Claude (Session 1) | Synthesize all three audits, resolve disagreements | Final brief produced. Test Generation leads v0.1.0. |

---

## Important Notes for Future Claude Sessions

- James has zero prior coding experience and directs AI agents to write all code
- Always take baby steps and explain terminal commands simply — always specify what folder to be in before giving a terminal command
- The project folder is at ~/Desktop/projects/agent-005-recursive-verifier
- Claude Code is the primary coding tool — James pastes instructions into Claude Code
- Claude Code edits files locally — James must run git push separately to update GitHub
- The GitHub repo will be "agent-005-recursive-verifier" under the "selfradiance" account
- All projects live under ~/Desktop/projects/ — never reference ~/Desktop/<project> directly
- James also keeps ChatGPT and Gemini updated with the latest markdown file as backup collaborators
- At the end of every session, always update both the project context file and README.md before the final commit
- .env will contain ANTHROPIC_API_KEY — never commit .env
- The sandbox code should be ported from Agent 004 (~/Desktop/projects/agent-004-red-team/src/sandbox/) — do not rewrite from scratch
- Agent 005 does NOT require AgentGate to run — it is standalone
- When working across multiple projects in one session, update ALL relevant project context files before ending
