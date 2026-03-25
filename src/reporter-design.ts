// reporter-design.ts — Generates the final design review report.
//
// Summarizes findings, coverage, attribution breakdown, and evidence packets
// for the design adversary mode.

import type {
  DesignFinding,
  DesignScore,
  NormalizedSpecSummary,
  ChangeJustification,
  FidelityMismatch,
} from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DesignReportInput {
  specSummary: NormalizedSpecSummary;
  allFindings: DesignFinding[];
  allScores: DesignScore[];
  allFidelityMismatches: FidelityMismatch[];
  allChangeLogs: ChangeJustification[];
  roundCount: number;
}

export interface DesignReportOutput {
  summary: string;
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

export function generateDesignReport(input: DesignReportInput): DesignReportOutput {
  const lines: string[] = [];

  lines.push("API DESIGN ADVERSARY REPORT");
  lines.push("═".repeat(55));
  lines.push("");

  // Summary stats — aggregate across all per-round scores
  const lastScore = input.allScores[input.allScores.length - 1];
  lines.push(`Rounds: ${input.roundCount}`);
  lines.push(`Total unique findings: ${input.allFindings.length}`);

  if (input.allScores.length > 0) {
    // Sum metrics across all rounds (each score is now per-round, not cumulative)
    let totalInvariantViolations = 0;
    let totalUnauthorizedAccessPaths = 0;
    let totalStateInconsistencies = 0;
    let totalSpecAmbiguities = 0;
    const totalAttribution: Record<string, number> = {};

    for (const score of input.allScores) {
      totalInvariantViolations += score.invariantViolations;
      totalUnauthorizedAccessPaths += score.unauthorizedAccessPaths;
      totalStateInconsistencies += score.stateInconsistencies;
      totalSpecAmbiguities += score.specAmbiguitiesSurfaced;
      for (const [cat, count] of Object.entries(score.attributionBreakdown)) {
        totalAttribution[cat] = (totalAttribution[cat] ?? 0) + count;
      }
    }

    lines.push(`Invariant violations: ${totalInvariantViolations}`);
    lines.push(`Unauthorized access paths: ${totalUnauthorizedAccessPaths}`);
    lines.push(`State inconsistencies: ${totalStateInconsistencies}`);
    lines.push(`Spec ambiguities surfaced: ${totalSpecAmbiguities}`);
    lines.push("");

    // Attribution breakdown (aggregated)
    lines.push("Attribution Breakdown:");
    for (const [category, count] of Object.entries(totalAttribution)) {
      if (count > 0) {
        lines.push(`  ${category}: ${count}`);
      }
    }
    lines.push("");

    // Coverage — use last round's coverage (cumulative union already)
    const cov = lastScore?.coverage;
    if (cov) {
      lines.push("Coverage:");
      lines.push(`  Endpoints: ${cov.endpointsExercised}/${cov.endpointsTotal} (${pct(cov.endpointsExercised, cov.endpointsTotal)})`);
      lines.push(`  Roles: ${cov.rolesExercised}/${cov.rolesTotal} (${pct(cov.rolesExercised, cov.rolesTotal)})`);
      lines.push(`  Transitions: ${cov.transitionsExercised}/${cov.transitionsTotal} (${pct(cov.transitionsExercised, cov.transitionsTotal)})`);
      lines.push(`  Invariants: ${cov.invariantsExercised}/${cov.invariantsTotal} (${pct(cov.invariantsExercised, cov.invariantsTotal)})`);
      lines.push(`  Rejection paths: ${cov.rejectionPathsExercised}/${cov.rejectionPathsTotal}`);
    }
    lines.push("");
  }

  // Fidelity mismatches
  if (input.allFidelityMismatches.length > 0) {
    lines.push("Model Fidelity Issues:");
    for (const m of input.allFidelityMismatches) {
      lines.push(`  ⚠️  [${m.type}] ${m.description}`);
    }
    lines.push("");
  }

  // Findings (sorted by severity)
  if (input.allFindings.length > 0) {
    const severityOrder = ["critical", "high", "medium", "low", "informational"];
    const sorted = [...input.allFindings].sort(
      (a, b) => severityOrder.indexOf(a.severity) - severityOrder.indexOf(b.severity),
    );

    lines.push("Findings:");
    lines.push("─".repeat(55));
    for (const f of sorted) {
      const icon = f.severity === "critical" ? "🔴" : f.severity === "high" ? "🟠" : f.severity === "medium" ? "🟡" : "🟢";
      lines.push(`${icon} [${f.id}] ${f.severity.toUpperCase()} — ${f.category}`);
      if (f.hasAuthBypass) {
        lines.push(`   🔓 AUTH BYPASS — request allowed when it should have been rejected`);
      }
      lines.push(`   Endpoints: ${f.affectedEndpoints.join(", ")}`);
      if (f.affectedRules.length > 0) {
        lines.push(`   Rules: ${f.affectedRules.join(", ")}`);
      }
      lines.push(`   Expected: ${f.expectedBehavior}`);
      lines.push(`   Observed: ${f.observedBehavior}`);
      if (f.invariantFailures.length > 0) {
        lines.push(`   Invariants violated: ${f.invariantFailures.join(", ")}`);
      }
      if (f.assumptionsInvolved.length > 0) {
        lines.push(`   Assumptions: ${f.assumptionsInvolved.join(", ")}`);
      }
      if (f.attackAnnotations.length > 0) {
        lines.push(`   Notes: ${f.attackAnnotations.join("; ")}`);
      }
      lines.push("");
    }
  } else {
    lines.push("No findings detected.");
    lines.push("");
  }

  // Model evolution (if refinements happened)
  if (input.allChangeLogs.length > 0) {
    lines.push("Model Evolution:");
    lines.push("─".repeat(55));
    for (const change of input.allChangeLogs) {
      const icon = change.classification === "suspicious_adaptation" ? "⚠️" : "✏️";
      lines.push(`${icon} [${change.classification}] ${change.what}`);
      lines.push(`   Why: ${change.why}`);
      lines.push(`   Evidence: ${change.specEvidence}`);
      lines.push(`   Prompted by attack: ${change.promptedByAttack ? "yes" : "no"}`);
      lines.push("");
    }
  }

  // Final verdict
  lines.push("─".repeat(55));
  if (input.allFindings.length === 0) {
    lines.push("✅ No design flaws detected in the examined attack surface.");
  } else {
    const criticalCount = input.allFindings.filter(f => f.severity === "critical").length;
    const highCount = input.allFindings.filter(f => f.severity === "high").length;
    const flawCount = input.allFindings.filter(f => f.category === "high_confidence_flaw").length;
    const ambiguityCount = input.allFindings.filter(f => f.category === "ambiguity_risk").length;

    if (criticalCount > 0) {
      lines.push(`🔴 ${criticalCount} CRITICAL finding(s) require immediate attention.`);
    }
    if (highCount > 0) {
      lines.push(`🟠 ${highCount} HIGH severity finding(s) should be reviewed.`);
    }
    if (flawCount > 0) {
      lines.push(`📋 ${flawCount} high-confidence spec flaw(s) identified.`);
    }
    if (ambiguityCount > 0) {
      lines.push(`❓ ${ambiguityCount} ambiguity risk(s) — spec should clarify.`);
    }
  }

  return { summary: lines.join("\n") };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pct(n: number, total: number): string {
  if (total === 0) return "N/A";
  return `${Math.round((n / total) * 100)}%`;
}
