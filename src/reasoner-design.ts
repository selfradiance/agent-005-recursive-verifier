// reasoner-design.ts — Phase 2 of the design adversary pipeline.
//
// Uses Claude to generate a behavioral model (JavaScript code) from the
// NormalizedSpecSummary. The model contains: assumptions, initState, handlers,
// and invariants — all executable in the sandbox.

import type { NormalizedSpecSummary, ChangeJustification, DesignFinding } from "./types.js";
import { extractJson, truncateSpecText } from "./extract-json.js";
import { client } from "./anthropic-client.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReasonerDesignInput {
  specText: string;
  specSummary: NormalizedSpecSummary;
  round: number;
  priorModelCode?: string;
  priorFindings?: DesignFinding[];
  priorChangeLog?: ChangeJustification[];
}

export interface ReasonerDesignOutput {
  modelCode: string;
  changeLog: ChangeJustification[];
  raw: string;
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

function buildModelPrompt(input: ReasonerDesignInput): string {
  const endpointsList = input.specSummary.endpoints
    .map(e => `  ${e.method} ${e.path} — ${e.description}`)
    .join("\n");

  const actorsList = input.specSummary.actors
    .map(a => `  ${a.role}: ${a.permissions.join(", ")}`)
    .join("\n");

  const businessRulesList = input.specSummary.businessRules
    .map(r => `  ${r.id}: ${r.rule}`)
    .join("\n");

  const invariantsList = input.specSummary.invariants
    .map(inv => `  ${inv.id}: ${inv.rule}`)
    .join("\n");

  const unknownsList = input.specSummary.unknowns
    .map(u => `  - ${u.description}`)
    .join("\n");

  const allowedTransitionsList = input.specSummary.allowedTransitions
    .map(t => `  ${t.from} → ${t.to} (trigger: ${t.trigger})`)
    .join("\n");

  const forbiddenTransitionsList = input.specSummary.forbiddenTransitions
    .map(t => `  - ${t.description} (reason: ${t.reason})`)
    .join("\n");

  const safeSpec = truncateSpecText(input.specText);

  return `You are a behavioral model generator for API design verification.

ORIGINAL SPEC:
<spec>
${safeSpec}
</spec>

NORMALIZED SUMMARY:
Endpoints:
${endpointsList}

Actors:
${actorsList}

Business Rules:
${businessRulesList || "  (none identified)"}

Invariants (state properties that must always hold):
${invariantsList}

Allowed Transitions:
${allowedTransitionsList || "  (none identified)"}

Forbidden Transitions:
${forbiddenTransitionsList || "  (none explicitly stated)"}

Unknowns/Ambiguities:
${unknownsList || "  (none identified)"}

YOUR TASK:
Generate a JavaScript behavioral model with these exact top-level variables:

1. \`assumptions\` — array of assumption objects for spec gaps
2. \`initState\` — function that returns the initial state object
3. \`handlers\` — object mapping endpoint keys to handler functions
4. \`invariants\` — array of invariant checker objects

HANDLER FORMAT:
Each handler key should be a string like "POST /v1/identities".
Each handler is a synchronous function: (state, request) => { nextState, response }
- state is a plain object (deep-cloned before each call)
- request is { callerRole, ...body fields }
- response should include a status field (200, 201, 400, 403, 404)
- nextState is the new state after the operation

INVARIANT FORMAT:
Each invariant: { id: "INV1", description: "...", sourceRule: "R1", check: (state) => ({ holds: true/false, violation: "..." }) }

ASSUMPTION FORMAT:
Each assumption: { id: "A1", text: "...", specRef: "section or rule", confidence: "high"|"medium"|"low", kind: "ambiguity"|"inferred_rule", relatedRules: ["R1"] }

CRITICAL RULES:
- Handlers must be SYNCHRONOUS (no async/await)
- Every handler must include an inline comment citing the spec rule it implements (e.g. // R1, // INV3)
- Every assumption must cite the spec section it fills
- Do NOT use import/require/fetch/process or any blocked pattern
- Use simple data structures (arrays, objects) for state
- Generate unique IDs for entities (use a counter in state)

Return ONLY the JavaScript code, no markdown fences, no explanation.
The code should define the four variables at the top level.`;
}

function buildRefinementPrompt(input: ReasonerDesignInput): string {
  const base = buildModelPrompt(input);

  const findingsSummary = (input.priorFindings ?? [])
    .map(f => `  [${f.id}] ${f.category}/${f.severity}: ${f.expectedBehavior} vs ${f.observedBehavior}`)
    .join("\n");

  // Guard: truncate prior model if excessively large (keep last 80K chars which
  // includes the most-refined handlers at the bottom of the file)
  const MAX_MODEL_CHARS = 80_000;
  let priorModel = input.priorModelCode ?? "";
  if (priorModel.length > MAX_MODEL_CHARS) {
    priorModel = "[... model truncated — showing last 80K chars ...]\n" + priorModel.slice(-MAX_MODEL_CHARS);
  }

  return `${base}

PRIOR MODEL CODE (to refine):
<model>
${priorModel}
</model>

FINDINGS FROM PRIOR ROUND:
${findingsSummary || "  (none)"}

INSTRUCTIONS FOR THIS ROUND:
1. Fix any model_defect findings — these are bugs in YOUR model, not the spec
2. Clarify assumptions where ambiguity_risk findings revealed spec gaps
3. Do NOT paper over high_confidence_flaw findings — those are REAL spec issues
4. For each change, include a comment explaining what changed and why

Return the COMPLETE updated model code (not a diff), along with a changeLog.

Return JSON:
{
  "modelCode": "// the full model code...",
  "changeLog": [
    {
      "what": "Fixed handler for POST /v1/bonds",
      "why": "Prior round showed admin could create bonds",
      "specEvidence": "R5: Only the identity holder can create bonds",
      "promptedByAttack": true,
      "classification": "bug_fix"
    }
  ]
}

VALID classification values (use ONLY these):
- "ambiguity_clarification" — resolved a spec ambiguity
- "missing_rule_completion" — added a rule the spec implied but didn't state
- "bug_fix" — fixed a model bug found by attack
- "suspicious_adaptation" — change that might paper over a real flaw
- "defensive_hardening" — added validation/guards for robustness
- "edge_case_handling" — handled an edge case not covered before`;
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

export async function generateDesignModel(input: ReasonerDesignInput): Promise<ReasonerDesignOutput> {
  const isRefinement = input.round > 1 && input.priorModelCode;
  const prompt = isRefinement ? buildRefinementPrompt(input) : buildModelPrompt(input);

  let response;
  try {
    response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 16384,
      messages: [{ role: "user", content: prompt }],
    });
  } catch (err) {
    console.log(`  ⚠️  Claude API error in design reasoner: ${err instanceof Error ? err.message : String(err)}`);
    return { modelCode: "", changeLog: [], raw: "" };
  }

  const raw = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  if (isRefinement) {
    // Parse JSON response with modelCode + changeLog
    const jsonStr = extractJson(raw);
    try {
      const parsed = JSON.parse(jsonStr);
      const validClassifications = new Set([
        "ambiguity_clarification", "missing_rule_completion", "bug_fix",
        "suspicious_adaptation", "defensive_hardening", "edge_case_handling",
      ]);
      const changeLog: ChangeJustification[] = (parsed.changeLog ?? []).map(
        (entry: Record<string, unknown>) => ({
          what: String(entry.what ?? ""),
          why: String(entry.why ?? ""),
          specEvidence: String(entry.specEvidence ?? ""),
          promptedByAttack: Boolean(entry.promptedByAttack),
          classification: validClassifications.has(entry.classification as string)
            ? entry.classification as ChangeJustification["classification"]
            : "bug_fix",
        }),
      );
      return {
        modelCode: parsed.modelCode ?? "",
        changeLog,
        raw,
      };
    } catch {
      // If JSON parse fails, treat the entire response as model code (no changelog)
      console.log("  ⚠️  Refinement response was not valid JSON — treating as raw model code");
      return { modelCode: raw.trim(), changeLog: [], raw };
    }
  } else {
    // Round 1: response is just model code
    let code = raw.trim();
    // Strip markdown fences if present
    if (code.includes("```")) {
      const fenceMatch = code.match(/```(?:javascript|js)?\s*\n?([\s\S]*?)\n?\s*```/);
      if (fenceMatch) {
        code = fenceMatch[1].trim();
      }
    }
    return { modelCode: code, changeLog: [], raw };
  }
}
