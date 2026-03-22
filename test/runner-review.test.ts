import { describe, it, expect } from "vitest";
import path from "node:path";
import { executeInSandbox } from "../src/sandbox/executor.js";
import { validateGeneratedCode } from "../src/sandbox/validator.js";
import { scoreReviewRound } from "../src/scorer-review.js";
import { ModuleHost } from "../src/module-host.js";
import type { Hypothesis } from "../src/types.js";

describe("review mode integration", () => {
  it("completes a single review-mode round: validate → execute → score with proofVerdicts", async () => {
    // Simulate what the runner does in review mode with pre-baked proof code

    // 1. Load module
    const samplePath = path.resolve(__dirname, "../examples/sample-math.ts");
    const moduleHost = new ModuleHost();
    await moduleHost.load(samplePath);

    // 2. Hypotheses (what the reasoner would produce)
    const hypotheses: Hypothesis[] = [
      {
        id: "H1",
        category: "bug",
        target: "function:divide",
        claim: "divide(1, 0) throws instead of returning Infinity",
        severity: "high",
        expected_signal_type: "throw",
        requires_fresh_state: false,
        proof_strategy: "Call divide(1, 0) and check if it throws",
      },
      {
        id: "H2",
        category: "edge_case",
        target: "function:add",
        claim: "add handles negative numbers correctly",
        severity: "low",
        expected_signal_type: "value",
        requires_fresh_state: false,
        proof_strategy: "Call add(-1, -2) and verify result is -3",
      },
    ];

    // 3. Generated proof code (what the generator would produce)
    const code = `
async function generatedProofs(toolkit) {
  await toolkit.prove("H1", async () => {
    const r = await toolkit.callFunction("divide", [1, 0]);
    if (r.threwError) {
      return { confirmed: true, evidence: "divide(1, 0) throws: " + r.errorMessage };
    }
    return { confirmed: false, evidence: "divide(1, 0) did not throw" };
  });

  await toolkit.prove("H2", async () => {
    const r = await toolkit.callFunction("add", [-1, -2]);
    if (r.result === -3) {
      return { confirmed: false, evidence: "add(-1, -2) correctly returns -3" };
    }
    return { confirmed: true, evidence: "add(-1, -2) returned " + r.result };
  });
}`;

    // 4. Validate in review mode
    const validation = validateGeneratedCode(code, "review");
    expect(validation.valid).toBe(true);

    // 5. Execute in sandbox with review mode
    const sandboxResult = await executeInSandbox(code, { moduleHost, mode: "review" });

    // 6. Verify proof verdicts came through
    expect(sandboxResult.proofVerdicts).toHaveLength(2);

    const v1 = sandboxResult.proofVerdicts.find((v) => v.hypothesisId === "H1");
    expect(v1).toBeDefined();
    expect(v1!.verdict).toBe("confirmed"); // divide(1,0) does throw
    expect(v1!.evidence).toContain("throws");

    const v2 = sandboxResult.proofVerdicts.find((v) => v.hypothesisId === "H2");
    expect(v2).toBeDefined();
    expect(v2!.verdict).toBe("refuted"); // add(-1,-2) correctly returns -3

    // 7. Score the round
    const { score, newFindings } = scoreReviewRound(sandboxResult.proofVerdicts, hypotheses, []);
    expect(score.hypotheses_total).toBe(2);
    expect(score.confirmed_count).toBe(1);
    expect(score.refuted_count).toBe(1);
    expect(score.novel_findings).toBe(1);
    expect(newFindings).toHaveLength(1);
    expect(newFindings[0].hypothesisId).toBe("H1");
  }, 20_000);
});
