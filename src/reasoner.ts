// reasoner.ts — Claude API: analyzes target module source code and prior
// round results to produce test hypotheses for the generator.

import Anthropic from "@anthropic-ai/sdk";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Hypothesis {
  function: string;
  behavior: string;
  inputs: unknown[];
  expected: unknown;
  rationale: string;
}

export interface ReasonerInput {
  sourceCode: string;
  exports: string[];
  focusFunctions?: string[];
  round: number;
  priorResults?: string; // formatted scoring summary from previous round
}

export interface ReasonerOutput {
  hypotheses: Hypothesis[];
  raw: string; // raw Claude response for debugging
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

function buildRound1Prompt(input: ReasonerInput): string {
  const functionList = (input.focusFunctions && input.focusFunctions.length > 0)
    ? input.focusFunctions.join(", ")
    : input.exports.join(", ");

  return `You are analyzing a JavaScript/TypeScript module to generate test hypotheses.

TARGET MODULE SOURCE CODE:
<source>
${input.sourceCode}
</source>

EXPORTED FUNCTIONS:
${functionList}

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

Return JSON only, no markdown fences:
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
}`;
}

function buildRound2PlusPrompt(input: ReasonerInput): string {
  const base = buildRound1Prompt(input);

  return `${base}

PRIOR ROUND RESULTS:
<results>
${input.priorResults}
</results>

FOCUS THIS ROUND ON:
- Functions not yet tested
- Edge case classes not yet covered (nullish, zero, negative, empty, large_numeric, special_chars, NaN, type_mismatch, boolean, long_string)
- Investigating bug candidates from prior rounds
- Deeper testing of functions that only had happy-path coverage
- If prior round had many invalid_test results, simplify your hypotheses`;
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

const client = new Anthropic();

export async function generateHypotheses(input: ReasonerInput): Promise<ReasonerOutput> {
  const prompt = input.round === 1
    ? buildRound1Prompt(input)
    : buildRound2PlusPrompt(input);

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  });

  const raw = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  // Parse JSON from response — handle possible markdown fences
  let jsonStr = raw.trim();
  if (jsonStr.startsWith("```")) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  let hypotheses: Hypothesis[];
  try {
    const parsed = JSON.parse(jsonStr);
    hypotheses = parsed.hypotheses ?? [];
  } catch {
    // If JSON parsing fails, return empty hypotheses with the raw response
    hypotheses = [];
  }

  return { hypotheses, raw };
}
