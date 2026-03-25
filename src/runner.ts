// runner.ts — Orchestrates the recursive loop for test, review, and design modes.
//
// Test mode: reasoner → generator → validator → executor → scorer (v0.1.0)
// Review mode: review-reasoner → review-generator → validator → executor → review-scorer (v0.2.0)
// Design mode: extractor → reasoner-design → validator → executor → scorer-design (v0.3.0)

import fs from "node:fs";
import { ModuleHost } from "./module-host.js";
import { generateHypotheses, type ReasonerInput } from "./reasoner.js";
import { generateTestCode } from "./generator.js";
import { validateGeneratedCode } from "./sandbox/validator.js";
import { executeInSandbox, type SandboxResult } from "./sandbox/executor.js";
import { scoreRound, formatScoreForReasoner, type RoundScore } from "./scorer.js";
import { generateReviewHypotheses } from "./reasoner-review.js";
import { generateProofCode } from "./generator-review.js";
import { scoreReviewRound, formatReviewScoreForReasoner } from "./scorer-review.js";
import { extractSpec } from "./extractor-design.js";
import { generateDesignModel } from "./reasoner-design.js";
import { generateAttackCode } from "./generator-design.js";
import { checkFidelity, buildFindings, computeCoverage, scoreDesignRound, formatDesignScoreForReasoner } from "./scorer-design.js";
import type { Mode } from "./cli.js";
import type {
  Hypothesis, ProofVerdict, ReviewScore, ConfirmedFinding,
  NormalizedSpecSummary, DesignFinding, DesignScore, FidelityMismatch,
  ChangeJustification, CoverageVector, Assumption,
} from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RoundResult {
  round: number;
  hypotheses: unknown[];
  generatedCode: string;
  validationPassed: boolean;
  validationReason?: string;
  sandboxResult: SandboxResult | null;
  score: RoundScore | null;
  reviewScore: ReviewScore | null;
  proofVerdicts: ProofVerdict[];
  formattedScore: string;
}

export interface RunnerOptions {
  filePath: string;
  functions?: string[];
  rounds: number;
  verbose: boolean;
  mode?: Mode;
  maxSourceTokens?: number;
  moduleHost?: ModuleHost;
}

export interface RunResult {
  rounds: RoundResult[];
  moduleExports: string[];
  sourceCode: string;
  allVerdicts: ProofVerdict[];
  allHypotheses: Hypothesis[];
  allFindings: ConfirmedFinding[];
}

// ---------------------------------------------------------------------------
// Main runner
// ---------------------------------------------------------------------------

export async function run(options: RunnerOptions): Promise<RunResult> {
  const { filePath, functions, rounds, verbose, maxSourceTokens = 8000 } = options;
  const mode: Mode = options.mode ?? "test";

  // Step 1: Load target module (reuse pre-loaded host if provided)
  const moduleHost = options.moduleHost ?? new ModuleHost();
  if (!options.moduleHost) {
    await moduleHost.load(filePath);
  }

  const allExports = moduleHost.getExports();
  let sourceCode = moduleHost.getSourceCode();

  // Truncate source for reasoner if too large (~4 chars per token)
  const charLimit = maxSourceTokens * 4;
  if (sourceCode.length > charLimit) {
    console.log(`⚠️  Target module is large (${Math.round(sourceCode.length / 1024)}KB). Reasoner will see first ${maxSourceTokens} tokens.`);
    console.log(`    Use --functions to narrow scope for better results.\n`);
    sourceCode = sourceCode.slice(0, charLimit);
  }

  if (mode === "review") {
    return runReviewMode(moduleHost, allExports, sourceCode, rounds, verbose, options);
  }

  return runTestMode(moduleHost, allExports, sourceCode, rounds, verbose, functions, options);
}

// ---------------------------------------------------------------------------
// Test mode (v0.1.0)
// ---------------------------------------------------------------------------

async function runTestMode(
  moduleHost: ModuleHost,
  allExports: string[],
  sourceCode: string,
  rounds: number,
  verbose: boolean,
  functions: string[] | undefined,
  _options: RunnerOptions,
): Promise<RunResult> {
  const roundResults: RoundResult[] = [];
  let priorScoreSummary = "";

  for (let round = 1; round <= rounds; round++) {
    console.log(`\n── Round ${round} of ${rounds} ──────────────────────────────────\n`);

    // Step 2: Reasoner — generate hypotheses
    console.log("  🧠 Reasoning about test gaps...");
    const reasonerInput: ReasonerInput = {
      sourceCode,
      exports: allExports,
      focusFunctions: functions,
      round,
      priorResults: round > 1 ? priorScoreSummary : undefined,
    };

    const { hypotheses } = await generateHypotheses(reasonerInput);
    console.log(`  📋 ${hypotheses.length} hypotheses generated`);

    if (verbose && hypotheses.length > 0) {
      for (const h of hypotheses) {
        console.log(`     • ${h.function}(${JSON.stringify(h.inputs)}) — ${h.behavior}`);
      }
    }

    if (hypotheses.length === 0) {
      console.log("  ⚠️  No hypotheses generated. Ending early.");
      roundResults.push({
        round,
        hypotheses: [],
        generatedCode: "",
        validationPassed: false,
        validationReason: "No hypotheses generated",
        sandboxResult: null,
        score: null,
        reviewScore: null,
        proofVerdicts: [],
        formattedScore: "",
      });
      break;
    }

    // Step 3: Generator — produce test code
    console.log("  ⚙️  Generating test code...");
    const { code } = await generateTestCode(hypotheses);

    if (verbose) {
      console.log("\n  --- Generated Code ---");
      console.log(code);
      console.log("  --- End Code ---\n");
    }

    // Step 4: Validator — check code safety
    console.log("  🔒 Validating generated code...");
    const validation = validateGeneratedCode(code, "test");

    if (!validation.valid) {
      console.log(`  ❌ Validation failed: ${validation.reason}`);
      roundResults.push({
        round,
        hypotheses,
        generatedCode: code,
        validationPassed: false,
        validationReason: validation.reason,
        sandboxResult: null,
        score: null,
        reviewScore: null,
        proofVerdicts: [],
        formattedScore: "",
      });
      continue;
    }
    console.log("  ✅ Validation passed");

    // Step 5: Executor — run in sandbox
    console.log("  🏃 Executing in sandbox...");
    const sandboxResult = await executeInSandbox(code, { moduleHost, mode: "test" });

    if (!sandboxResult.success) {
      console.log(`  ❌ Sandbox execution failed: ${sandboxResult.error}`);
      roundResults.push({
        round,
        hypotheses,
        generatedCode: code,
        validationPassed: true,
        sandboxResult,
        score: null,
        reviewScore: null,
        proofVerdicts: [],
        formattedScore: "",
      });
      continue;
    }

    // Step 6: Scorer — compute metrics
    const score = scoreRound(sandboxResult, allExports);
    const formattedScore = formatScoreForReasoner(score, round);
    priorScoreSummary += (priorScoreSummary ? "\n\n" : "") + formattedScore;

    console.log(`\n  📊 Results:`);
    console.log(`     Tests: ${score.testsGenerated} generated, ${score.testsPassed} passed, ${score.testsFailed} failed`);
    console.log(`     Errors: ${score.errorsCaught} | Timeouts: ${score.timeouts} | Invalid: ${score.invalidTests}`);
    console.log(`     Functions tested: ${score.uniqueFunctionsTested.join(", ") || "(none)"}`);
    if (score.functionsNotTested.length > 0) {
      console.log(`     Not yet tested: ${score.functionsNotTested.join(", ")}`);
    }
    console.log(`     Edge cases: ${score.edgeCaseClassesCovered.join(", ") || "(none)"} (${score.edgeCaseCount}/9)`);

    // Print sandbox logs if any
    if (sandboxResult.logs.length > 0) {
      console.log(`\n  📝 Sandbox logs:`);
      for (const log of sandboxResult.logs) {
        console.log(`     ${log}`);
      }
    }

    roundResults.push({
      round,
      hypotheses,
      generatedCode: code,
      validationPassed: true,
      sandboxResult,
      score,
      reviewScore: null,
      proofVerdicts: [],
      formattedScore,
    });
  }

  return {
    rounds: roundResults,
    moduleExports: allExports,
    sourceCode,
    allVerdicts: [],
    allHypotheses: [],
    allFindings: [],
  };
}

// ---------------------------------------------------------------------------
// Review mode (v0.2.0)
// ---------------------------------------------------------------------------

async function runReviewMode(
  moduleHost: ModuleHost,
  allExports: string[],
  sourceCode: string,
  rounds: number,
  verbose: boolean,
  _options: RunnerOptions,
): Promise<RunResult> {
  const roundResults: RoundResult[] = [];
  const allVerdicts: ProofVerdict[] = [];
  const allHypotheses: Hypothesis[] = [];
  const allFindings: ConfirmedFinding[] = [];
  let priorScoreSummary = "";

  for (let round = 1; round <= rounds; round++) {
    console.log(`\n── Round ${round} of ${rounds} ──────────────────────────────────\n`);

    // Step 2: Reasoner — generate hypotheses about code quality
    console.log("  🧠 Generating hypotheses...");
    const { hypotheses } = await generateReviewHypotheses({
      sourceCode,
      exports: allExports,
      round,
      priorVerdicts: round > 1 ? allVerdicts : undefined,
      priorScores: round > 1 ? priorScoreSummary : undefined,
    });
    console.log(`  📋 ${hypotheses.length} hypotheses generated`);

    if (verbose && hypotheses.length > 0) {
      for (const h of hypotheses) {
        console.log(`     • [${h.id}] ${h.category}/${h.severity}: ${h.claim}`);
      }
    }

    if (hypotheses.length === 0) {
      console.log("  ⚠️  No hypotheses generated. Ending early.");
      roundResults.push({
        round,
        hypotheses: [],
        generatedCode: "",
        validationPassed: false,
        validationReason: "No hypotheses generated",
        sandboxResult: null,
        score: null,
        reviewScore: null,
        proofVerdicts: [],
        formattedScore: "",
      });
      break;
    }

    allHypotheses.push(...hypotheses);

    // Step 3: Generator — produce proof scripts
    console.log("  ⚙️  Generating proof code...");
    const { code } = await generateProofCode(hypotheses, sourceCode);

    if (!code) {
      console.log("  ❌ Generator returned no code");
      roundResults.push({
        round,
        hypotheses,
        generatedCode: "",
        validationPassed: false,
        validationReason: "Generator returned no code",
        sandboxResult: null,
        score: null,
        reviewScore: null,
        proofVerdicts: [],
        formattedScore: "",
      });
      continue;
    }

    if (verbose) {
      console.log("\n  --- Generated Code ---");
      console.log(code);
      console.log("  --- End Code ---\n");
    }

    // Step 4: Validator — check code safety (review mode)
    console.log("  🔒 Validating generated code...");
    const validation = validateGeneratedCode(code, "review");

    if (!validation.valid) {
      console.log(`  ❌ Validation failed: ${validation.reason}`);
      roundResults.push({
        round,
        hypotheses,
        generatedCode: code,
        validationPassed: false,
        validationReason: validation.reason,
        sandboxResult: null,
        score: null,
        reviewScore: null,
        proofVerdicts: [],
        formattedScore: "",
      });
      continue;
    }
    console.log("  ✅ Validation passed");

    // Step 5: Reload module fresh for this round (reset state)
    await moduleHost.reloadFresh();

    // Step 6: Executor — run in sandbox (review mode)
    console.log("  🏃 Executing proofs in sandbox...");
    const sandboxResult = await executeInSandbox(code, { moduleHost, mode: "review" });

    // Collect proof verdicts from toolkit host
    const roundVerdicts = sandboxResult.proofVerdicts;

    if (!sandboxResult.success && roundVerdicts.length === 0) {
      console.log(`  ❌ Sandbox execution failed: ${sandboxResult.error}`);
      roundResults.push({
        round,
        hypotheses,
        generatedCode: code,
        validationPassed: true,
        sandboxResult,
        score: null,
        reviewScore: null,
        proofVerdicts: [],
        formattedScore: "",
      });
      continue;
    }

    allVerdicts.push(...roundVerdicts);

    // Step 7: Scorer — compute review metrics
    const { score: reviewScore, newFindings } = scoreReviewRound(roundVerdicts, hypotheses, allFindings);
    allFindings.push(...newFindings);
    const formattedScore = formatReviewScoreForReasoner(reviewScore, round);
    priorScoreSummary += (priorScoreSummary ? "\n\n" : "") + formattedScore;

    console.log(`\n  📊 Results:`);
    console.log(`     Hypotheses: ${reviewScore.hypotheses_total} | Confirmed: ${reviewScore.confirmed_count} | Refuted: ${reviewScore.refuted_count} | Inconclusive: ${reviewScore.inconclusive_count}`);
    console.log(`     Confirmation rate: ${(reviewScore.confirmation_rate * 100).toFixed(0)}% | Proof success rate: ${(reviewScore.proof_success_rate * 100).toFixed(0)}%`);
    console.log(`     Novel findings: ${reviewScore.novel_findings}`);

    // Print sandbox logs if any
    if (sandboxResult.logs.length > 0) {
      console.log(`\n  📝 Sandbox logs:`);
      for (const log of sandboxResult.logs) {
        console.log(`     ${log}`);
      }
    }

    roundResults.push({
      round,
      hypotheses,
      generatedCode: code,
      validationPassed: true,
      sandboxResult,
      score: null,
      reviewScore,
      proofVerdicts: roundVerdicts,
      formattedScore,
    });
  }

  return {
    rounds: roundResults,
    moduleExports: allExports,
    sourceCode,
    allVerdicts,
    allHypotheses,
    allFindings,
  };
}

// ---------------------------------------------------------------------------
// Design mode types (v0.3.0)
// ---------------------------------------------------------------------------

export interface DesignRunnerOptions {
  specPath: string;
  rounds: number;
  verbose: boolean;
}

export interface DesignRunResult {
  specSummary: NormalizedSpecSummary;
  allFindings: DesignFinding[];
  allScores: DesignScore[];
  allFidelityMismatches: FidelityMismatch[];
  allChangeLogs: ChangeJustification[];
  roundCount: number;
}

// ---------------------------------------------------------------------------
// Design mode (v0.3.0)
// ---------------------------------------------------------------------------

export async function runDesignMode(options: DesignRunnerOptions): Promise<DesignRunResult> {
  const { specPath, rounds, verbose } = options;

  // Step 1: Read spec file
  const specText = fs.readFileSync(specPath, "utf-8");
  console.log(`  📄 Spec loaded: ${specPath} (${Math.round(specText.length / 1024)}KB)`);

  // Step 2: Extract normalized spec summary
  console.log("  🔍 Extracting spec structure...");
  const { summary: specSummary } = await extractSpec({ specText });
  console.log(`  📋 Extracted: ${specSummary.endpoints.length} endpoints, ${specSummary.actors.length} actors, ${specSummary.invariants.length} invariants, ${specSummary.unknowns.length} unknowns`);

  if (specSummary.endpoints.length === 0) {
    console.log("  ⚠️  No endpoints found in spec. Cannot proceed.");
    return {
      specSummary,
      allFindings: [],
      allScores: [],
      allFidelityMismatches: [],
      allChangeLogs: [],
      roundCount: 0,
    };
  }

  const allFindings: DesignFinding[] = [];
  const allScores: DesignScore[] = [];
  const allFidelityMismatches: FidelityMismatch[] = [];
  const allChangeLogs: ChangeJustification[] = [];
  let currentModelCode = "";
  let currentAssumptions: Assumption[] = [];
  let currentCoverage: CoverageVector | undefined;

  for (let round = 1; round <= rounds; round++) {
    console.log(`\n── Round ${round} of ${rounds} ──────────────────────────────────\n`);

    // Step 3: Generate behavioral model
    console.log("  🧠 Generating behavioral model...");
    const modelResult = await generateDesignModel({
      specText,
      specSummary,
      round,
      priorModelCode: round > 1 ? currentModelCode : undefined,
      priorFindings: round > 1 ? allFindings : undefined,
      priorChangeLog: round > 1 ? allChangeLogs : undefined,
    });

    if (!modelResult.modelCode) {
      console.log("  ❌ Model generation returned no code. Skipping round.");
      continue;
    }

    currentModelCode = modelResult.modelCode;
    if (modelResult.changeLog.length > 0) {
      allChangeLogs.push(...modelResult.changeLog);
      console.log(`  ✏️  ${modelResult.changeLog.length} model changes logged`);
    }

    if (verbose) {
      console.log("\n  --- Generated Model ---");
      console.log(currentModelCode.slice(0, 2000) + (currentModelCode.length > 2000 ? "\n  ... (truncated)" : ""));
      console.log("  --- End Model ---\n");
    }

    // Step 4: Validate model code
    console.log("  🔒 Validating model code...");
    const modelValidation = validateGeneratedCode(currentModelCode, "generatedModel");
    if (!modelValidation.valid) {
      console.log(`  ❌ Model validation failed: ${modelValidation.reason}`);
      continue;
    }
    console.log("  ✅ Model validation passed");

    // Step 5: Fidelity check — model vs spec
    console.log("  📐 Checking model fidelity against spec...");
    const fidelityMismatches = checkFidelity({ specSummary, modelCode: currentModelCode });
    if (fidelityMismatches.length > 0) {
      console.log(`  ⚠️  ${fidelityMismatches.length} fidelity mismatch(es):`);
      for (const m of fidelityMismatches) {
        console.log(`     [${m.type}] ${m.description}`);
      }
      allFidelityMismatches.push(...fidelityMismatches);
    } else {
      console.log("  ✅ Model aligns with spec");
    }

    // Extract assumptions from model code (parse the assumptions array)
    try {
      // Simple extraction: look for assumptions array in the generated code
      const assumptionsMatch = currentModelCode.match(/const\s+assumptions\s*=\s*(\[[\s\S]*?\]);/);
      if (assumptionsMatch) {
        // Use Function constructor to safely evaluate just the assumptions array
        const evalFn = new Function(`return ${assumptionsMatch[1]};`);
        currentAssumptions = evalFn() as Assumption[];
        console.log(`  📝 ${currentAssumptions.length} assumption(s) extracted from model`);
      }
    } catch {
      console.log("  ⚠️  Could not extract assumptions from model code");
    }

    // Step 6: Generate attack sequences
    console.log("  ⚔️  Generating adversarial attacks...");
    const { attackCode } = await generateAttackCode({
      specText,
      specSummary,
      modelCode: currentModelCode,
      assumptions: currentAssumptions,
      round,
      priorFindings: round > 1 ? allFindings : undefined,
      priorCoverage: currentCoverage,
    });

    if (!attackCode) {
      console.log("  ❌ Attack generator returned no code. Skipping round.");
      continue;
    }

    if (verbose) {
      console.log("\n  --- Generated Attacks ---");
      console.log(attackCode);
      console.log("  --- End Attacks ---\n");
    }

    // Step 7: Validate attack code
    console.log("  🔒 Validating attack code...");
    const attackValidation = validateGeneratedCode(attackCode, "generatedAttacks");
    if (!attackValidation.valid) {
      console.log(`  ❌ Attack validation failed: ${attackValidation.reason}`);
      continue;
    }
    console.log("  ✅ Attack validation passed");

    // Step 8: Execute in sandbox (model + attacks)
    console.log("  🏃 Executing attacks against model...");
    const sandboxResult = await executeInSandbox(attackCode, {
      mode: "design",
      modelCode: currentModelCode,
    });

    if (!sandboxResult.success) {
      console.log(`  ❌ Sandbox execution failed: ${sandboxResult.error}`);
      continue;
    }

    // Step 9: Build findings from attack results
    const attackResult = sandboxResult.result as unknown as {
      trace: Array<Record<string, unknown>>;
      invariantFailures: Array<Record<string, unknown>>;
      annotations: string[];
      totalSteps: number;
    };

    if (!attackResult || !attackResult.trace) {
      console.log("  ⚠️  Attack returned no trace data");
      continue;
    }

    console.log(`  📊 Attack completed: ${attackResult.totalSteps} steps, ${attackResult.invariantFailures?.length ?? 0} invariant failures`);

    const roundFindings = buildFindings(
      attackResult as unknown as Parameters<typeof buildFindings>[0],
      currentAssumptions,
      specSummary,
      round,
      allFindings,
    );
    allFindings.push(...roundFindings);

    // Step 10: Compute coverage and score
    const coverage = computeCoverage(
      attackResult.trace as unknown as Parameters<typeof computeCoverage>[0],
      specSummary,
      currentCoverage,
    );
    currentCoverage = coverage;

    const score = scoreDesignRound(allFindings, coverage);
    allScores.push(score);

    const formattedScore = formatDesignScoreForReasoner(score, round);
    console.log(`\n${formattedScore}`);

    if (roundFindings.length > 0) {
      console.log(`\n  🎯 New findings this round:`);
      for (const f of roundFindings) {
        console.log(`     [${f.id}] ${f.category}/${f.severity}: ${f.observedBehavior.slice(0, 100)}`);
      }
    }

    // Print sandbox logs if any
    if (sandboxResult.logs.length > 0) {
      console.log(`\n  📝 Sandbox logs:`);
      for (const log of sandboxResult.logs) {
        console.log(`     ${log}`);
      }
    }
  }

  return {
    specSummary,
    allFindings,
    allScores,
    allFidelityMismatches,
    allChangeLogs,
    roundCount: rounds,
  };
}
