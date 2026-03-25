// extractor-design.ts — Phase 1 of the design adversary pipeline.
//
// Uses Claude to parse a raw API spec (markdown, text, etc.) into a
// NormalizedSpecSummary — a structured representation of endpoints, roles,
// resources, invariants, state variables, and transitions.

import type { NormalizedSpecSummary } from "./types.js";
import { extractJson, truncateSpecText } from "./extract-json.js";
import { client } from "./anthropic-client.js";

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
  const safeSpec = truncateSpecText(specText);
  return `You are a precise API specification analyzer. Parse the following API specification into a structured summary.

API SPECIFICATION:
<spec>
${safeSpec}
</spec>

YOUR TASK:
Extract a normalized summary with these fields:

1. endpoints — all API endpoints with path, HTTP method, and description
2. actors — all roles/actors with their permissions
3. resources — all domain objects/resources mentioned
4. stateVariables — all state that can change (e.g., "bond.usedAmount", "identity.status")
5. businessRules — explicit business rules (e.g., "R1: Only admin can create identities") with an id and rule text
6. invariants — state invariants that must always hold (e.g., "INV1: Used amount never exceeds bonded amount") with an id and rule text. These are properties that can be checked against the current state, NOT action/permission rules.
7. allowedTransitions — valid state transitions (from → to, with trigger)
8. forbiddenTransitions — explicitly prohibited state transitions with reasons
9. unknowns — ambiguities, missing information, or underspecified behaviors

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
  "businessRules": [{ "id": "R1", "rule": "Only admin can create identities" }],
  "invariants": [{ "id": "INV1", "rule": "Used amount never exceeds bonded amount" }],
  "allowedTransitions": [{ "from": "active", "to": "suspended", "trigger": "admin suspends identity" }],
  "forbiddenTransitions": [{ "description": "...", "reason": "..." }],
  "unknowns": [{ "description": "..." }]
}`;
}

// ---------------------------------------------------------------------------
// Element-level validation helpers
// ---------------------------------------------------------------------------

function isValidEndpoint(e: unknown): e is { path: string; method: string; description: string } {
  return !!e && typeof e === "object" && typeof (e as Record<string, unknown>).path === "string"
    && typeof (e as Record<string, unknown>).method === "string"
    && typeof (e as Record<string, unknown>).description === "string";
}

function isValidActor(a: unknown): a is { role: string; permissions: string[] } {
  return !!a && typeof a === "object" && typeof (a as Record<string, unknown>).role === "string"
    && Array.isArray((a as Record<string, unknown>).permissions);
}

function isValidNameDesc(r: unknown): r is { name: string; description: string } {
  return !!r && typeof r === "object" && typeof (r as Record<string, unknown>).name === "string"
    && typeof (r as Record<string, unknown>).description === "string";
}

function isValidIdRule(r: unknown): r is { id: string; rule: string } {
  return !!r && typeof r === "object" && typeof (r as Record<string, unknown>).id === "string"
    && typeof (r as Record<string, unknown>).rule === "string";
}

function isValidTransition(t: unknown): t is { from: string; to: string; trigger: string } {
  return !!t && typeof t === "object" && typeof (t as Record<string, unknown>).from === "string"
    && typeof (t as Record<string, unknown>).to === "string"
    && typeof (t as Record<string, unknown>).trigger === "string";
}

function isValidForbidden(f: unknown): f is { description: string; reason: string } {
  return !!f && typeof f === "object" && typeof (f as Record<string, unknown>).description === "string"
    && typeof (f as Record<string, unknown>).reason === "string";
}

function isValidUnknown(u: unknown): u is { description: string } {
  return !!u && typeof u === "object" && typeof (u as Record<string, unknown>).description === "string";
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

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
      endpoints: Array.isArray(parsed.endpoints) ? parsed.endpoints.filter(isValidEndpoint) : [],
      actors: Array.isArray(parsed.actors) ? parsed.actors.filter(isValidActor) : [],
      resources: Array.isArray(parsed.resources) ? parsed.resources.filter(isValidNameDesc) : [],
      stateVariables: Array.isArray(parsed.stateVariables) ? parsed.stateVariables.filter(isValidNameDesc) : [],
      businessRules: Array.isArray(parsed.businessRules) ? parsed.businessRules.filter(isValidIdRule) : [],
      invariants: Array.isArray(parsed.invariants) ? parsed.invariants.filter(isValidIdRule) : [],
      allowedTransitions: Array.isArray(parsed.allowedTransitions) ? parsed.allowedTransitions.filter(isValidTransition) : [],
      forbiddenTransitions: Array.isArray(parsed.forbiddenTransitions) ? parsed.forbiddenTransitions.filter(isValidForbidden) : [],
      unknowns: Array.isArray(parsed.unknowns) ? parsed.unknowns.filter(isValidUnknown) : [],
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
    businessRules: [],
    invariants: [],
    allowedTransitions: [],
    forbiddenTransitions: [],
    unknowns: [],
  };
}
