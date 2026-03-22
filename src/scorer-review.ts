// scorer-review.ts — Review-mode scorer: evaluates proof verdicts against
// hypotheses, computes 10 metrics, deduplicates findings across rounds.
//
// Separate from scorer.ts (test mode). Called by the runner when --mode review.

import type { ProofVerdict, Hypothesis, ReviewScore, ConfirmedFinding } from "./types.js";

// ---------------------------------------------------------------------------
// Stopwords for deduplication
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "to", "of", "in", "for",
  "on", "with", "at", "by", "from", "as", "into", "through", "during",
  "before", "after", "above", "below", "between", "and", "but", "or",
  "nor", "not", "no", "so", "if", "than", "that", "this", "it", "its",
  "when", "where", "which", "who", "whom", "what", "how", "all", "each",
  "every", "both", "few", "more", "most", "other", "some", "such", "only",
  "own", "same", "too", "very", "just",
]);

function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter((t) => t && !STOPWORDS.has(t));
}

function extractFunctionName(target: string): string {
  // "function:divide" → "divide", "interaction:deposit,withdraw" → "deposit,withdraw", "module" → "module"
  const colonIdx = target.indexOf(":");
  return colonIdx >= 0 ? target.slice(colonIdx + 1) : target;
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

function isDuplicate(finding: ConfirmedFinding, priorFindings: ConfirmedFinding[]): boolean {
  const fnName = extractFunctionName(finding.target);
  const tokens = tokenize(finding.claim);
  if (tokens.length === 0) return false;

  for (const prior of priorFindings) {
    // Must match function and category
    if (extractFunctionName(prior.target) !== fnName) continue;
    if (prior.category !== finding.category) continue;

    // Check >50% token overlap
    const priorTokens = new Set(tokenize(prior.claim));
    const overlap = tokens.filter((t) => priorTokens.has(t)).length;
    if (overlap / tokens.length > 0.5) return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Main scoring function
// ---------------------------------------------------------------------------

export function scoreReviewRound(
  verdicts: ProofVerdict[],
  hypotheses: Hypothesis[],
  priorFindings: ConfirmedFinding[],
): { score: ReviewScore; newFindings: ConfirmedFinding[] } {
  const hypothesisMap = new Map<string, Hypothesis>();
  for (const h of hypotheses) {
    hypothesisMap.set(h.id, h);
  }

  let confirmed = 0;
  let refuted = 0;
  let inconclusive = 0;
  let cleanProofs = 0;
  const severityBreakdown: Record<string, number> = {};
  const categoryBreakdown: Record<string, number> = {};
  const inconclusiveByMode: Record<string, number> = {};
  const newFindings: ConfirmedFinding[] = [];
  let novelCount = 0;

  for (const v of verdicts) {
    const h = hypothesisMap.get(v.hypothesisId);

    if (v.verdict === "confirmed") {
      confirmed++;
      if (h) {
        severityBreakdown[h.severity] = (severityBreakdown[h.severity] ?? 0) + 1;
        categoryBreakdown[h.category] = (categoryBreakdown[h.category] ?? 0) + 1;

        const finding: ConfirmedFinding = {
          hypothesisId: v.hypothesisId,
          target: h.target,
          category: h.category,
          claim: h.claim,
          severity: h.severity,
        };

        if (!isDuplicate(finding, priorFindings)) {
          novelCount++;
        }
        newFindings.push(finding);
      } else {
        novelCount++;
      }
    } else if (v.verdict === "refuted") {
      refuted++;
    } else {
      inconclusive++;

      // Post-process failureMode assignment
      let mode = v.failureMode;
      if (!mode && h) {
        if (h.category === "performance") {
          mode = "measurement_noise";
          v.failureMode = mode;
        } else {
          mode = "bad_hypothesis";
          v.failureMode = mode;
        }
      }
      if (mode) {
        inconclusiveByMode[mode] = (inconclusiveByMode[mode] ?? 0) + 1;
      }
    }

    // Clean proof = no tool_error and no bad_proof
    if (v.failureMode !== "tool_error" && v.failureMode !== "bad_proof") {
      cleanProofs++;
    }
  }

  const total = verdicts.length;
  const confirmationDenom = confirmed + refuted;

  const score: ReviewScore = {
    hypotheses_total: total,
    confirmed_count: confirmed,
    refuted_count: refuted,
    inconclusive_count: inconclusive,
    confirmation_rate: confirmationDenom > 0 ? confirmed / confirmationDenom : 0,
    proof_success_rate: total > 0 ? cleanProofs / total : 0,
    severity_breakdown: severityBreakdown,
    category_breakdown: categoryBreakdown,
    novel_findings: novelCount,
    inconclusive_by_failure_mode: inconclusiveByMode,
  };

  return { score, newFindings };
}

// ---------------------------------------------------------------------------
// Format score for reasoner prompt
// ---------------------------------------------------------------------------

export function formatReviewScoreForReasoner(score: ReviewScore, round: number): string {
  const sevEntries = Object.entries(score.severity_breakdown).map(([k, v]) => `${k}: ${v}`).join(", ");
  const catEntries = Object.entries(score.category_breakdown).map(([k, v]) => `${k}: ${v}`).join(", ");
  const incEntries = Object.entries(score.inconclusive_by_failure_mode).map(([k, v]) => `${k}: ${v}`).join(", ");

  return `Round ${round} scoring:
- Hypotheses: ${score.hypotheses_total} total, ${score.confirmed_count} confirmed, ${score.refuted_count} refuted, ${score.inconclusive_count} inconclusive
- Confirmation rate: ${(score.confirmation_rate * 100).toFixed(0)}%
- Proof success rate: ${(score.proof_success_rate * 100).toFixed(0)}%
- Severity breakdown: ${sevEntries || "(none)"}
- Category breakdown: ${catEntries || "(none)"}
- Novel findings: ${score.novel_findings}
- Inconclusive by failure mode: ${incEntries || "(none)"}`;
}
