// generator-review.ts — Review-mode generator: turns hypotheses into executable
// proof scripts that run in the sandbox to confirm or refute each claim.
//
// Separate from generator.ts (test mode). Called by the runner when --mode review.

import type { Hypothesis } from "./types.js";
import { client } from "./anthropic-client.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReviewGeneratorOutput {
  code: string | null;
  raw: string;
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

function buildGeneratorPrompt(hypotheses: Hypothesis[], sourceCode: string): string {
  const hypothesesJson = JSON.stringify(hypotheses, null, 2);

  return `You are a proof script generator. You turn hypotheses into executable JavaScript code
that runs in a sandbox to confirm or refute each claim.

TARGET MODULE SOURCE CODE:
<source>
${sourceCode}
</source>

TOOLKIT API (12 methods available on the toolkit object):

Core function calls:
- toolkit.callFunction(fnName, args) → { result, error, threwError, errorMessage, timeMs, status }
- toolkit.callFunctionAsync(fnName, args) → same shape, for async functions
- toolkit.callFunctionMany(fnName, argSets) → [{ index, args, ok, result?, error? }, ...]
- toolkit.getExports() → string[]
- toolkit.getSourceCode() → string
- toolkit.measureTime(fnName, args, iterations) → { min, max, avg, median, iterations, status }
- toolkit.log(message) → void

Proof orchestration:
- toolkit.prove(hypothesisId, asyncFn) → wraps proof attempt, returns ProofVerdict

Assertion helpers (for use inside prove() callbacks):
- toolkit.assertEqual(actual, expected, label) → { passed, actual, expected, label, status }
- toolkit.assertThrows(fnName, args, label) → { passed, threwError, errorMessage, label, status }
- toolkit.assertCondition(condition, label, details?) → { passed, label, details, status }

Performance comparison:
- toolkit.comparePerformance(fnName, smallArgs, largeArgs, iterations) → { smallMedianMs, largeMedianMs, ratio, trending }

IMPORTANT — IPC SERIALIZATION:
The sandbox serializes NaN as { __type: "NaN" }, Infinity as { __type: "Infinity" },
and undefined as { __type: "undefined" } for IPC transport. When checking for these
values, compare against the serialized form (e.g., result.__type === "NaN"), not the
JavaScript primitive (e.g., Number.isNaN(result) will return false).

HYPOTHESES TO IMPLEMENT:
${hypothesesJson}

EXAMPLE 1 — Bug proof:
async function generatedProofs(toolkit) {
  await toolkit.prove("H1", async () => {
    const result = await toolkit.callFunction("divide", [1, 0]);
    if (result.result && result.result.__type === "Infinity") {
      return { confirmed: true, evidence: "divide(1, 0) returns Infinity — no error thrown for division by zero" };
    }
    return { confirmed: false, evidence: "divide(1, 0) handled zero correctly: " + JSON.stringify(result.result) };
  });
}

EXAMPLE 2 — Performance proof with comparePerformance:
async function generatedProofs(toolkit) {
  await toolkit.prove("H5", async () => {
    const small = await toolkit.comparePerformance("isPrime", [97], [104729], 50);
    const large = await toolkit.comparePerformance("isPrime", [104729], [15485863], 50);
    if (small.trending && large.trending) {
      return { confirmed: true, evidence: "isPrime shows superlinear growth: ratio " + small.ratio.toFixed(1) + "x at small, " + large.ratio.toFixed(1) + "x at large" };
    }
    return { confirmed: false, evidence: "isPrime timing is proportional — no performance issue detected" };
  });
}

CONSTRAINTS:
- Output must be exactly one async function generatedProofs(toolkit) { ... }
- No preamble, no markdown fences, no explanation — ONLY the function code
- Every hypothesis must get its own toolkit.prove() call with the matching hypothesis ID
- Use assert helpers inside prove() for quick checks
- Every prove callback must return { confirmed: true/false, evidence: "..." }
- Evidence strings should be concise and descriptive
- For performance hypotheses: use comparePerformance with at least 2 size pairs, only confirm if both show trending
- Use ONLY toolkit methods. No require, import, fetch, process, eval.
- Return ONLY the function code, nothing else.`;
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

export async function generateProofCode(
  hypotheses: Hypothesis[],
  sourceCode: string,
): Promise<ReviewGeneratorOutput> {
  const prompt = buildGeneratorPrompt(hypotheses, sourceCode);

  let response;
  try {
    response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    });
  } catch (err) {
    console.log(`  ⚠️  Claude API error in review generator: ${err instanceof Error ? err.message : String(err)}`);
    return { code: null, raw: "" };
  }

  const raw = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  return { code: stripFences(raw), raw };
}

// ---------------------------------------------------------------------------
// Fence stripping (exported for testing)
// ---------------------------------------------------------------------------

export function stripFences(raw: string): string {
  let code = raw.trim();
  if (code.includes("```")) {
    const fenceMatch = code.match(/```(?:javascript|js|typescript|ts|json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (fenceMatch) {
      code = fenceMatch[1].trim();
    }
  }
  return code;
}
