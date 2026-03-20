import { describe, it, expect } from "vitest";
import { scoreRound, formatScoreForReasoner } from "../src/scorer.js";
import type { SandboxResult } from "../src/sandbox/executor.js";

describe("scoreRound", () => {
  const allExports = ["add", "subtract", "multiply", "divide"];

  function makeSandboxResult(overrides: Partial<SandboxResult> = {}): SandboxResult {
    return {
      success: true,
      result: {
        testsRun: 4,
        testsPassed: 2,
        testsFailed: 2,
        results: [
          { label: "add(2,3)=5", status: "passed" },
          { label: "add(0,0)=0", status: "passed" },
          { label: "subtract(5,3)=1", status: "failed_assertion" },
          { label: "multiply throws on NaN", status: "execution_error" },
        ],
      },
      logs: [],
      durationMs: 500,
      callLog: [
        { method: "callFunction", fnName: "add", args: [2, 3] },
        { method: "callFunction", fnName: "add", args: [0, 0] },
        { method: "callFunction", fnName: "subtract", args: [5, 3] },
        { method: "callFunction", fnName: "multiply", args: [NaN, 2] },
      ],
      ...overrides,
    };
  }

  it("counts results by status correctly", () => {
    const score = scoreRound(makeSandboxResult(), allExports);
    expect(score.testsGenerated).toBe(4);
    expect(score.testsPassed).toBe(2);
    expect(score.testsFailed).toBe(1);
    expect(score.errorsCaught).toBe(1);
    expect(score.timeouts).toBe(0);
    expect(score.invalidTests).toBe(0);
  });

  it("identifies unique functions tested", () => {
    const score = scoreRound(makeSandboxResult(), allExports);
    expect(score.uniqueFunctionsTested.sort()).toEqual(["add", "multiply", "subtract"]);
  });

  it("identifies functions not tested", () => {
    const score = scoreRound(makeSandboxResult(), allExports);
    expect(score.functionsNotTested).toEqual(["divide"]);
  });

  it("detects edge case classes from args", () => {
    const result = makeSandboxResult({
      callLog: [
        { method: "callFunction", fnName: "add", args: [null, 0] },
        { method: "callFunction", fnName: "add", args: [-5, 3] },
        { method: "callFunction", fnName: "add", args: ["hello", 3] },
      ],
    });
    const score = scoreRound(result, allExports);
    expect(score.edgeCaseClassesCovered).toContain("nullish");
    expect(score.edgeCaseClassesCovered).toContain("zero");
    expect(score.edgeCaseClassesCovered).toContain("negative");
    expect(score.edgeCaseClassesCovered).toContain("type_mismatch");
  });

  it("detects empty edge cases", () => {
    const result = makeSandboxResult({
      callLog: [
        { method: "callFunction", fnName: "add", args: ["", []] },
        { method: "callFunction", fnName: "add", args: [{}, 1] },
      ],
    });
    const score = scoreRound(result, allExports);
    expect(score.edgeCaseClassesCovered).toContain("empty");
  });

  it("handles empty sandbox result gracefully", () => {
    const result = makeSandboxResult({
      success: false,
      result: undefined,
      callLog: [],
    });
    const score = scoreRound(result, allExports);
    expect(score.testsGenerated).toBe(0);
    expect(score.testsPassed).toBe(0);
    expect(score.functionsNotTested).toEqual(allExports);
  });

  it("counts timeout and invalid_test statuses", () => {
    const result = makeSandboxResult({
      result: {
        testsRun: 2,
        testsPassed: 0,
        testsFailed: 2,
        results: [
          { label: "slow test", status: "timeout" },
          { label: "bad test", status: "invalid_test" },
        ],
      },
    });
    const score = scoreRound(result, allExports);
    expect(score.timeouts).toBe(1);
    expect(score.invalidTests).toBe(1);
  });
});

describe("formatScoreForReasoner", () => {
  it("produces readable summary string", () => {
    const score = {
      testsGenerated: 5,
      testsPassed: 3,
      testsFailed: 1,
      errorsCaught: 1,
      timeouts: 0,
      invalidTests: 0,
      uniqueFunctionsTested: ["add", "subtract"],
      functionsNotTested: ["divide"],
      edgeCaseClassesCovered: ["nullish", "zero"],
      edgeCaseCount: 2,
    };
    const formatted = formatScoreForReasoner(score, 1);
    expect(formatted).toContain("Round 1");
    expect(formatted).toContain("5 generated");
    expect(formatted).toContain("3 passed");
    expect(formatted).toContain("add, subtract");
    expect(formatted).toContain("divide");
    expect(formatted).toContain("2 of 10");
  });
});
