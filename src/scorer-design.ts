// scorer-design.ts — Scoring, fidelity checking, and attribution for design mode.
//
// Three responsibilities:
// 1. Fidelity check: compare model against spec summary to find mismatches
// 2. Attribution: classify each finding into the right category
// 3. Scoring: compute aggregate metrics and coverage vectors

import type {
  NormalizedSpecSummary,
  FidelityMismatch,
  DesignFinding,
  DesignScore,
  CoverageVector,
  AttributionCategory,
  TraceEntry,
  InvariantResult,
  Assumption,
} from "./types.js";

// ---------------------------------------------------------------------------
// Fidelity checker — spec ↔ model alignment
// ---------------------------------------------------------------------------

export interface FidelityCheckInput {
  specSummary: NormalizedSpecSummary;
  modelCode: string;
}

export function checkFidelity(input: FidelityCheckInput): FidelityMismatch[] {
  const mismatches: FidelityMismatch[] = [];
  const { specSummary, modelCode } = input;

  // Check 1: Every endpoint should have a handler
  for (const endpoint of specSummary.endpoints) {
    const handlerKey = `${endpoint.method} ${endpoint.path}`;
    // Check for the handler key in various formats
    const hasHandler =
      modelCode.includes(`"${handlerKey}"`) ||
      modelCode.includes(`'${handlerKey}'`) ||
      modelCode.includes(`\`${handlerKey}\``);

    if (!hasHandler) {
      mismatches.push({
        type: "missing_handler",
        description: `No handler found for endpoint: ${handlerKey}`,
        specItem: handlerKey,
      });
    }
  }

  // Check 2: Every invariant should have a corresponding check
  for (const inv of specSummary.invariants) {
    const hasCheck =
      modelCode.includes(`"${inv.id}"`) ||
      modelCode.includes(`'${inv.id}'`) ||
      modelCode.includes(`id: "${inv.id}"`) ||
      modelCode.includes(`id: '${inv.id}'`);

    if (!hasCheck) {
      mismatches.push({
        type: "missing_rule_mapping",
        description: `No invariant check found for: ${inv.id} — ${inv.rule}`,
        specItem: inv.id,
      });
    }
  }

  // Check 3: Look for handlers that don't match any spec endpoint
  const handlerPattern = /["'`]((?:GET|POST|PUT|PATCH|DELETE)\s+\/[^"'`]+)["'`]/g;
  let match;
  while ((match = handlerPattern.exec(modelCode)) !== null) {
    const handlerKey = match[1];
    const hasEndpoint = specSummary.endpoints.some(
      e => `${e.method} ${e.path}` === handlerKey,
    );
    if (!hasEndpoint) {
      mismatches.push({
        type: "extra_handler",
        description: `Handler exists for endpoint not in spec: ${handlerKey}`,
        modelItem: handlerKey,
      });
    }
  }

  return mismatches;
}

// ---------------------------------------------------------------------------
// Attribution — classify findings
// ---------------------------------------------------------------------------

export function attributeFinding(
  trace: TraceEntry[],
  invariantFailures: InvariantResult[],
  assumptions: Assumption[],
): AttributionCategory {
  // If invariants failed AND trace has valid requests, likely a real spec flaw
  const hasInvariantFailures = invariantFailures.length > 0;
  const hasHandlerErrors = trace.some(t => t.type === "handler_error" || t.type === "handler_shape_error");
  const hasUnknownHandlers = trace.some(t => t.type === "unknown_handler");

  // Attack defect: trace has errors suggesting the attack code was wrong
  if (hasUnknownHandlers && !hasInvariantFailures) {
    return "attack_defect";
  }

  // Model defect: handler threw errors, suggesting model bugs
  if (hasHandlerErrors && !hasInvariantFailures) {
    return "model_defect";
  }

  // Check if the failure involves any low-confidence assumption
  const involvedAssumptionIds = new Set<string>();
  for (const entry of trace) {
    if (entry.type === "annotation" && entry.message) {
      for (const assumption of assumptions) {
        if (entry.message.includes(assumption.id)) {
          involvedAssumptionIds.add(assumption.id);
        }
      }
    }
  }

  const lowConfidenceAssumptions = assumptions.filter(
    a => involvedAssumptionIds.has(a.id) && a.confidence === "low",
  );

  // Ambiguity risk: finding involves low-confidence assumptions
  if (hasInvariantFailures && lowConfidenceAssumptions.length > 0) {
    return "ambiguity_risk";
  }

  // High confidence flaw: invariants violated with no model/attack errors
  if (hasInvariantFailures && !hasHandlerErrors && !hasUnknownHandlers) {
    return "high_confidence_flaw";
  }

  // If both handler errors AND invariant failures, could be model or spec
  if (hasInvariantFailures && hasHandlerErrors) {
    return "model_defect";
  }

  return "inconclusive";
}

// ---------------------------------------------------------------------------
// Coverage computation
// ---------------------------------------------------------------------------

export function computeCoverage(
  trace: TraceEntry[],
  specSummary: NormalizedSpecSummary,
  priorCoverage?: CoverageVector,
): CoverageVector {
  // Collect exercised endpoints
  const exercisedEndpoints = new Set<string>();
  const exercisedRoles = new Set<string>();
  const exercisedInvariants = new Set<string>();
  let rejectionPaths = 0;

  for (const entry of trace) {
    if (entry.type === "request" && entry.endpoint) {
      exercisedEndpoints.add(entry.endpoint);
      // Extract role from body if present
      const body = entry.body as Record<string, unknown> | undefined;
      if (body && typeof body.callerRole === "string") {
        exercisedRoles.add(body.callerRole);
      }
    }

    if (entry.type === "expect_rejected") {
      rejectionPaths++;
    }

    if (entry.type === "invariant_check" && entry.invariantResults) {
      for (const ir of entry.invariantResults) {
        exercisedInvariants.add(ir.id);
      }
    }

    // Also count invariants checked via request traces
    if (entry.invariantResults) {
      for (const ir of entry.invariantResults) {
        exercisedInvariants.add(ir.id);
      }
    }
  }

  // Merge with prior coverage
  if (priorCoverage) {
    // We track cumulative — use max of current or prior
    return {
      endpointsExercised: Math.max(exercisedEndpoints.size, priorCoverage.endpointsExercised),
      endpointsTotal: specSummary.endpoints.length,
      rolesExercised: Math.max(exercisedRoles.size, priorCoverage.rolesExercised),
      rolesTotal: specSummary.actors.length,
      transitionsExercised: priorCoverage.transitionsExercised, // hard to track precisely
      transitionsTotal: specSummary.allowedTransitions.length,
      invariantsExercised: Math.max(exercisedInvariants.size, priorCoverage.invariantsExercised),
      invariantsTotal: specSummary.invariants.length,
      rejectionPathsExercised: rejectionPaths + priorCoverage.rejectionPathsExercised,
      rejectionPathsTotal: specSummary.forbiddenTransitions.length + specSummary.actors.length, // estimate
    };
  }

  return {
    endpointsExercised: exercisedEndpoints.size,
    endpointsTotal: specSummary.endpoints.length,
    rolesExercised: exercisedRoles.size,
    rolesTotal: specSummary.actors.length,
    transitionsExercised: 0,
    transitionsTotal: specSummary.allowedTransitions.length,
    invariantsExercised: exercisedInvariants.size,
    invariantsTotal: specSummary.invariants.length,
    rejectionPathsExercised: rejectionPaths,
    rejectionPathsTotal: specSummary.forbiddenTransitions.length + specSummary.actors.length,
  };
}

// ---------------------------------------------------------------------------
// Build DesignFinding from attack result
// ---------------------------------------------------------------------------

export function buildFindings(
  attackResult: {
    trace: TraceEntry[];
    invariantFailures: InvariantResult[];
    annotations: string[];
    totalSteps: number;
  },
  assumptions: Assumption[],
  specSummary: NormalizedSpecSummary,
  round: number,
  existingFindings: DesignFinding[],
): DesignFinding[] {
  const findings: DesignFinding[] = [];

  // Group trace by reset boundaries (each api.reset() starts a new sequence)
  const sequences: TraceEntry[][] = [];
  let currentSequence: TraceEntry[] = [];

  for (const entry of attackResult.trace) {
    // Detect reset boundaries — step 1 after a reset
    if (entry.step === 1 && currentSequence.length > 0) {
      sequences.push(currentSequence);
      currentSequence = [];
    }
    currentSequence.push(entry);
  }
  if (currentSequence.length > 0) {
    sequences.push(currentSequence);
  }

  // Analyze each sequence for findings
  for (const seq of sequences) {
    const seqInvariantFailures: InvariantResult[] = [];
    const seqEndpoints: string[] = [];
    const seqAnnotations: string[] = [];
    let hasExpectRejectedFail = false;
    let hasExpectAllowedFail = false;

    for (const entry of seq) {
      if (entry.endpoint) {
        seqEndpoints.push(entry.endpoint);
      }
      if (entry.type === "annotation" && entry.message) {
        seqAnnotations.push(entry.message);
      }
      if (entry.invariantResults) {
        for (const ir of entry.invariantResults) {
          if (!ir.holds) {
            seqInvariantFailures.push(ir);
          }
        }
      }
      if (entry.type === "expect_rejected") {
        const resp = entry.response as Record<string, unknown> | undefined;
        const wasRejected = resp && (
          (typeof resp.status === "number" && resp.status >= 400) ||
          resp.error ||
          resp.rejected === true
        );
        if (!wasRejected) {
          hasExpectRejectedFail = true;
        }
      }
      if (entry.type === "expect_allowed") {
        const resp = entry.response as Record<string, unknown> | undefined;
        const wasAllowed = resp && !resp.error &&
          (resp.status === undefined || (typeof resp.status === "number" && resp.status < 400)) &&
          resp.rejected !== true;
        if (!wasAllowed) {
          hasExpectAllowedFail = true;
        }
      }
    }

    // Determine if this sequence produced a finding
    const hasFinding = seqInvariantFailures.length > 0 || hasExpectRejectedFail || hasExpectAllowedFail;
    if (!hasFinding) continue;

    // Check for duplicate findings
    const uniqueEndpoints = [...new Set(seqEndpoints)];
    const failedInvIds = [...new Set(seqInvariantFailures.map(f => f.id))];
    const isDuplicate = existingFindings.some(
      ef => ef.affectedEndpoints.sort().join(",") === uniqueEndpoints.sort().join(",") &&
        ef.invariantFailures.sort().join(",") === failedInvIds.sort().join(","),
    );
    if (isDuplicate) continue;

    // Build the finding
    const category = attributeFinding(seq, seqInvariantFailures, assumptions);
    const severity = categorizeSeverity(seqInvariantFailures, hasExpectRejectedFail, hasExpectAllowedFail);

    // Find affected rules from invariant failures
    const affectedRules: string[] = [];
    for (const failure of seqInvariantFailures) {
      const specInv = specSummary.invariants.find(inv => inv.id === failure.id);
      if (specInv) {
        affectedRules.push(specInv.id);
      }
    }

    // Find involved assumptions
    const involvedAssumptions: string[] = [];
    for (const anno of seqAnnotations) {
      for (const assumption of assumptions) {
        if (anno.includes(assumption.id)) {
          involvedAssumptions.push(assumption.id);
        }
      }
    }

    const findingId = `F${round}-${findings.length + existingFindings.length + 1}`;

    findings.push({
      id: findingId,
      category,
      severity,
      affectedEndpoints: uniqueEndpoints,
      affectedRules,
      assumptionsInvolved: involvedAssumptions,
      sequenceTrace: seq,
      expectedBehavior: hasExpectRejectedFail
        ? "Request should have been rejected"
        : seqInvariantFailures.length > 0
          ? `Invariants should hold: ${failedInvIds.join(", ")}`
          : "Operation should have succeeded",
      observedBehavior: seqInvariantFailures.length > 0
        ? `Invariant violations: ${seqInvariantFailures.map(f => `${f.id}: ${f.violation ?? "failed"}`).join("; ")}`
        : hasExpectRejectedFail
          ? "Request was allowed when it should have been rejected"
          : "Operation failed when it should have succeeded",
      invariantFailures: failedInvIds,
      reproducibilityStatus: "reproduced_once",
      attackAnnotations: seqAnnotations,
    });
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Severity categorization
// ---------------------------------------------------------------------------

function categorizeSeverity(
  invariantFailures: InvariantResult[],
  hasAuthBypass: boolean,
  hasExpectAllowedFail?: boolean,
): "critical" | "high" | "medium" | "low" | "informational" {
  if (hasAuthBypass) return "critical";
  if (invariantFailures.length >= 3) return "critical";
  if (invariantFailures.length >= 1) return "high";
  if (hasExpectAllowedFail) return "medium";
  // No invariant failures, no auth bypass, no allowed-fail — low signal
  return "low";
}

// ---------------------------------------------------------------------------
// Aggregate scoring
// ---------------------------------------------------------------------------

export function scoreDesignRound(
  findings: DesignFinding[],
  coverage: CoverageVector,
): DesignScore {
  const attributionBreakdown: Record<AttributionCategory, number> = {
    high_confidence_flaw: 0,
    ambiguity_risk: 0,
    model_defect: 0,
    attack_defect: 0,
    inconclusive: 0,
  };

  let invariantViolations = 0;
  let unauthorizedAccessPaths = 0;
  let stateInconsistencies = 0;
  let specAmbiguitiesSurfaced = 0;

  for (const finding of findings) {
    attributionBreakdown[finding.category]++;

    if (finding.invariantFailures.length > 0) {
      invariantViolations += finding.invariantFailures.length;
    }

    if (finding.category === "high_confidence_flaw" &&
      finding.observedBehavior.includes("allowed when it should have been rejected")) {
      unauthorizedAccessPaths++;
    }

    if (finding.category === "high_confidence_flaw" && finding.invariantFailures.length > 0) {
      stateInconsistencies++;
    }

    if (finding.category === "ambiguity_risk") {
      specAmbiguitiesSurfaced++;
    }
  }

  return {
    invariantViolations,
    unauthorizedAccessPaths,
    stateInconsistencies,
    specAmbiguitiesSurfaced,
    uniqueFindings: findings.length,
    attributionBreakdown,
    coverage,
  };
}

// ---------------------------------------------------------------------------
// Format score for reasoner feedback
// ---------------------------------------------------------------------------

export function formatDesignScoreForReasoner(score: DesignScore, round: number): string {
  const lines = [
    `Round ${round} Design Review:`,
    `  Unique findings: ${score.uniqueFindings}`,
    `  Invariant violations: ${score.invariantViolations}`,
    `  Unauthorized access paths: ${score.unauthorizedAccessPaths}`,
    `  State inconsistencies: ${score.stateInconsistencies}`,
    `  Spec ambiguities surfaced: ${score.specAmbiguitiesSurfaced}`,
    `  Attribution: ${Object.entries(score.attributionBreakdown).map(([k, v]) => `${k}=${v}`).join(", ")}`,
    `  Coverage: endpoints ${score.coverage.endpointsExercised}/${score.coverage.endpointsTotal}, ` +
    `roles ${score.coverage.rolesExercised}/${score.coverage.rolesTotal}, ` +
    `invariants ${score.coverage.invariantsExercised}/${score.coverage.invariantsTotal}`,
  ];
  return lines.join("\n");
}
