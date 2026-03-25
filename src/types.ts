// types.ts — Shared types used across modules.

// ---------------------------------------------------------------------------
// v0.2.0 Proof types
// ---------------------------------------------------------------------------

export type ProofVerdict = {
  hypothesisId: string;
  verdict: "confirmed" | "refuted" | "inconclusive";
  evidence: string;
  durationMs: number;
  failureMode?: "tool_error" | "target_timeout" | "non_serializable" | "bad_hypothesis" | "bad_proof" | "measurement_noise";
};

// ---------------------------------------------------------------------------
// v0.2.0 Hypothesis types
// ---------------------------------------------------------------------------

export type HypothesisSeverity = "critical" | "high" | "medium" | "low";

export type Hypothesis = {
  id: string;
  category: "bug" | "edge_case" | "performance" | "security" | "property_violation";
  target: string;
  claim: string;
  severity: HypothesisSeverity;
  expected_signal_type: "value" | "throw" | "timeout" | "ratio" | "invariant_break" | "nondeterminism";
  requires_fresh_state: boolean;
  proof_strategy: string;
};

// ---------------------------------------------------------------------------
// v0.2.0 Batch call types
// ---------------------------------------------------------------------------

export type BatchResult = {
  index: number;
  args: unknown[];
  ok: boolean;
  result?: unknown;
  error?: string;
};

// ---------------------------------------------------------------------------
// v0.2.0 Performance comparison types
// ---------------------------------------------------------------------------

export type PerformanceResult = {
  smallMedianMs: number;
  largeMedianMs: number;
  ratio: number;
  trending: boolean;
};

// ---------------------------------------------------------------------------
// v0.2.0 Review scoring types
// ---------------------------------------------------------------------------

export type ReviewScore = {
  hypotheses_total: number;
  confirmed_count: number;
  refuted_count: number;
  inconclusive_count: number;
  confirmation_rate: number;
  proof_success_rate: number;
  severity_breakdown: Record<string, number>;
  category_breakdown: Record<string, number>;
  novel_findings: number;
  inconclusive_by_failure_mode: Record<string, number>;
};

export type ConfirmedFinding = {
  hypothesisId: string;
  target: string;
  category: string;
  claim: string;
  severity: HypothesisSeverity;
};

// ---------------------------------------------------------------------------
// v0.3.0 Design mode types
// ---------------------------------------------------------------------------

export type AttributionCategory =
  | "high_confidence_flaw"
  | "ambiguity_risk"
  | "model_defect"
  | "attack_defect"
  | "inconclusive";

export type Severity = "critical" | "high" | "medium" | "low" | "informational";

export type TraceEntry = {
  step: number;
  type: "request" | "invariant_check" | "annotation" | "expect_rejected" | "expect_allowed" | "handler_error" | "handler_shape_error" | "unknown_handler" | "reset";
  endpoint?: string;
  body?: unknown;
  response?: unknown;
  stateSnapshot?: unknown;
  invariantResults?: InvariantResult[];
  message?: string;
  error?: string;
};

export type InvariantResult = {
  id: string;
  holds: boolean;
  violation?: string;
};

export type DesignFinding = {
  id: string;
  category: AttributionCategory;
  severity: Severity;
  affectedEndpoints: string[];
  affectedRules: string[];
  assumptionsInvolved: string[];
  sequenceTrace: TraceEntry[];
  expectedBehavior: string;
  observedBehavior: string;
  invariantFailures: string[];
  reproducibilityStatus: "reproduced_multiple" | "reproduced_once" | "flaky";
  attackAnnotations: string[];
};

export type Assumption = {
  id: string;
  text: string;
  specRef: string;
  confidence: "high" | "medium" | "low";
  kind: "ambiguity" | "inferred_rule";
  relatedRules: string[];
};

export type ChangeJustification = {
  what: string;
  why: string;
  specEvidence: string;
  promptedByAttack: boolean;
  classification: "ambiguity_clarification" | "missing_rule_completion" | "bug_fix" | "suspicious_adaptation" | "defensive_hardening" | "edge_case_handling";
};

export type NormalizedSpecSummary = {
  endpoints: Array<{ path: string; method: string; description: string }>;
  actors: Array<{ role: string; permissions: string[] }>;
  resources: Array<{ name: string; description: string }>;
  stateVariables: Array<{ name: string; description: string }>;
  businessRules: Array<{ id: string; rule: string }>;
  invariants: Array<{ id: string; rule: string }>;
  allowedTransitions: Array<{ from: string; to: string; trigger: string }>;
  forbiddenTransitions: Array<{ description: string; reason: string }>;
  unknowns: Array<{ description: string }>;
};

export type CoverageVector = {
  endpointsExercised: number;
  endpointsTotal: number;
  rolesExercised: number;
  rolesTotal: number;
  transitionsExercised: number;
  transitionsTotal: number;
  invariantsExercised: number;
  invariantsTotal: number;
  rejectionPathsExercised: number;
  rejectionPathsTotal: number;
  // Internal: carry forward seen items for cumulative union across rounds
  _seenEndpoints?: string[];
  _seenRoles?: string[];
  _seenInvariants?: string[];
};

export type DesignScore = {
  invariantViolations: number;
  unauthorizedAccessPaths: number;
  stateInconsistencies: number;
  specAmbiguitiesSurfaced: number;
  uniqueFindings: number;
  attributionBreakdown: Record<AttributionCategory, number>;
  coverage: CoverageVector;
};

export type FidelityMismatch = {
  type: "missing_handler" | "missing_rule_mapping" | "extra_handler";
  description: string;
  specItem?: string;
  modelItem?: string;
};

