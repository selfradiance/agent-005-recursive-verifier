// scorer.ts — Computes 8 metrics + edge case detection from sandbox results.
//
// The scorer takes the raw results from a sandbox execution and the toolkit
// call log, then produces a structured score card that the reasoner uses
// to guide the next round.

import type { SandboxResult, TestResult } from "./sandbox/executor.js";
import type { ToolkitCallLog } from "./sandbox/toolkit-host.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RoundScore {
  testsGenerated: number;
  testsPassed: number;
  testsFailed: number;
  errorsCaught: number;
  timeouts: number;
  invalidTests: number;
  uniqueFunctionsTested: string[];
  functionsNotTested: string[];
  edgeCaseClassesCovered: string[];
  edgeCaseCount: number;
}

// ---------------------------------------------------------------------------
// Edge case detection (hardcoded boundary list)
// ---------------------------------------------------------------------------

const EDGE_CLASSES: Record<string, (value: unknown) => boolean> = {
  nullish: (v) => v === null || v === undefined || v === "[undefined]",
  zero: (v) => v === 0 || v === -0 || Object.is(v, -0),
  negative: (v) => typeof v === "number" && v < 0,
  empty: (v) =>
    v === "" ||
    (Array.isArray(v) && v.length === 0) ||
    (typeof v === "object" && v !== null && !Array.isArray(v) && Object.keys(v).length === 0),
  large_numeric: (v) =>
    v === Number.MAX_SAFE_INTEGER ||
    v === Number.MAX_VALUE ||
    v === Infinity ||
    v === -Infinity,
  long_string: (v) => typeof v === "string" && v.length > 1000,
  special_chars: (v) =>
    typeof v === "string" &&
    /[<>"'\\]|\n|\0|[\u{10000}-\u{10FFFF}]/u.test(v),
  boolean: (v) => v === true || v === false,
  NaN: (v) => typeof v === "number" && Number.isNaN(v),
  type_mismatch: (_v) => false, // Heuristic — checked separately below
};

function detectEdgeCases(callLog: ToolkitCallLog[]): string[] {
  const coveredClasses = new Set<string>();

  for (const entry of callLog) {
    if (!entry.args) continue;

    for (const arg of entry.args) {
      for (const [className, checker] of Object.entries(EDGE_CLASSES)) {
        if (className === "type_mismatch") continue;
        if (checker(arg)) {
          coveredClasses.add(className);
        }
      }

      // type_mismatch heuristic: string passed as an argument
      // to a function that previously received numbers
      if (typeof arg === "string" && arg !== "") {
        // Simple heuristic: if a string is passed as an argument, flag it
        // More sophisticated detection would track per-function arg types
        coveredClasses.add("type_mismatch");
      }
    }
  }

  return Array.from(coveredClasses);
}

// ---------------------------------------------------------------------------
// Main scoring function
// ---------------------------------------------------------------------------

export function scoreRound(
  sandboxResult: SandboxResult,
  allExports: string[],
): RoundScore {
  const results: TestResult[] = sandboxResult.result?.results ?? [];
  const callLog = sandboxResult.callLog ?? [];

  // Count by status
  let testsPassed = 0;
  let testsFailed = 0;
  let errorsCaught = 0;
  let timeouts = 0;
  let invalidTests = 0;

  for (const r of results) {
    switch (r.status) {
      case "passed":
        testsPassed++;
        break;
      case "failed_assertion":
        testsFailed++;
        break;
      case "execution_error":
        errorsCaught++;
        break;
      case "timeout":
        timeouts++;
        break;
      case "invalid_test":
        invalidTests++;
        break;
    }
  }

  // Unique functions tested (from call log)
  const functionsTested = new Set<string>();
  for (const entry of callLog) {
    if (entry.fnName) {
      functionsTested.add(entry.fnName);
    }
  }

  const uniqueFunctionsTested = Array.from(functionsTested);
  const functionsNotTested = allExports.filter((fn) => !functionsTested.has(fn));

  // Edge case detection
  const edgeCaseClassesCovered = detectEdgeCases(callLog);

  return {
    testsGenerated: results.length,
    testsPassed,
    testsFailed,
    errorsCaught,
    timeouts,
    invalidTests,
    uniqueFunctionsTested,
    functionsNotTested,
    edgeCaseClassesCovered,
    edgeCaseCount: edgeCaseClassesCovered.length,
  };
}

// ---------------------------------------------------------------------------
// Format score for reasoner prompt
// ---------------------------------------------------------------------------

export function formatScoreForReasoner(score: RoundScore, round: number): string {
  return `Round ${round} scoring:
- Tests: ${score.testsGenerated} generated, ${score.testsPassed} passed, ${score.testsFailed} failed_assertion, ${score.errorsCaught} execution_error
- Timeouts: ${score.timeouts}, Invalid tests: ${score.invalidTests}
- Functions tested: ${score.uniqueFunctionsTested.join(", ")} (${score.uniqueFunctionsTested.length} total)
- Untested: ${score.functionsNotTested.length > 0 ? score.functionsNotTested.join(", ") : "(none)"}
- Edge case classes covered: ${score.edgeCaseClassesCovered.join(", ")} (${score.edgeCaseCount} of 10)`;
}
