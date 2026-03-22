// generator.ts — Claude API: takes test hypotheses from the reasoner and
// generates executable test code for the sandbox.

import Anthropic from "@anthropic-ai/sdk";
import type { Hypothesis } from "./reasoner.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GeneratorOutput {
  code: string;
  raw: string; // raw Claude response for debugging
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

function buildGeneratorPrompt(hypotheses: Hypothesis[]): string {
  const hypothesesJson = JSON.stringify(hypotheses, null, 2);

  return `You are generating test code for a JavaScript/TypeScript module.
The code will run in a sandbox with ONLY these toolkit methods:

- toolkit.callFunction(fnName, args) → { result, error, threwError, errorMessage, timeMs, status }
- toolkit.callFunctionAsync(fnName, args) → same shape, for async functions
- toolkit.getExports() → string[]
- toolkit.getSourceCode() → string
- toolkit.assertEqual(actual, expected, label) → { passed, actual, expected, label, status }
- toolkit.assertThrows(fnName, args, label) → { passed, threwError, errorMessage, label, status }
- toolkit.assertCondition(condition, label, details?) → { passed, label, details, status }
- toolkit.measureTime(fnName, args, iterations) → { min, max, avg, median, iterations, status }
- toolkit.log(message) → void

HYPOTHESES TO IMPLEMENT:
${hypothesesJson}

Generate a single async function. Return ONLY the code, no markdown fences:

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

IMPORTANT — IPC SERIALIZATION:
The sandbox serializes NaN as { __type: "NaN" }, Infinity as { __type: "Infinity" },
and undefined as { __type: "undefined" } for IPC transport. When checking for these
values, compare against the serialized form (e.g., result.__type === "NaN"), not the
JavaScript primitive (e.g., Number.isNaN(result) will return false).

CONSTRAINTS:
- Use ONLY toolkit methods. No require, import, fetch, process, eval.
- Every assertion must have a descriptive label.
- Wrap each test in try/catch (one crash must not abort all tests).
- Return the structured results object.
- For measureTime: small differences (<1ms) are noise, not signal. Only flag >10x differences.
- Handle errors gracefully.
- Return ONLY the function code, nothing else.`;
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

const client = new Anthropic();

export async function generateTestCode(hypotheses: Hypothesis[]): Promise<GeneratorOutput> {
  const prompt = buildGeneratorPrompt(hypotheses);

  let response;
  try {
    response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    });
  } catch (err) {
    console.log(`  ⚠️  Claude API error in generator: ${err instanceof Error ? err.message : String(err)}`);
    return { code: "", raw: "" };
  }

  const raw = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  // Strip markdown fences if present
  let code = raw.trim();
  if (code.startsWith("```")) {
    code = code.replace(/^```(?:javascript|js|typescript|ts)?\n?/, "").replace(/\n?```$/, "");
  }

  return { code, raw };
}
