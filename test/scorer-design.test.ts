import { describe, it, expect } from "vitest";
import {
  checkFidelity,
  attributeFinding,
  computeCoverage,
  buildFindings,
  scoreDesignRound,
  formatDesignScoreForReasoner,
} from "../src/scorer-design.js";
import type {
  NormalizedSpecSummary,
  TraceEntry,
  InvariantResult,
  Assumption,
  DesignFinding,
  CoverageVector,
} from "../src/types.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const sampleSpec: NormalizedSpecSummary = {
  endpoints: [
    { path: "/v1/identities", method: "POST", description: "Create identity" },
    { path: "/v1/identities/:id", method: "GET", description: "Get identity" },
    { path: "/v1/bonds", method: "POST", description: "Create bond" },
    { path: "/v1/execute", method: "POST", description: "Execute action" },
  ],
  actors: [
    { role: "admin", permissions: ["create_identity", "suspend_identity"] },
    { role: "holder", permissions: ["create_bond", "execute_action"] },
    { role: "observer", permissions: ["view_identity"] },
  ],
  resources: [{ name: "identity", description: "A digital identity" }],
  stateVariables: [{ name: "identity.status", description: "active or suspended" }],
  invariants: [
    { id: "INV1", rule: "Used amount never exceeds bonded amount" },
    { id: "INV2", rule: "No action references nonexistent bond" },
    { id: "INV3", rule: "Every bond references existing identity" },
  ],
  allowedTransitions: [
    { from: "active", to: "suspended", trigger: "admin suspends" },
  ],
  forbiddenTransitions: [
    { description: "Suspended to active", reason: "No reactivation" },
  ],
  unknowns: [
    { description: "What happens if admin tries to create bond?" },
  ],
};

const sampleAssumptions: Assumption[] = [
  {
    id: "A1",
    text: "Admin bond creation returns 403",
    specRef: "R5",
    confidence: "low",
    kind: "ambiguity",
    relatedRules: ["R5"],
  },
  {
    id: "A2",
    text: "Suspended identities cannot be reactivated",
    specRef: "Ambiguity 2",
    confidence: "medium",
    kind: "inferred_rule",
    relatedRules: [],
  },
];

// ---------------------------------------------------------------------------
// checkFidelity tests
// ---------------------------------------------------------------------------

describe("checkFidelity", () => {
  it("finds missing handlers", () => {
    const modelCode = `
      const handlers = {
        "POST /v1/identities": function(state, req) { return { nextState: state, response: {} }; },
        "GET /v1/identities/:id": function(state, req) { return { nextState: state, response: {} }; },
      };
    `;
    const mismatches = checkFidelity({ specSummary: sampleSpec, modelCode });

    const missingHandlers = mismatches.filter(m => m.type === "missing_handler");
    expect(missingHandlers.length).toBe(2); // POST /v1/bonds and POST /v1/execute
  });

  it("finds missing invariant mappings", () => {
    const modelCode = `
      const handlers = {
        "POST /v1/identities": function(s, r) { return { nextState: s, response: {} }; },
        "GET /v1/identities/:id": function(s, r) { return { nextState: s, response: {} }; },
        "POST /v1/bonds": function(s, r) { return { nextState: s, response: {} }; },
        "POST /v1/execute": function(s, r) { return { nextState: s, response: {} }; },
      };
      const invariants = [
        { id: "INV1", check: function(s) { return { holds: true }; } },
      ];
    `;
    const mismatches = checkFidelity({ specSummary: sampleSpec, modelCode });

    const missingRules = mismatches.filter(m => m.type === "missing_rule_mapping");
    expect(missingRules.length).toBe(2); // INV2 and INV3
  });

  it("finds extra handlers not in spec", () => {
    const modelCode = `
      const handlers = {
        "POST /v1/identities": function(s, r) { return { nextState: s, response: {} }; },
        "GET /v1/identities/:id": function(s, r) { return { nextState: s, response: {} }; },
        "POST /v1/bonds": function(s, r) { return { nextState: s, response: {} }; },
        "POST /v1/execute": function(s, r) { return { nextState: s, response: {} }; },
        "DELETE /v1/identities/:id": function(s, r) { return { nextState: s, response: {} }; },
      };
      const invariants = [
        { id: "INV1" }, { id: "INV2" }, { id: "INV3" },
      ];
    `;
    const mismatches = checkFidelity({ specSummary: sampleSpec, modelCode });

    const extraHandlers = mismatches.filter(m => m.type === "extra_handler");
    expect(extraHandlers.length).toBe(1);
    expect(extraHandlers[0].modelItem).toContain("DELETE");
  });

  it("returns empty array for fully aligned model", () => {
    const modelCode = `
      const handlers = {
        "POST /v1/identities": function(s, r) { return { nextState: s, response: {} }; },
        "GET /v1/identities/:id": function(s, r) { return { nextState: s, response: {} }; },
        "POST /v1/bonds": function(s, r) { return { nextState: s, response: {} }; },
        "POST /v1/execute": function(s, r) { return { nextState: s, response: {} }; },
      };
      const invariants = [
        { id: "INV1" }, { id: "INV2" }, { id: "INV3" },
      ];
    `;
    const mismatches = checkFidelity({ specSummary: sampleSpec, modelCode });
    expect(mismatches.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// attributeFinding tests
// ---------------------------------------------------------------------------

describe("attributeFinding", () => {
  it("returns attack_defect for unknown handlers without invariant failures", () => {
    const trace: TraceEntry[] = [
      { step: 1, type: "unknown_handler", endpoint: "POST /v1/bad", error: "No handler" },
    ];
    expect(attributeFinding(trace, [], sampleAssumptions)).toBe("attack_defect");
  });

  it("returns model_defect for handler errors without invariant failures", () => {
    const trace: TraceEntry[] = [
      { step: 1, type: "handler_error", endpoint: "POST /v1/bonds", error: "TypeError" },
    ];
    expect(attributeFinding(trace, [], sampleAssumptions)).toBe("model_defect");
  });

  it("returns high_confidence_flaw for invariant failures without errors", () => {
    const trace: TraceEntry[] = [
      { step: 1, type: "request", endpoint: "POST /v1/bonds" },
    ];
    const failures: InvariantResult[] = [{ id: "INV1", holds: false, violation: "Exceeded" }];
    expect(attributeFinding(trace, failures, sampleAssumptions)).toBe("high_confidence_flaw");
  });

  it("returns ambiguity_risk when low-confidence assumption is involved", () => {
    const trace: TraceEntry[] = [
      { step: 1, type: "annotation", message: "Testing A1 assumption" },
      { step: 2, type: "request", endpoint: "POST /v1/bonds" },
    ];
    const failures: InvariantResult[] = [{ id: "INV1", holds: false }];
    expect(attributeFinding(trace, failures, sampleAssumptions)).toBe("ambiguity_risk");
  });

  it("returns inconclusive for no failures or errors", () => {
    const trace: TraceEntry[] = [
      { step: 1, type: "request", endpoint: "POST /v1/bonds" },
    ];
    expect(attributeFinding(trace, [], sampleAssumptions)).toBe("inconclusive");
  });
});

// ---------------------------------------------------------------------------
// computeCoverage tests
// ---------------------------------------------------------------------------

describe("computeCoverage", () => {
  it("counts exercised endpoints and roles", () => {
    const trace: TraceEntry[] = [
      { step: 1, type: "request", endpoint: "POST /v1/identities", body: { callerRole: "admin" } },
      { step: 2, type: "request", endpoint: "POST /v1/bonds", body: { callerRole: "holder" } },
    ];

    const coverage = computeCoverage(trace, sampleSpec);
    expect(coverage.endpointsExercised).toBe(2);
    expect(coverage.endpointsTotal).toBe(4);
    expect(coverage.rolesExercised).toBe(2);
    expect(coverage.rolesTotal).toBe(3);
  });

  it("counts invariants exercised", () => {
    const trace: TraceEntry[] = [
      { step: 1, type: "invariant_check", invariantResults: [{ id: "INV1", holds: true }] },
      { step: 2, type: "request", endpoint: "POST /v1/bonds", invariantResults: [{ id: "INV2", holds: true }] },
    ];

    const coverage = computeCoverage(trace, sampleSpec);
    expect(coverage.invariantsExercised).toBe(2);
    expect(coverage.invariantsTotal).toBe(3);
  });

  it("counts rejection paths", () => {
    const trace: TraceEntry[] = [
      { step: 1, type: "expect_rejected", response: { status: 403 } },
      { step: 2, type: "expect_rejected", response: { status: 400 } },
    ];

    const coverage = computeCoverage(trace, sampleSpec);
    expect(coverage.rejectionPathsExercised).toBe(2);
  });

  it("merges with prior coverage", () => {
    const trace: TraceEntry[] = [
      { step: 1, type: "request", endpoint: "POST /v1/execute", body: { callerRole: "holder" } },
    ];

    const prior: CoverageVector = {
      endpointsExercised: 2,
      endpointsTotal: 4,
      rolesExercised: 2,
      rolesTotal: 3,
      transitionsExercised: 1,
      transitionsTotal: 1,
      invariantsExercised: 1,
      invariantsTotal: 3,
      rejectionPathsExercised: 1,
      rejectionPathsTotal: 4,
    };

    const coverage = computeCoverage(trace, sampleSpec, prior);
    expect(coverage.endpointsExercised).toBe(2); // max(1, 2)
    expect(coverage.transitionsExercised).toBe(1); // preserved from prior
  });
});

// ---------------------------------------------------------------------------
// buildFindings tests
// ---------------------------------------------------------------------------

describe("buildFindings", () => {
  it("creates finding for invariant violation", () => {
    const attackResult = {
      trace: [
        { step: 1, type: "request" as const, endpoint: "POST /v1/bonds", body: { callerRole: "admin" }, response: { status: 201 }, stateSnapshot: {}, invariantResults: [{ id: "INV1", holds: false, violation: "Exceeded" }] },
      ],
      invariantFailures: [{ id: "INV1", holds: false, violation: "Exceeded" }],
      annotations: [],
      totalSteps: 1,
    };

    const findings = buildFindings(attackResult, sampleAssumptions, sampleSpec, 1, []);
    expect(findings.length).toBe(1);
    expect(findings[0].invariantFailures).toContain("INV1");
    expect(findings[0].severity).toBe("high");
  });

  it("deduplicates findings with same endpoints and invariants", () => {
    const attackResult = {
      trace: [
        { step: 1, type: "request" as const, endpoint: "POST /v1/bonds", invariantResults: [{ id: "INV1", holds: false }] },
      ],
      invariantFailures: [{ id: "INV1", holds: false }],
      annotations: [],
      totalSteps: 1,
    };

    const existing: DesignFinding[] = [{
      id: "F1-1",
      category: "high_confidence_flaw",
      severity: "high",
      affectedEndpoints: ["POST /v1/bonds"],
      affectedRules: ["INV1"],
      assumptionsInvolved: [],
      sequenceTrace: [],
      expectedBehavior: "test",
      observedBehavior: "test",
      invariantFailures: ["INV1"],
      reproducibilityStatus: "reproduced_once",
      attackAnnotations: [],
    }];

    const findings = buildFindings(attackResult, sampleAssumptions, sampleSpec, 2, existing);
    expect(findings.length).toBe(0); // deduplicated
  });

  it("skips sequences with no findings", () => {
    const attackResult = {
      trace: [
        { step: 1, type: "request" as const, endpoint: "POST /v1/identities", response: { status: 201 }, invariantResults: [{ id: "INV1", holds: true }] },
      ],
      invariantFailures: [],
      annotations: [],
      totalSteps: 1,
    };

    const findings = buildFindings(attackResult, sampleAssumptions, sampleSpec, 1, []);
    expect(findings.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// scoreDesignRound tests
// ---------------------------------------------------------------------------

describe("scoreDesignRound", () => {
  it("computes aggregate scores", () => {
    const findings: DesignFinding[] = [
      {
        id: "F1-1",
        category: "high_confidence_flaw",
        severity: "critical",
        affectedEndpoints: ["POST /v1/bonds"],
        affectedRules: ["INV1"],
        assumptionsInvolved: [],
        sequenceTrace: [],
        expectedBehavior: "test",
        observedBehavior: "Request was allowed when it should have been rejected",
        invariantFailures: ["INV1"],
        reproducibilityStatus: "reproduced_once",
        attackAnnotations: [],
      },
      {
        id: "F1-2",
        category: "ambiguity_risk",
        severity: "medium",
        affectedEndpoints: ["POST /v1/execute"],
        affectedRules: [],
        assumptionsInvolved: ["A1"],
        sequenceTrace: [],
        expectedBehavior: "test",
        observedBehavior: "test",
        invariantFailures: [],
        reproducibilityStatus: "reproduced_once",
        attackAnnotations: [],
      },
    ];

    const coverage: CoverageVector = {
      endpointsExercised: 3,
      endpointsTotal: 4,
      rolesExercised: 2,
      rolesTotal: 3,
      transitionsExercised: 0,
      transitionsTotal: 1,
      invariantsExercised: 2,
      invariantsTotal: 3,
      rejectionPathsExercised: 1,
      rejectionPathsTotal: 4,
    };

    const score = scoreDesignRound(findings, coverage);
    expect(score.uniqueFindings).toBe(2);
    expect(score.invariantViolations).toBe(1);
    expect(score.unauthorizedAccessPaths).toBe(1);
    expect(score.specAmbiguitiesSurfaced).toBe(1);
    expect(score.attributionBreakdown.high_confidence_flaw).toBe(1);
    expect(score.attributionBreakdown.ambiguity_risk).toBe(1);
    expect(score.coverage.endpointsExercised).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// formatDesignScoreForReasoner tests
// ---------------------------------------------------------------------------

describe("formatDesignScoreForReasoner", () => {
  it("produces human-readable format", () => {
    const score = scoreDesignRound([], {
      endpointsExercised: 2,
      endpointsTotal: 4,
      rolesExercised: 1,
      rolesTotal: 3,
      transitionsExercised: 0,
      transitionsTotal: 1,
      invariantsExercised: 0,
      invariantsTotal: 3,
      rejectionPathsExercised: 0,
      rejectionPathsTotal: 4,
    });

    const formatted = formatDesignScoreForReasoner(score, 1);
    expect(formatted).toContain("Round 1");
    expect(formatted).toContain("Unique findings: 0");
    expect(formatted).toContain("endpoints 2/4");
  });
});
