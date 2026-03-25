// reporter-review.ts — Review-mode reporter: generates a structured findings
// report from all proof verdicts, hypotheses, and scores across rounds.
//
// Separate from reporter.ts (test mode). Called by the CLI when --mode review.

import type { ProofVerdict, Hypothesis, ReviewScore, ConfirmedFinding } from "./types.js";
import { client } from "./anthropic-client.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReviewReportInput {
  allVerdicts: ProofVerdict[];
  allHypotheses: Hypothesis[];
  allScores: ReviewScore[];
  allFindings: ConfirmedFinding[];
  roundCount: number;
}

export interface ReviewReportOutput {
  summary: string;
  raw: string;
}

// ---------------------------------------------------------------------------
// Fallback report (used when API fails)
// ---------------------------------------------------------------------------

export function buildFallbackReport(input: ReviewReportInput): string {
  const confirmed = input.allVerdicts.filter((v) => v.verdict === "confirmed");
  const refuted = input.allVerdicts.filter((v) => v.verdict === "refuted");
  const inconclusive = input.allVerdicts.filter((v) => v.verdict === "inconclusive");

  let report = `REVIEW REPORT (plain-text fallback)\n`;
  report += `${"=".repeat(50)}\n\n`;
  report += `Rounds: ${input.roundCount}\n`;
  report += `Total hypotheses: ${input.allVerdicts.length}\n`;
  report += `Confirmed: ${confirmed.length} | Refuted: ${refuted.length} | Inconclusive: ${inconclusive.length}\n\n`;

  if (confirmed.length > 0) {
    report += `CONFIRMED FINDINGS:\n`;
    for (const v of confirmed) {
      const h = input.allHypotheses.find((h) => h.id === v.hypothesisId);
      report += `  [${v.hypothesisId}] ${h?.category ?? "unknown"}/${h?.severity ?? "unknown"}: ${h?.claim ?? "unknown"}\n`;
      report += `    Evidence: ${v.evidence}\n`;
    }
    report += `\n`;
  }

  if (inconclusive.length > 0) {
    report += `INCONCLUSIVE LEADS:\n`;
    for (const v of inconclusive) {
      const h = input.allHypotheses.find((h) => h.id === v.hypothesisId);
      report += `  [${v.hypothesisId}] ${h?.claim ?? "unknown"} — ${v.failureMode ?? "unknown reason"}\n`;
    }
    report += `\n`;
  }

  return report;
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

function buildReportPrompt(input: ReviewReportInput): string {
  // Build verdict summaries
  const verdictLines = input.allVerdicts.map((v) => {
    const h = input.allHypotheses.find((h) => h.id === v.hypothesisId);
    return `  ${v.hypothesisId} (${h?.category ?? "?"}/${h?.severity ?? "?"}) — ${v.verdict}${v.failureMode ? ` [${v.failureMode}]` : ""}\n    Claim: ${h?.claim ?? "unknown"}\n    Evidence: ${v.evidence}`;
  }).join("\n\n");

  // Build score summaries
  const scoreSummaries = input.allScores.map((s, i) => {
    return `  Round ${i + 1}: ${s.confirmed_count} confirmed, ${s.refuted_count} refuted, ${s.inconclusive_count} inconclusive, ${s.novel_findings} novel`;
  }).join("\n");

  return `You are writing a code review findings report based on automated hypothesis-driven verification.

ROUNDS: ${input.roundCount}
TOTAL HYPOTHESES: ${input.allVerdicts.length}

ALL VERDICTS:
${verdictLines}

ROUND-BY-ROUND SCORES:
${scoreSummaries}

Write a structured findings report with these sections:

1. EXECUTIVE SUMMARY — Total hypotheses tested, confirmed/refuted/inconclusive across all rounds, key findings in 2-3 sentences.

2. CONFIRMED FINDINGS (Strong Evidence) — Direct counterexamples with deterministic reproduction (same input always produces same wrong output), or stable performance signals confirmed across multiple size pairs with consistent trending. Include the reproducibility packet for each: hypothesis (id, category, claim, severity), evidence string, and the inputs that triggered the finding.

3. CONFIRMED FINDINGS (Moderate Evidence) — Narrow edge cases (unusual input type or boundary value), timing-sensitive results (single size pair or borderline ratio), or findings with limited surface area. Include the reproducibility packet.

4. INCONCLUSIVE LEADS — Hypotheses worth investigating but not proven either way. Include the failure mode explaining why they couldn't be resolved.

5. STRATEGY EVOLUTION — How the verification adapted across rounds: what categories were explored, what was abandoned after refutations, what was doubled down on after confirmations.

6. PER-CATEGORY BREAKDOWN — Confirmed findings grouped by category (bug, edge_case, performance, security, property_violation).

Evidence strength rules:
- Strong: Direct counterexample with deterministic reproduction, or stable performance signal confirmed across multiple size pairs
- Moderate: Narrow edge case, timing-sensitive result, or limited surface area
- Inconclusive: Hypothesis has a failureMode set, or verdict is "inconclusive"

Be factual. Reference specific hypothesis IDs, function names, and evidence. Do not speculate beyond what the data shows.`;
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

export async function generateReviewReport(
  input: ReviewReportInput,
): Promise<ReviewReportOutput> {
  const prompt = buildReportPrompt(input);

  let response;
  try {
    response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    });
  } catch (err) {
    console.log(`  ⚠️  Claude API error in review reporter: ${err instanceof Error ? err.message : String(err)}`);
    return { summary: buildFallbackReport(input), raw: "" };
  }

  const raw = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  return { summary: raw, raw };
}
