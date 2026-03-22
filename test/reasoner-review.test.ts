import { describe, it, expect } from "vitest";
import { parseHypotheses } from "../src/reasoner-review.js";

describe("parseHypotheses", () => {
  it("parses a valid JSON hypothesis array from Claude response", () => {
    const raw = JSON.stringify({
      hypotheses: [
        {
          id: "H1",
          category: "bug",
          target: "function:divide",
          claim: "divide(1, 0) returns Infinity instead of throwing",
          severity: "high",
          expected_signal_type: "value",
          requires_fresh_state: false,
          proof_strategy: "Call divide(1, 0), check if result is Infinity",
        },
        {
          id: "H2",
          category: "edge_case",
          target: "function:factorial",
          claim: "factorial(-1) does not throw for negative input",
          severity: "medium",
          expected_signal_type: "throw",
          requires_fresh_state: false,
          proof_strategy: "Call factorial(-1), verify it throws",
        },
        {
          id: "H3",
          category: "performance",
          target: "function:isPrime",
          claim: "isPrime has superlinear growth on large inputs",
          severity: "low",
          expected_signal_type: "ratio",
          requires_fresh_state: false,
          proof_strategy: "Compare timing of isPrime(97) vs isPrime(15485863)",
        },
      ],
    });

    const hypotheses = parseHypotheses(raw);
    expect(hypotheses).toHaveLength(3);

    expect(hypotheses[0].id).toBe("H1");
    expect(hypotheses[0].category).toBe("bug");
    expect(hypotheses[0].target).toBe("function:divide");
    expect(hypotheses[0].claim).toContain("Infinity");
    expect(hypotheses[0].severity).toBe("high");
    expect(hypotheses[0].expected_signal_type).toBe("value");
    expect(hypotheses[0].requires_fresh_state).toBe(false);
    expect(hypotheses[0].proof_strategy).toBeTruthy();

    expect(hypotheses[1].id).toBe("H2");
    expect(hypotheses[1].category).toBe("edge_case");

    expect(hypotheses[2].id).toBe("H3");
    expect(hypotheses[2].category).toBe("performance");
  });

  it("handles markdown-fenced JSON response", () => {
    const raw = 'Here are the hypotheses:\n```json\n{"hypotheses": [{"id": "H1", "category": "bug", "target": "function:add", "claim": "overflow", "severity": "low", "expected_signal_type": "value", "requires_fresh_state": false, "proof_strategy": "test large numbers"}]}\n```';
    const hypotheses = parseHypotheses(raw);
    expect(hypotheses).toHaveLength(1);
    expect(hypotheses[0].id).toBe("H1");
  });

  it("returns empty array for unparseable response", () => {
    const hypotheses = parseHypotheses("This is not JSON at all");
    expect(hypotheses).toEqual([]);
  });
});
