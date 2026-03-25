// reasoner-review.ts — Review-mode reasoner: generates falsifiable hypotheses
// about code quality issues (bugs, edge cases, performance, security).
//
// Separate from reasoner.ts (test mode). Called by the runner when --mode review.

import type { Hypothesis, ProofVerdict } from "./types.js";
import { client } from "./anthropic-client.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReviewReasonerInput {
  sourceCode: string;
  exports: string[];
  round: number;
  priorVerdicts?: ProofVerdict[];
  priorScores?: string;
}

export interface ReviewReasonerOutput {
  hypotheses: Hypothesis[];
  raw: string;
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

const NAN_INSTRUCTION = `IMPORTANT — IPC SERIALIZATION:
The sandbox serializes NaN as { __type: "NaN" }, Infinity as { __type: "Infinity" },
and undefined as { __type: "undefined" } for IPC transport. When checking for these
values, compare against the serialized form (e.g., result.__type === "NaN"), not the
JavaScript primitive (e.g., Number.isNaN(result) will return false).`;

function buildSystemPrompt(): string {
  return `You are a code reviewer that generates falsifiable hypotheses about code quality issues.

Your hypotheses must be provable or disprovable by running code in a sandbox. Every hypothesis
needs a concrete proof strategy — not an opinion, but a runnable test.

SEVERITY RULES:
- critical: crash, hang, security break, severe correctness failure in common path
- high: wrong results or dangerous failure on realistic inputs
- medium: edge case or degraded performance
- low: narrow or cosmetic robustness issue

SECURITY SCOPE — only these categories are in scope:
- Regex DoS / catastrophic backtracking (provable: measure execution time on crafted input)
- Unsafe parsing assumptions (provable: pass malformed input, observe crash or wrong result)
- Missing input validation that produces concrete counterexamples (provable: demonstrate the bad output)
- Unsafe object/property handling if directly triggerable (provable: show the exploit path)
Security hypotheses must be provable inside the sandbox. Never claim "this is vulnerable to X"
without a runnable proof that demonstrates the vulnerability using only toolkit methods.
Out of scope: network security, package/dependency security, auth/authz that can't be tested locally.

${NAN_INSTRUCTION}

OUTPUT FORMAT:
Return a JSON object with a "hypotheses" array. No markdown fences, no preamble, no explanation.
Each hypothesis must have these fields:
- id: string (e.g., "H1", "H2")
- category: "bug" | "edge_case" | "performance" | "security" | "property_violation"
- target: "function:<name>", "interaction:<name1>,<name2>", or "module"
- claim: plain English statement of what might be wrong
- severity: "critical" | "high" | "medium" | "low"
- expected_signal_type: "value" | "throw" | "timeout" | "ratio" | "invariant_break" | "nondeterminism"
- requires_fresh_state: boolean
- proof_strategy: brief description of how to verify

Generate 5–10 hypotheses per round.`;
}

function buildRound1Prompt(input: ReviewReasonerInput): string {
  return `TARGET MODULE SOURCE CODE:
<source>
${input.sourceCode}
</source>

EXPORTED FUNCTIONS:
${input.exports.join(", ")}

ROUND 1 — BROAD SCAN:
Read the code carefully. Identify the most likely issues across all categories:
- Obvious bugs and missing error handling
- Edge cases around boundary values, division by zero, empty inputs, type coercion surprises
- Performance concerns (superlinear algorithms, unnecessary work)
- Security issues within scope (regex DoS, unsafe parsing, missing validation)
- Property violations (e.g., commutativity, idempotency, monotonicity where expected)

Prioritize hypotheses that are most likely to be confirmed with concrete evidence.`;
}

function buildRound2PlusPrompt(input: ReviewReasonerInput): string {
  const verdictSummary = (input.priorVerdicts ?? []).map((v) => {
    let line = `  ${v.hypothesisId}: ${v.verdict}`;
    if (v.evidence) line += ` — ${v.evidence.slice(0, 200)}`;
    if (v.failureMode) line += ` [${v.failureMode}]`;
    return line;
  }).join("\n");

  return `TARGET MODULE SOURCE CODE:
<source>
${input.sourceCode}
</source>

EXPORTED FUNCTIONS:
${input.exports.join(", ")}

PRIOR VERDICTS:
${verdictSummary || "(none)"}

${input.priorScores ? `PRIOR SCORES:\n${input.priorScores}\n` : ""}
ROUND ${input.round} — ADAPTIVE:
Based on prior results, adjust your strategy:
- High confirmed count in a category → go deeper in that category
- Many refutations → shift strategy, stop guessing in that direction
- Inconclusive with bad_proof → same hypothesis, better proof strategy
- Inconclusive with target_timeout → hypothesis about performance or infinite loop
- Inconclusive with measurement_noise → try larger input sizes or more iterations
- Always prioritize novel hypotheses over re-testing confirmed ones
- Do NOT duplicate hypotheses that were already confirmed — explore new territory`;
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

export async function generateReviewHypotheses(
  input: ReviewReasonerInput,
): Promise<ReviewReasonerOutput> {
  const userPrompt = input.round === 1
    ? buildRound1Prompt(input)
    : buildRound2PlusPrompt(input);

  let response;
  try {
    response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: buildSystemPrompt(),
      messages: [{ role: "user", content: userPrompt }],
    });
  } catch (err) {
    console.log(`  ⚠️  Claude API error in review reasoner: ${err instanceof Error ? err.message : String(err)}`);
    return { hypotheses: [], raw: "" };
  }

  const raw = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  return { hypotheses: parseHypotheses(raw), raw };
}

// ---------------------------------------------------------------------------
// JSON parsing (exported for testing)
// ---------------------------------------------------------------------------

export function parseHypotheses(raw: string): Hypothesis[] {
  let jsonStr = raw.trim();

  // Strip markdown fences
  if (jsonStr.includes("```")) {
    const fenceMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (fenceMatch) {
      jsonStr = fenceMatch[1];
    }
  }

  // Extract JSON object if surrounded by text
  if (!jsonStr.startsWith("{") && !jsonStr.startsWith("[")) {
    const jsonStart = jsonStr.indexOf("{");
    const jsonEnd = jsonStr.lastIndexOf("}");
    if (jsonStart !== -1 && jsonEnd !== -1) {
      jsonStr = jsonStr.slice(jsonStart, jsonEnd + 1);
    }
  }

  try {
    const parsed = JSON.parse(jsonStr);
    const hypotheses: Hypothesis[] = parsed.hypotheses ?? (Array.isArray(parsed) ? parsed : []);
    return hypotheses;
  } catch (err) {
    console.log(`  ⚠️  Failed to parse review reasoner response: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}
