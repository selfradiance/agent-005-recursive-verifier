// extract-json.ts — Shared JSON extraction helper for Claude API responses.
//
// Handles markdown fences, leading text, and non-standard JSON values
// (NaN, Infinity, undefined) that Claude occasionally emits.

// ---------------------------------------------------------------------------
// Max spec text size (characters) to embed in prompts.
// Roughly 100K chars ~ 25K tokens, leaving room for prompt scaffolding.
// ---------------------------------------------------------------------------

export const MAX_SPEC_TEXT_CHARS = 100_000;

/**
 * Truncate spec text to a safe size for embedding in prompts.
 * If truncated, appends a notice so the LLM knows data was cut.
 */
export function truncateSpecText(specText: string): string {
  if (specText.length <= MAX_SPEC_TEXT_CHARS) return specText;
  const truncated = specText.slice(0, MAX_SPEC_TEXT_CHARS);
  return truncated + "\n\n[... spec truncated at 100K characters ...]";
}

// ---------------------------------------------------------------------------
// JSON extraction
// ---------------------------------------------------------------------------

/**
 * Extract a JSON string from a Claude response that may contain markdown
 * fences, leading text, or non-standard values.
 */
export function extractJson(raw: string): string {
  let jsonStr = raw.trim();

  // Strip markdown fences
  if (jsonStr.includes("```")) {
    const fenceMatch = jsonStr.match(/```(?:json|javascript|js)?\s*\n?([\s\S]*?)\n?\s*```/);
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

  // Sanitize non-standard values that Claude sometimes emits
  jsonStr = jsonStr
    .replace(/([:,[\]]\s*)NaN\b/g, '$1"NaN"')
    .replace(/([:,[\]]\s*)Infinity\b/g, '$1"Infinity"')
    .replace(/([:,[\]]\s*)-Infinity\b/g, '$1"-Infinity"')
    .replace(/([:,[\]]\s*)undefined\b/g, "$1null");

  return jsonStr;
}
