// reporter.ts — Generates a final summary report from all rounds using Claude.

import Anthropic from "@anthropic-ai/sdk";
import type { RunResult } from "./runner.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReportOutput {
  summary: string;
  raw: string;
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

function buildReportPrompt(runResult: RunResult): string {
  const roundSummaries = runResult.rounds.map((r) => {
    if (!r.score) {
      return `Round ${r.round}: ${r.validationReason || r.sandboxResult?.error || "No results"}`;
    }

    const bugCandidates = r.sandboxResult?.result?.results
      .filter((t) => t.status === "failed_assertion" || t.status === "execution_error")
      .map((t) => `  - ${t.label} (${t.status})`)
      .join("\n") || "  (none)";

    return `Round ${r.round}:
- Tests: ${r.score.testsGenerated} generated, ${r.score.testsPassed} passed, ${r.score.testsFailed} failed
- Errors: ${r.score.errorsCaught} | Timeouts: ${r.score.timeouts} | Invalid: ${r.score.invalidTests}
- Functions tested: ${r.score.uniqueFunctionsTested.join(", ")}
- Functions not tested: ${r.score.functionsNotTested.join(", ") || "(none)"}
- Edge cases covered: ${r.score.edgeCaseClassesCovered.join(", ")} (${r.score.edgeCaseCount}/10)
- Bug candidates:
${bugCandidates}`;
  }).join("\n\n");

  return `You are summarizing the results of a recursive test generation session.

TARGET MODULE EXPORTS: ${runResult.moduleExports.join(", ")}

ROUND-BY-ROUND RESULTS:
${roundSummaries}

Write a concise summary report with these sections:
1. OVERVIEW — one paragraph describing what was tested and how many rounds ran
2. CONFIRMED BEHAVIOR — bullet list of behaviors that tests confirmed work correctly
3. BUG CANDIDATES — bullet list of potential bugs found (failed assertions, unexpected errors)
4. COVERAGE GAPS — what was NOT tested or has thin coverage
5. RECOMMENDATIONS — 2-3 actionable next steps

Be factual. Reference specific function names and test results. Do not speculate beyond what the data shows.`;
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

const client = new Anthropic();

export async function generateReport(runResult: RunResult): Promise<ReportOutput> {
  const prompt = buildReportPrompt(runResult);

  let response;
  try {
    response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    });
  } catch (err) {
    const errorMsg = `Failed to generate report: ${err instanceof Error ? err.message : String(err)}`;
    console.log(`  ⚠️  ${errorMsg}`);
    return { summary: errorMsg, raw: "" };
  }

  const raw = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  return { summary: raw, raw };
}
