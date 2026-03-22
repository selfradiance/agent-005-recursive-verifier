import { describe, it, expect } from "vitest";
import { buildFallbackReport, type ReviewReportInput } from "../src/reporter-review.js";
import type { ProofVerdict, Hypothesis, ReviewScore, ConfirmedFinding } from "../src/types.js";

function makeInput(overrides?: Partial<ReviewReportInput>): ReviewReportInput {
  const hypotheses: Hypothesis[] = [
    { id: "H1", category: "bug", target: "function:divide", claim: "divide by zero returns Infinity", severity: "high", expected_signal_type: "value", requires_fresh_state: false, proof_strategy: "test" },
    { id: "H2", category: "edge_case", target: "function:add", claim: "add handles NaN", severity: "medium", expected_signal_type: "value", requires_fresh_state: false, proof_strategy: "test" },
    { id: "H3", category: "performance", target: "function:isPrime", claim: "isPrime is slow on large input", severity: "low", expected_signal_type: "ratio", requires_fresh_state: false, proof_strategy: "test" },
  ];
  const verdicts: ProofVerdict[] = [
    { hypothesisId: "H1", verdict: "confirmed", evidence: "divide(1,0) returns Infinity", durationMs: 10 },
    { hypothesisId: "H2", verdict: "refuted", evidence: "add handles NaN correctly", durationMs: 5 },
    { hypothesisId: "H3", verdict: "inconclusive", evidence: "timing inconsistent", durationMs: 100, failureMode: "measurement_noise" },
  ];
  const scores: ReviewScore[] = [{
    hypotheses_total: 3, confirmed_count: 1, refuted_count: 1, inconclusive_count: 1,
    confirmation_rate: 0.5, proof_success_rate: 1, severity_breakdown: { high: 1 },
    category_breakdown: { bug: 1 }, novel_findings: 1, inconclusive_by_failure_mode: { measurement_noise: 1 },
  }];
  const findings: ConfirmedFinding[] = [
    { hypothesisId: "H1", target: "function:divide", category: "bug", claim: "divide by zero returns Infinity", severity: "high" },
  ];

  return {
    allVerdicts: verdicts,
    allHypotheses: hypotheses,
    allScores: scores,
    allFindings: findings,
    roundCount: 1,
    ...overrides,
  };
}

describe("buildFallbackReport", () => {
  it("produces a plain-text report with correct counts and findings", () => {
    const input = makeInput();
    const report = buildFallbackReport(input);

    expect(report).toContain("Rounds: 1");
    expect(report).toContain("Total hypotheses: 3");
    expect(report).toContain("Confirmed: 1");
    expect(report).toContain("Refuted: 1");
    expect(report).toContain("Inconclusive: 1");
    expect(report).toContain("CONFIRMED FINDINGS");
    expect(report).toContain("[H1]");
    expect(report).toContain("divide by zero returns Infinity");
    expect(report).toContain("bug/high");
    expect(report).toContain("INCONCLUSIVE LEADS");
    expect(report).toContain("[H3]");
    expect(report).toContain("measurement_noise");
  });

  it("handles empty verdicts gracefully", () => {
    const input = makeInput({
      allVerdicts: [],
      allHypotheses: [],
      allFindings: [],
    });
    const report = buildFallbackReport(input);

    expect(report).toContain("Total hypotheses: 0");
    expect(report).toContain("Confirmed: 0");
    expect(report).not.toContain("CONFIRMED FINDINGS");
    expect(report).not.toContain("INCONCLUSIVE LEADS");
  });
});
