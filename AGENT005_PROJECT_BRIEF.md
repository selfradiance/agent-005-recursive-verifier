# Agent 005: Recursive Verification Framework — Project Brief

**Date:** 2026-03-20
**Owner:** James Toole
**Status:** Pre-build — idea selection complete, ready to scaffold
**Planned repo:** ~/Desktop/projects/agent-005-recursive-framework
**GitHub:** github.com/selfradiance/agent-005-recursive-framework

---

## Executive Summary

Agent 005 extracts the recursive sandbox architecture from Agent 004 (Red Team Simulator) and repurposes it for constructive verification. The same four-layer defense system that survived 130 tests and triple audits in an adversarial context now powers a framework that generates executable proof — not opinions — about code quality, design correctness, and system resilience.

The sandbox is the engine. The modes are the applications.

---

## Origin Story

Agent 004 built a recursive sandbox to red-team AgentGate: Claude reasons about defenses, generates novel JavaScript attack code, executes it in a permission-restricted child process via IPC, measures the outcome, and iterates. Four layers of defense (Node 22 permission flags, global nullification, IPC-only toolkit, string-level validator) make this safe. The architecture shipped across four stages and was audited by three independent AI auditors plus eight rounds of Claude Code audit per stage.

The realization: the interesting part isn't the red-teaming. It's the recursive loop itself — reason → generate code → sandbox execute → measure → iterate. That loop is a general-purpose engine. Agent 005 points it at construction instead of destruction.

---

## The Core Constraint

**The sandbox must be essential, not decorative.**

If an idea works just as well as a multi-turn Claude conversation without executing any code, it doesn't belong here. The sandbox earns its place when generated code produces measurable outcomes that Claude alone cannot compute. This constraint was the primary filter throughout the idea selection process and eliminated several candidates.

---

## Idea Selection Process

### Round 1: External brainstorm
Three AI auditors (Gemini, ChatGPT, Grok) were asked independently for "outside the box" ideas that fit the recursive sandbox pattern. This produced ~15 raw candidates across all three auditors.

### Round 2: Sandbox-essential filter
Each candidate was evaluated against the core constraint. Ideas where the "evaluation" was really just Claude judging text quality were eliminated (Synthetic Audience, Dream Architect, Myth Engine, Aesthetic Director, Meme Evolution). Ideas where the sandbox couldn't physically do the work were eliminated (Meme Evolution — no DOM/canvas in the child process).

### Round 3: Top 6 selection
Three practical ideas and three outside-the-box ideas survived the filter. These were written up as a structured audit document.

### Round 4: External ranking
All three auditors ranked the six finalists, recommended build order, identified cuts, and proposed staging strategy.

### Consensus results

**Unanimous agreements across all three auditors:**
- API Design Adversary is the strongest flagship idea
- Incentive Wargame is the strongest outside-the-box idea
- Content Optimization should be cut (sandbox not essential)
- Single repo with staged versions (like Agent 004's v0.1.0 → v0.4.0)

**Key disagreement:**
- v0.1.0: Gemini and Grok said Code Reviewer. ChatGPT said Test Generation.
- Resolution: ChatGPT's argument was strongest — Test Generation has a tighter scoring function (coverage, mutation survival, edge case discovery are all binary/numeric), lower scope creep risk, and forces the framework to prove itself with hard metrics before expanding into the fuzzier territory of code review.

**Cut decisions:**
- Content Optimization: cut (all three agreed — sandbox is decorative)
- Contract Exploit Finder: deferred (ChatGPT's argument: the hard part is contract-to-logic conversion, not the recursive loop)
- Test Generation vs. Code Reviewer ordering: resolved in favor of Test Generation first

---

## The Three Stages

### v0.1.0 — Recursive Test Generation

**What it does:** You give it a module or function. Claude analyzes the code's behavior, generates test cases as executable JavaScript, runs them in the sandbox, checks coverage and edge cases, then reasons about what's still untested. Each round gets smarter about boundary conditions, error paths, and interaction effects.

**The recursive loop:**
1. Reasoner analyzes the target code and prior test results
2. Generator produces new test functions as JavaScript
3. Sandbox executes the tests, captures pass/fail/error/coverage
4. Reasoner identifies gaps — uncovered branches, untested edge cases, surviving mutants
5. Next round targets those specific gaps

**Scoring function:** Concrete and measurable.
- Did the tests compile and run? (binary)
- Code coverage percentage (numeric)
- Edge cases exercised (count)
- Error paths hit (count)
- Mutation testing: generate mutants of the original code, check if the tests catch them (survival rate)

**Why the sandbox is essential:** Tests must actually execute to be useful. The sandbox runs them, captures real outcomes, and the reasoner uses those outcomes to guide the next generation. Without execution, you're just generating test code that might not even compile.

**Why it's first:** Tightest scoring function of any idea on the list. Lowest ambiguity. Fastest path to proving the framework works. If the recursive loop can drive test coverage from 40% to 90% across rounds, Agent 005 is real.

**Article angle:** "I let an AI write tests for my code until it couldn't find anything else to break."

---

### v0.2.0 — Recursive Code Reviewer

**What it does:** You point it at a codebase or paste in a file. Claude analyzes the code, hypothesizes quality issues (bugs, performance problems, security gaps, edge case failures), then generates JavaScript proof scripts that run in the sandbox to verify each hypothesis. Did that function actually handle the null case? Does that regex match the edge case Claude suspects it misses? Is that loop O(n²) when given 10,000 inputs?

**The recursive loop:**
1. Reasoner forms hypotheses about potential issues in the target code
2. Generator writes proof-of-concept scripts — not opinions, executable demonstrations
3. Sandbox runs the proofs, produces concrete evidence (failing inputs, timing data, counterexamples)
4. Reasoner distinguishes confirmed findings from refuted hypotheses
5. Next round generates deeper hypotheses based on what was confirmed

**Scoring function:** Concrete.
- Hypotheses confirmed vs. refuted (ratio)
- Bugs proven with executable counterexamples (count)
- Performance regressions detected with timing data (measurable)
- Edge cases proven to fail (count)

**Why the sandbox is essential:** The difference between "Claude thinks this might be a bug" and "here's executable proof it fails on this input" is the difference between a suggestion and a finding. The sandbox turns code review from opinion into evidence.

**Why it's second:** Builds naturally on v0.1.0's test generation infrastructure. Same engine, broader reasoning layer. The narrative escalation: "It not only writes tests, it forms hypotheses about your code and proves or disproves them."

**Scoping constraint (from ChatGPT's audit):** v0.2.0 should initially target only provable hypotheses — failing edge cases, exception paths, regex misbehavior, simple performance regressions, property violations. Fuzzy "code quality" judgments stay out until the proof engine is solid.

**Article angle:** "Most AI code review is a chatbot guessing. This one writes proof."

---

### v0.3.0 — API Design Adversary

**What it does:** You feed it an API specification — OpenAPI spec, GraphQL schema, or a plain description of endpoints and expected behavior. The agent doesn't attack a live API. It attacks the design. Claude reads the spec, hypothesizes design flaws, then generates a JavaScript simulation of the API's behavior model. The sandbox runs simulated request sequences against that model — not real HTTP, but executable logic representing how the API should behave. It checks: does this sequence produce unauthorized data access? Does this ordering of calls create an inconsistent state? Does this combination of valid inputs produce an invalid output?

**The recursive loop:**
1. Reasoner reads the spec and hypothesizes a design flaw
2. Generator builds an executable behavior model of the API in JavaScript
3. Generator writes adversarial request sequences as test scripts
4. Sandbox runs the sequences against the model, checks for invariant violations
5. Reasoner analyzes results — proposes spec amendments for confirmed flaws, generates harder attacks for the next round

**Scoring function:** Concrete and binary.
- Invariant violations found (count)
- Unauthorized access paths discovered (count)
- State inconsistencies triggered (count)
- Contradictions between endpoints (count)

**Why the sandbox is essential:** The API behavior model is executable JavaScript. The attack sequences are executable test scripts. The invariant checks produce binary pass/fail results. All of this must run to produce results — Claude cannot simulate multi-step request sequences with state in its head.

**Why it's the flagship:** This is the cleanest sequel to Agent 004. Same red-team DNA, new target, shifted left. Agent 004 attacked AgentGate after it was built. Agent 005 attacks your API before it exists. Every engineer who has ever shipped a broken API will feel this.

**Article hook (from Gemini):** "Agent 004 caught bugs in my code. Agent 005 caught bugs in my thinking."

---

## The Narrative Arc

The three stages form a coherent trilogy:

| Stage | What it verifies | Direction |
|-------|-----------------|-----------|
| v0.1.0 — Test Generation | Behavior | "Does this code do what it should?" |
| v0.2.0 — Code Reviewer | Implementation | "Is this code correct and robust?" |
| v0.3.0 — API Design Adversary | Design | "Is this design sound before I build it?" |

This progression — **verify behavior → verify implementation → verify design** — moves from concrete to abstract, from post-hoc to pre-hoc, from testing what exists to attacking what's planned. Each stage builds on the previous one's infrastructure while expanding the scope of what "recursive verification" means.

---

## Future Work (Separate Repo)

### Incentive Wargame (Agent 006 candidate)

All three auditors ranked this as the strongest outside-the-box idea. It simulates multi-agent economies: define rules for an incentive system (referral program, moderation policy, voting mechanism), define player archetypes (power user, griefer, min-maxer, honest actor), generate strategy code for each, run N rounds in the sandbox, measure hard metrics (Gini coefficient, abuse rate, system collapse point).

**Why separate repo:** It's a fundamentally different category — simulation and economic modeling, not code/design verification. Mixing it into Agent 005 would muddy the framework identity. It deserves its own article, its own framing, and its own architecture decisions around state management and multi-agent coordination.

**Sandbox fit:** Perfect. Strategies are code, simulations are code, metrics are code. Everything measurable. This is the strongest sandbox-essential idea outside the verification family.

---

## Cut List (With Reasoning)

| Idea | Decision | Why |
|------|----------|-----|
| Content Optimization | Cut | Sandbox is decorative. Readability scores and structural metrics can be approximated by Claude in a prompt. All three auditors agreed. |
| Contract Exploit Finder | Deferred | The hard part is translating contract language into formal logic, not the recursive loop. Once formalized, it's a variant of Incentive Wargame anyway. |
| Dream Architect | Cut | "Emotional intensity" isn't measurable by JS. Sandbox runs a trivial state machine while Claude does all real evaluation via prompt. |
| Meme Evolution | Cut | Child process has no DOM/canvas. Doesn't work within sandbox constraints. |
| Myth/Story Engine | Cut | Narrative quality is Claude-as-judge, not code-as-measurer. No sandbox justification. |
| Aesthetic Director | Cut | Same problem as Myth Engine — evaluation is text judgment, not executable measurement. |
| Synthetic Audience | Cut | Multi-turn prompting dressed up as sandbox usage. |
| Ritual Designer | Deferred | Surprisingly viable scoring, but niche audience and lower priority. |
| Negotiation Simulator | Deferred | Good concept, but sandbox may be unnecessary — negotiation is text generation. |
| Puzzle God | Deferred | Technically sound sandbox use, but niche audience (puzzle/game designers). |

---

## Auditor Contributions Worth Preserving

### New ideas from auditors (not in original six)
- **Recursive Forensic Agent** (Gemini): Feed it logs + bug report, it hypothesizes root cause, generates replay simulation, runs in sandbox until it reproduces the error. Technically sound, developer audience. Could be a v0.4.0 or separate project.
- **Recursive Data Pipeline Verifier** (ChatGPT): Property-based testing of data transforms (ETL, parsers, pricing logic). Close enough to Test Generation to be a mode within v0.1.0 rather than a separate stage.

### Best framing lines
- "Agent 004 caught bugs in my code. Agent 005 caught bugs in my thinking." — Gemini
- "Verify behavior → verify implementation → verify design" — ChatGPT
- "It not only writes tests, it forms hypotheses and proves or disproves them." — ChatGPT
- "Moving from Adversarial Testing to Recursive Synthesis" — Gemini

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

## Relationship to AgentGate

Agent 005 does **not** require AgentGate to run. Unlike Agents 001–004, which all called AgentGate's API for bond/execute/resolve lifecycle, Agent 005 is a standalone tool. The sandbox architecture originated in Agent 004's AgentGate integration, but the extracted framework has no AgentGate dependency.

However, Agent 005 can be *pointed at* AgentGate's codebase as a verification target — generating tests for AgentGate's code (v0.1.0), reviewing AgentGate's implementation (v0.2.0), or adversarially testing AgentGate's API design (v0.3.0). This creates a satisfying loop: the tool born from AgentGate's red team now verifies AgentGate itself.

---

## Open Questions

1. **CLI interface:** Single entry point with `--mode test-gen | code-review | api-adversary`, or separate commands? Agent 004 used flags (`--static`, `--recursive`, `--team`). Same pattern likely works here.
2. **Input format for v0.3.0:** OpenAPI spec? GraphQL schema? Plain markdown description? All three? The behavior model generator needs to handle at least one well before expanding.
3. **AgentGate bonding:** Should Agent 005 optionally bond its work through AgentGate? This would make it Agent 005 in the series (not just a standalone tool) and demonstrate that the bond model works for constructive agents, not just adversarial ones. Decision deferred to implementation.
4. **Article cadence:** One article per stage, or one article covering the full trilogy? Agent 004 shipped all four stages before its article. Same pattern may work here.

---

## Audit Trail

| Round | Auditors | Purpose | Key outcome |
|-------|----------|---------|-------------|
| 1 | Gemini, ChatGPT, Grok (independent) | Brainstorm outside-the-box ideas | ~15 raw candidates, filtered to 6 by sandbox-essential constraint |
| 2 | Claude (this session) | Evaluate all candidates, add 3 new ideas | Top 6 finalists selected, audit document written |
| 3 | Gemini, ChatGPT, Grok (structured audit) | Rank 6 finalists, recommend build order, identify cuts | Consensus: API Adversary is flagship, Content Opt is cut, single repo with stages |
| 4 | Claude (this session) | Synthesize all three audits, resolve disagreements | Final brief produced. Test Generation leads v0.1.0 (ChatGPT's scoping argument). |

---

## Decision Framework Used

This project follows the process template: ideas are audited by multiple independent AI collaborators, consensus is identified, disagreements are resolved by evaluating the strength of each argument (not by majority vote), and the final decision is documented with reasoning.

The selection optimized for: sandbox necessity, scoring function concreteness, article potential, Agent 004 sequel narrative, and framework proof speed. It did not optimize for: broadest audience (Contract Exploit Finder would have won), most exciting demo (Incentive Wargame would have won), or fastest build (Code Reviewer would have won).

The chosen path — Test Generation → Code Reviewer → API Design Adversary — is the path that best proves the framework is real, then expands its scope, then delivers the flagship.
