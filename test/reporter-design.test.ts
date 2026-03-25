import { describe, it, expect } from "vitest";
import { generateDesignReport } from "../src/reporter-design.js";
import type { DesignFinding, DesignScore, NormalizedSpecSummary } from "../src/types.js";

const sampleSpec: NormalizedSpecSummary = {
  endpoints: [
    { path: "/v1/items", method: "POST", description: "Create item" },
    { path: "/v1/items", method: "GET", description: "List items" },
  ],
  actors: [{ role: "admin", permissions: ["create"] }],
  resources: [{ name: "item", description: "A resource" }],
  stateVariables: [],
  businessRules: [],
  invariants: [{ id: "INV1", rule: "Items must be active" }],
  allowedTransitions: [],
  forbiddenTransitions: [],
  unknowns: [],
};

describe("generateDesignReport", () => {
  it("generates report with no findings", async () => {
    const report = await generateDesignReport({
      specSummary: sampleSpec,
      allFindings: [],
      allScores: [],
      allFidelityMismatches: [],
      allChangeLogs: [],
      roundCount: 1,
    });

    expect(report.summary).toContain("API DESIGN ADVERSARY REPORT");
    expect(report.summary).toContain("No findings detected");
    expect(report.summary).toContain("No design flaws detected");
  });

  it("generates report with findings and scores", async () => {
    const findings: DesignFinding[] = [
      {
        id: "F1-1",
        category: "high_confidence_flaw",
        severity: "critical",
        affectedEndpoints: ["POST /v1/items"],
        affectedRules: ["INV1"],
        assumptionsInvolved: [],
        sequenceTrace: [],
        expectedBehavior: "Items should be active",
        observedBehavior: "Item created with deleted status",
        invariantFailures: ["INV1"],
        reproducibilityStatus: "reproduced_once",
        attackAnnotations: ["Testing status validation"],
        hasAuthBypass: false,
      },
      {
        id: "F1-2",
        category: "ambiguity_risk",
        severity: "medium",
        affectedEndpoints: ["POST /v1/items"],
        affectedRules: [],
        assumptionsInvolved: ["A1"],
        sequenceTrace: [],
        expectedBehavior: "Concurrent creation handled",
        observedBehavior: "Spec silent on concurrency",
        invariantFailures: [],
        reproducibilityStatus: "reproduced_once",
        attackAnnotations: [],
        hasAuthBypass: false,
      },
    ];

    const scores: DesignScore[] = [{
      invariantViolations: 1,
      unauthorizedAccessPaths: 0,
      stateInconsistencies: 1,
      specAmbiguitiesSurfaced: 1,
      uniqueFindings: 2,
      attributionBreakdown: {
        high_confidence_flaw: 1,
        ambiguity_risk: 1,
        model_defect: 0,
        attack_defect: 0,
        inconclusive: 0,
      },
      coverage: {
        endpointsExercised: 2,
        endpointsTotal: 2,
        rolesExercised: 1,
        rolesTotal: 1,
        transitionsExercised: 0,
        transitionsTotal: 0,
        invariantsExercised: 1,
        invariantsTotal: 1,
        rejectionPathsExercised: 0,
        rejectionPathsTotal: 1,
      },
    }];

    const report = await generateDesignReport({
      specSummary: sampleSpec,
      allFindings: findings,
      allScores: scores,
      allFidelityMismatches: [],
      allChangeLogs: [],
      roundCount: 1,
    });

    expect(report.summary).toContain("CRITICAL");
    expect(report.summary).toContain("F1-1");
    expect(report.summary).toContain("high_confidence_flaw");
    expect(report.summary).toContain("ambiguity risk");
    expect(report.summary).toContain("INV1");
    expect(report.summary).toContain("Rules: INV1");
    expect(report.summary).toContain("Endpoints: 2/2");
    expect(report.summary).toContain("Transitions: 0/0");
    expect(report.summary).toContain("Testing status validation");
  });

  it("shows auth bypass indicator and all annotations", async () => {
    const findings: DesignFinding[] = [
      {
        id: "F1-1",
        category: "high_confidence_flaw",
        severity: "critical",
        affectedEndpoints: ["POST /v1/items"],
        affectedRules: ["R1"],
        assumptionsInvolved: [],
        sequenceTrace: [],
        expectedBehavior: "Should reject",
        observedBehavior: "Was allowed",
        invariantFailures: [],
        reproducibilityStatus: "reproduced_once",
        attackAnnotations: ["First note", "Second note"],
        hasAuthBypass: true,
      },
    ];

    const report = await generateDesignReport({
      specSummary: sampleSpec,
      allFindings: findings,
      allScores: [],
      allFidelityMismatches: [],
      allChangeLogs: [],
      roundCount: 1,
    });

    expect(report.summary).toContain("AUTH BYPASS");
    expect(report.summary).toContain("Rules: R1");
    expect(report.summary).toContain("First note; Second note");
  });

  it("includes fidelity mismatches in report", async () => {
    const report = await generateDesignReport({
      specSummary: sampleSpec,
      allFindings: [],
      allScores: [],
      allFidelityMismatches: [
        { type: "missing_handler", description: "No handler for POST /v1/items" },
      ],
      allChangeLogs: [],
      roundCount: 1,
    });

    expect(report.summary).toContain("Model Fidelity Issues");
    expect(report.summary).toContain("missing_handler");
  });

  it("includes model evolution changes in report", async () => {
    const report = await generateDesignReport({
      specSummary: sampleSpec,
      allFindings: [],
      allScores: [],
      allFidelityMismatches: [],
      allChangeLogs: [
        {
          what: "Fixed status validation",
          why: "Prior round found status bypass",
          specEvidence: "R1: Items must be active",
          promptedByAttack: true,
          classification: "bug_fix",
        },
      ],
      roundCount: 2,
    });

    expect(report.summary).toContain("Model Evolution");
    expect(report.summary).toContain("Fixed status validation");
    expect(report.summary).toContain("bug_fix");
  });
});
