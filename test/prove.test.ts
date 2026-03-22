import { describe, it, expect } from "vitest";
import path from "node:path";
import { executeInSandbox } from "../src/sandbox/executor.js";
import { ModuleHost } from "../src/module-host.js";

// Helper: run generated code in the sandbox and return the result
async function runProofCode(code: string) {
  const samplePath = path.resolve(__dirname, "../examples/sample-math.ts");
  const moduleHost = new ModuleHost();
  await moduleHost.load(samplePath);
  return executeInSandbox(code, { moduleHost });
}

describe("prove()", () => {
  it("returns confirmed verdict when callback returns { confirmed: true }", async () => {
    const code = `
async function generatedTests(toolkit) {
  const v = await toolkit.prove("H1", async () => {
    return { confirmed: true, evidence: "it works" };
  });
  return { testsRun: 1, testsPassed: 1, testsFailed: 0, results: [v] };
}`;
    const result = await runProofCode(code);
    expect(result.success).toBe(true);
    const verdict = result.result!.results[0] as any;
    expect(verdict.hypothesisId).toBe("H1");
    expect(verdict.verdict).toBe("confirmed");
    expect(verdict.evidence).toBe("it works");
    expect(verdict.durationMs).toBeGreaterThanOrEqual(0);
    expect(verdict.failureMode).toBeUndefined();
  }, 20_000);

  it("returns refuted verdict when callback returns { confirmed: false }", async () => {
    const code = `
async function generatedTests(toolkit) {
  const v = await toolkit.prove("H2", async () => {
    return { confirmed: false, evidence: "not a bug" };
  });
  return { testsRun: 1, testsPassed: 0, testsFailed: 1, results: [v] };
}`;
    const result = await runProofCode(code);
    expect(result.success).toBe(true);
    const verdict = result.result!.results[0] as any;
    expect(verdict.hypothesisId).toBe("H2");
    expect(verdict.verdict).toBe("refuted");
    expect(verdict.evidence).toBe("not a bug");
    expect(verdict.failureMode).toBeUndefined();
  }, 20_000);

  it("returns inconclusive with bad_proof when callback throws", async () => {
    const code = `
async function generatedTests(toolkit) {
  const v = await toolkit.prove("H3", async () => {
    throw new Error("something broke");
  });
  return { testsRun: 1, testsPassed: 0, testsFailed: 1, results: [v] };
}`;
    const result = await runProofCode(code);
    expect(result.success).toBe(true);
    const verdict = result.result!.results[0] as any;
    expect(verdict.hypothesisId).toBe("H3");
    expect(verdict.verdict).toBe("inconclusive");
    expect(verdict.evidence).toContain("something broke");
    expect(verdict.failureMode).toBe("bad_proof");
  }, 20_000);

  it("returns inconclusive with bad_proof for malformed return", async () => {
    const code = `
async function generatedTests(toolkit) {
  const v = await toolkit.prove("H4", async () => {
    return { wrong: "shape" };
  });
  return { testsRun: 1, testsPassed: 0, testsFailed: 1, results: [v] };
}`;
    const result = await runProofCode(code);
    expect(result.success).toBe(true);
    const verdict = result.result!.results[0] as any;
    expect(verdict.hypothesisId).toBe("H4");
    expect(verdict.verdict).toBe("inconclusive");
    expect(verdict.failureMode).toBe("bad_proof");
    expect(verdict.evidence).toContain("malformed");
  }, 20_000);

  it("truncates evidence to 500 characters", async () => {
    const code = `
async function generatedTests(toolkit) {
  const longEvidence = "x".repeat(800);
  const v = await toolkit.prove("H5", async () => {
    return { confirmed: true, evidence: longEvidence };
  });
  return { testsRun: 1, testsPassed: 1, testsFailed: 0, results: [v] };
}`;
    const result = await runProofCode(code);
    expect(result.success).toBe(true);
    const verdict = result.result!.results[0] as any;
    expect(verdict.hypothesisId).toBe("H5");
    expect(verdict.verdict).toBe("confirmed");
    expect(verdict.evidence.length).toBe(500);
  }, 20_000);
});

describe("callFunctionMany()", () => {
  it("returns all results when all calls succeed", async () => {
    const code = `
async function generatedTests(toolkit) {
  const batch = await toolkit.callFunctionMany("add", [[1,2], [3,4], [5,6]]);
  return { testsRun: 1, testsPassed: 1, testsFailed: 0, results: batch };
}`;
    const result = await runProofCode(code);
    expect(result.success).toBe(true);
    const batch = result.result!.results as any[];
    expect(batch).toHaveLength(3);
    expect(batch[0]).toEqual({ index: 0, args: [1, 2], ok: true, result: 3 });
    expect(batch[1]).toEqual({ index: 1, args: [3, 4], ok: true, result: 7 });
    expect(batch[2]).toEqual({ index: 2, args: [5, 6], ok: true, result: 11 });
  }, 20_000);

  it("handles mix of successes and errors without early stop", async () => {
    const code = `
async function generatedTests(toolkit) {
  const batch = await toolkit.callFunctionMany("divide", [[10,2], [1,0], [6,3]]);
  return { testsRun: 1, testsPassed: 1, testsFailed: 0, results: batch };
}`;
    const result = await runProofCode(code);
    expect(result.success).toBe(true);
    const batch = result.result!.results as any[];
    expect(batch).toHaveLength(3);
    expect(batch[0].ok).toBe(true);
    expect(batch[0].result).toBe(5);
    expect(batch[1].ok).toBe(false);
    expect(batch[1].error).toContain("Division by zero");
    expect(batch[2].ok).toBe(true);
    expect(batch[2].result).toBe(2);
  }, 20_000);

  it("returns empty array for empty argSets", async () => {
    const code = `
async function generatedTests(toolkit) {
  const batch = await toolkit.callFunctionMany("add", []);
  return { testsRun: 1, testsPassed: 1, testsFailed: 0, results: batch };
}`;
    const result = await runProofCode(code);
    expect(result.success).toBe(true);
    const batch = result.result!.results as any[];
    expect(batch).toHaveLength(0);
  }, 20_000);
});

describe("comparePerformance()", () => {
  it("returns all four fields with correct types for fast vs slow", async () => {
    const code = `
async function generatedTests(toolkit) {
  const perf = await toolkit.comparePerformance("isPrime", [7], [104729], 50);
  return { testsRun: 1, testsPassed: 1, testsFailed: 0, results: [perf] };
}`;
    const result = await runProofCode(code);
    expect(result.success).toBe(true);
    const perf = result.result!.results[0] as any;
    expect(typeof perf.smallMedianMs).toBe("number");
    expect(typeof perf.largeMedianMs).toBe("number");
    expect(typeof perf.ratio).toBe("number");
    expect(typeof perf.trending).toBe("boolean");
    expect(perf.smallMedianMs).toBeGreaterThanOrEqual(0);
    expect(perf.largeMedianMs).toBeGreaterThanOrEqual(0);
  }, 30_000);

  it("clamps iterations to minimum 50 without error", async () => {
    const code = `
async function generatedTests(toolkit) {
  const perf = await toolkit.comparePerformance("add", [1, 2], [3, 4], 5);
  return { testsRun: 1, testsPassed: 1, testsFailed: 0, results: [perf] };
}`;
    const result = await runProofCode(code);
    expect(result.success).toBe(true);
    const perf = result.result!.results[0] as any;
    expect(typeof perf.ratio).toBe("number");
    expect(typeof perf.trending).toBe("boolean");
  }, 30_000);

  it("trending is false when both args produce similar timings", async () => {
    const code = `
async function generatedTests(toolkit) {
  const perf = await toolkit.comparePerformance("add", [1, 2], [3, 4], 50);
  return { testsRun: 1, testsPassed: 1, testsFailed: 0, results: [perf] };
}`;
    const result = await runProofCode(code);
    expect(result.success).toBe(true);
    const perf = result.result!.results[0] as any;
    expect(perf.trending).toBe(false);
  }, 30_000);
});
