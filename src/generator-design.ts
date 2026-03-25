// generator-design.ts — Phase 3 of the design adversary pipeline.
//
// Uses Claude to generate adversarial attack sequences that exercise the
// behavioral model, trying to find invariant violations, unauthorized access,
// state inconsistencies, and spec ambiguities.

import Anthropic from "@anthropic-ai/sdk";
import type { NormalizedSpecSummary, DesignFinding, Assumption, CoverageVector } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GeneratorDesignInput {
  specText: string;
  specSummary: NormalizedSpecSummary;
  modelCode: string;
  assumptions: Assumption[];
  round: number;
  priorFindings?: DesignFinding[];
  priorCoverage?: CoverageVector;
}

export interface GeneratorDesignOutput {
  attackCode: string;
  raw: string;
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

function buildAttackPrompt(input: GeneratorDesignInput): string {
  const endpointsList = input.specSummary.endpoints
    .map(e => `  ${e.method} ${e.path} — ${e.description}`)
    .join("\n");

  const businessRulesList = input.specSummary.businessRules
    .map(r => `  ${r.id}: ${r.rule}`)
    .join("\n");

  const invariantsList = input.specSummary.invariants
    .map(inv => `  ${inv.id}: ${inv.rule}`)
    .join("\n");

  const assumptionsList = input.assumptions
    .map(a => `  [${a.id}] (${a.kind}, ${a.confidence}): ${a.text}`)
    .join("\n");

  const allowedTransitionsList = input.specSummary.allowedTransitions
    .map(t => `  ${t.from} → ${t.to} (trigger: ${t.trigger})`)
    .join("\n");

  const forbiddenList = input.specSummary.forbiddenTransitions
    .map(t => `  - ${t.description} (reason: ${t.reason})`)
    .join("\n");

  return `You are an adversarial API tester. Your goal is to find flaws in an API design by
executing attack sequences against a behavioral model.

SPEC SUMMARY:
Endpoints:
${endpointsList}

Business Rules:
${businessRulesList || "  (none identified)"}

Invariants (state properties):
${invariantsList}

Allowed transitions:
${allowedTransitionsList || "  (none identified)"}

Forbidden transitions:
${forbiddenList || "  (none explicitly stated)"}

Model assumptions (gaps the model filled):
${assumptionsList || "  (none)"}

THE API HELPER OBJECT:
You will write a function \`adversarialSequence(api)\` that uses these methods:

- api.reset() — reset to initial state (MUST call first)
- api.request(endpoint, body) — call a handler, e.g. api.request("POST /v1/identities", { callerRole: "admin", publicKey: "key1", role: "holder" })
- api.expectRejected(response, reason) — assert response was rejected (status >= 400 or error)
- api.expectAllowed(response, reason) — assert response was allowed (no error)
- api.assertInvariant(invariantId) — check a specific invariant holds
- api.annotate(text) — add a note to the trace
- api.finish() — collect and return all results (MUST call last)

YOUR TASK:
Write 3-5 attack sequences within a single \`adversarialSequence\` function.
Each sequence should:
1. Call api.reset() to start fresh
2. Set up the necessary preconditions (create identities, bonds, etc.)
3. Attempt the attack
4. Use expectRejected/expectAllowed to verify behavior
5. Use assertInvariant to check invariants after the attack

ATTACK CATEGORIES TO EXPLORE:
1. Authorization bypass — can a wrong role do something forbidden?
2. State corruption — can the invariants be violated through a sequence of valid calls?
3. Boundary violations — what about zero amounts, negative numbers, missing fields?
4. Race conditions / ordering — does the order of operations matter?
5. Assumption probing — test the assumptions the model made about spec gaps

CRITICAL RULES:
- Call api.reset() before each sequence
- Call api.finish() at the very end (once, not after each sequence)
- Do NOT access model internals (model.handlers, model.invariants, etc.)
- Use api.request with the endpoint string format "METHOD /path"
- Include callerRole in every request body
- Use api.annotate() to explain what each attack is trying to do
- Keep each sequence focused on one attack vector

Return ONLY the JavaScript code. No markdown fences, no explanation.
The code must define: async function adversarialSequence(api) { ... }`;
}

function buildRound2PlusPrompt(input: GeneratorDesignInput): string {
  const base = buildAttackPrompt(input);

  const findingsSummary = (input.priorFindings ?? [])
    .map(f => `  [${f.id}] ${f.category}/${f.severity}: ${f.observedBehavior}`)
    .join("\n");

  const coverageSummary = input.priorCoverage
    ? `  Endpoints: ${input.priorCoverage.endpointsExercised}/${input.priorCoverage.endpointsTotal}
  Roles: ${input.priorCoverage.rolesExercised}/${input.priorCoverage.rolesTotal}
  Transitions: ${input.priorCoverage.transitionsExercised}/${input.priorCoverage.transitionsTotal}
  Invariants: ${input.priorCoverage.invariantsExercised}/${input.priorCoverage.invariantsTotal}
  Rejection paths: ${input.priorCoverage.rejectionPathsExercised}/${input.priorCoverage.rejectionPathsTotal}`
    : "  (no coverage data)";

  return `${base}

PRIOR FINDINGS:
${findingsSummary || "  (none yet)"}

COVERAGE SO FAR:
${coverageSummary}

FOCUS THIS ROUND ON:
- Endpoints/roles/transitions NOT yet exercised
- Deeper probing of prior findings — can you escalate them?
- Multi-step attacks that chain together operations
- Testing assumption boundaries the model declared
- Do NOT repeat attacks that already found the same finding`;
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

const client = new Anthropic();

export async function generateAttackCode(input: GeneratorDesignInput): Promise<GeneratorDesignOutput> {
  const prompt = input.round === 1
    ? buildAttackPrompt(input)
    : buildRound2PlusPrompt(input);

  let response;
  try {
    response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 8192,
      messages: [{ role: "user", content: prompt }],
    });
  } catch (err) {
    console.log(`  ⚠️  Claude API error in attack generator: ${err instanceof Error ? err.message : String(err)}`);
    return { attackCode: "", raw: "" };
  }

  const raw = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  let code = raw.trim();
  // Strip markdown fences if present
  if (code.includes("```")) {
    const fenceMatch = code.match(/```(?:javascript|js)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (fenceMatch) {
      code = fenceMatch[1].trim();
    }
  }

  return { attackCode: code, raw };
}
