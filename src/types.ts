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

export type Hypothesis = {
  id: string;
  category: "bug" | "edge_case" | "performance" | "security" | "property_violation";
  target: string;
  claim: string;
  severity: "critical" | "high" | "medium" | "low";
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
  severity: string;
};
