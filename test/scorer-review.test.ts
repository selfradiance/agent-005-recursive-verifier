import { describe, it, expect } from "vitest";
import { scoreReviewRound } from "../src/scorer-review.js";
import type { ProofVerdict, Hypothesis, ConfirmedFinding } from "../src/types.js";

function makeHypothesis(overrides: Partial<Hypothesis> & { id: string }): Hypothesis {
  return {
    category: "bug",
    target: "function:add",
    claim: "add returns wrong result",
    severity: "medium",
    expected_signal_type: "value",
    requires_fresh_state: false,
    proof_strategy: "call add and check",
    ...overrides,
  };
}

describe("scoreReviewRound", () => {
  it("computes basic counts and confirmation_rate", () => {
    const verdicts: ProofVerdict[] = [
      { hypothesisId: "H1", verdict: "confirmed", evidence: "bug found", durationMs: 10 },
      { hypothesisId: "H2", verdict: "refuted", evidence: "no bug", durationMs: 5 },
      { hypothesisId: "H3", verdict: "inconclusive", evidence: "error", durationMs: 8, failureMode: "bad_proof" },
    ];
    const hypotheses: Hypothesis[] = [
      makeHypothesis({ id: "H1" }),
      makeHypothesis({ id: "H2" }),
      makeHypothesis({ id: "H3" }),
    ];

    const { score } = scoreReviewRound(verdicts, hypotheses, []);

    expect(score.hypotheses_total).toBe(3);
    expect(score.confirmed_count).toBe(1);
    expect(score.refuted_count).toBe(1);
    expect(score.inconclusive_count).toBe(1);
    expect(score.confirmation_rate).toBe(0.5); // 1 / (1 + 1)
    // H3 has bad_proof so it's not a clean proof; H1 and H2 are clean
    expect(score.proof_success_rate).toBeCloseTo(2 / 3);
  });

  it("computes severity and category breakdown for confirmed findings", () => {
    const verdicts: ProofVerdict[] = [
      { hypothesisId: "H1", verdict: "confirmed", evidence: "crash", durationMs: 10 },
      { hypothesisId: "H2", verdict: "confirmed", evidence: "slow", durationMs: 20 },
    ];
    const hypotheses: Hypothesis[] = [
      makeHypothesis({ id: "H1", severity: "critical", category: "bug", target: "function:divide" }),
      makeHypothesis({ id: "H2", severity: "medium", category: "performance", target: "function:isPrime" }),
    ];

    const { score } = scoreReviewRound(verdicts, hypotheses, []);

    expect(score.severity_breakdown).toEqual({ critical: 1, medium: 1 });
    expect(score.category_breakdown).toEqual({ bug: 1, performance: 1 });
  });

  it("deduplicates findings against prior rounds", () => {
    const verdicts: ProofVerdict[] = [
      { hypothesisId: "H1", verdict: "confirmed", evidence: "divide by zero returns Infinity", durationMs: 10 },
      { hypothesisId: "H2", verdict: "confirmed", evidence: "factorial negative", durationMs: 5 },
    ];
    const hypotheses: Hypothesis[] = [
      makeHypothesis({ id: "H1", target: "function:divide", category: "bug", claim: "divide returns Infinity on zero input" }),
      makeHypothesis({ id: "H2", target: "function:factorial", category: "edge_case", claim: "factorial fails on negative numbers" }),
    ];
    const priorFindings: ConfirmedFinding[] = [
      { hypothesisId: "H_old", target: "function:divide", category: "bug", claim: "divide mishandles zero — returns Infinity instead of throwing", severity: "high" },
    ];

    const { score } = scoreReviewRound(verdicts, hypotheses, priorFindings);

    // H1 is a duplicate (same target, same category, overlapping claim tokens)
    // H2 is novel (different target and category)
    expect(score.novel_findings).toBe(1);
    expect(score.confirmed_count).toBe(2);
  });

  it("assigns measurement_noise for inconclusive performance hypothesis without failureMode", () => {
    const verdict: ProofVerdict = {
      hypothesisId: "H1",
      verdict: "inconclusive",
      evidence: "timing inconsistent",
      durationMs: 100,
      // no failureMode set — scorer should assign one
    };
    const hypotheses: Hypothesis[] = [
      makeHypothesis({ id: "H1", category: "performance", claim: "isPrime is slow" }),
    ];

    const { score } = scoreReviewRound([verdict], hypotheses, []);

    expect(score.inconclusive_count).toBe(1);
    expect(score.inconclusive_by_failure_mode).toEqual({ measurement_noise: 1 });
    // Verify the verdict was mutated with the assigned failureMode
    expect(verdict.failureMode).toBe("measurement_noise");
  });
});
