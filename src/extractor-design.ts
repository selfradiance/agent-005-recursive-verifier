// extractor-design.ts — Phase 1 of the design adversary pipeline.
//
// Uses Claude to parse a raw API spec (markdown, text, etc.) into a
// NormalizedSpecSummary — a structured representation of endpoints, roles,
// resources, invariants, state variables, and transitions.

import Anthropic from "@anthropic-ai/sdk";
import type { NormalizedSpecSummary } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExtractorInput {
  specText: string;
}

export interface ExtractorOutput {
  summary: NormalizedSpecSummary;
  raw: string;
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

function buildExtractionPrompt(specText: string): string {
  return `You are a precise API specification analyzer. Parse the following API specification into a structured summary.

API SPECIFICATION:
<spec>
${specText}
</spec>

YOUR TASK:
Extract a normalized summary with these fields:

1. endpoints — all API endpoints with path, HTTP method, and description
2. actors — all roles/actors with their permissions
3. resources — all domain objects/resources mentioned
4. stateVariables — all state that can change (e.g., "bond.usedAmount", "identity.status")
5. invariants — all stated invariants or business rules that must always hold
6. allowedTransitions — valid state transitions (from → to, with trigger)
7. forbiddenTransitions — explicitly prohibited state transitions with reasons
8. unknowns — ambiguities, missing information, or underspecified behaviors

RULES:
- Extract ONLY what is explicitly stated or clearly implied by the spec
- For unknowns, capture anything the spec leaves ambiguous or undefined
- Keep descriptions concise but precise
- Use the exact endpoint paths from the spec
- Assign unique IDs to invariants (e.g., "INV1", "INV2")

Return JSON only, no markdown fences:
{
  "endpoints": [{ "path": "/v1/example", "method": "POST", "description": "..." }],
  "actors": [{ "role": "admin", "permissions": ["create_identity", "suspend_identity"] }],
  "resources": [{ "name": "identity", "description": "..." }],
  "stateVariables": [{ "name": "identity.status", "description": "active or suspended" }],
  "invariants": [{ "id": "INV1", "rule": "..." }],
  "allowedTransitions": [{ "from": "active", "to": "suspended", "trigger": "admin suspends identity" }],
  "forbiddenTransitions": [{ "description": "...", "reason": "..." }],
  "unknowns": [{ "description": "..." }]
}`;
}

// ---------------------------------------------------------------------------
// JSON parsing helper (shared with reasoner pattern)
// ---------------------------------------------------------------------------

function extractJson(raw: string): string {
  let jsonStr = raw.trim();

  // Strip markdown fences
  if (jsonStr.includes("```")) {
    const fenceMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (fenceMatch) {
      jsonStr = fenceMatch[1];
    }
  }

  // Extract JSON object if surrounded by text
  if (!jsonStr.startsWith("{")) {
    const jsonStart = jsonStr.indexOf("{");
    const jsonEnd = jsonStr.lastIndexOf("}");
    if (jsonStart !== -1 && jsonEnd !== -1) {
      jsonStr = jsonStr.slice(jsonStart, jsonEnd + 1);
    }
  }

  // Sanitize non-standard values
  jsonStr = jsonStr
    .replace(/([:,\[]\s*)NaN\b/g, '$1"NaN"')
    .replace(/([:,\[]\s*)Infinity\b/g, '$1"Infinity"')
    .replace(/([:,\[]\s*)-Infinity\b/g, '$1"-Infinity"')
    .replace(/([:,\[]\s*)undefined\b/g, '$1null');

  return jsonStr;
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

const client = new Anthropic();

export async function extractSpec(input: ExtractorInput): Promise<ExtractorOutput> {
  const prompt = buildExtractionPrompt(input.specText);

  let response;
  try {
    response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 8192,
      messages: [{ role: "user", content: prompt }],
    });
  } catch (err) {
    console.log(`  ⚠️  Claude API error in extractor: ${err instanceof Error ? err.message : String(err)}`);
    return { summary: emptySpec(), raw: "" };
  }

  const raw = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  const jsonStr = extractJson(raw);

  try {
    const parsed = JSON.parse(jsonStr);
    const summary: NormalizedSpecSummary = {
      endpoints: parsed.endpoints ?? [],
      actors: parsed.actors ?? [],
      resources: parsed.resources ?? [],
      stateVariables: parsed.stateVariables ?? [],
      invariants: parsed.invariants ?? [],
      allowedTransitions: parsed.allowedTransitions ?? [],
      forbiddenTransitions: parsed.forbiddenTransitions ?? [],
      unknowns: parsed.unknowns ?? [],
    };
    return { summary, raw };
  } catch (err) {
    console.log(`  ⚠️  Failed to parse extractor response as JSON: ${err instanceof Error ? err.message : String(err)}`);
    console.log(`  Raw response (first 500 chars): ${raw.slice(0, 500)}`);
    return { summary: emptySpec(), raw };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptySpec(): NormalizedSpecSummary {
  return {
    endpoints: [],
    actors: [],
    resources: [],
    stateVariables: [],
    invariants: [],
    allowedTransitions: [],
    forbiddenTransitions: [],
    unknowns: [],
  };
}
