import { describe, it, expect } from "vitest";
import { stripFences } from "../src/generator-review.js";

describe("stripFences", () => {
  it("returns code string containing generatedProofs and prove", () => {
    const raw = `async function generatedProofs(toolkit) {
  await toolkit.prove("H1", async () => {
    const r = await toolkit.callFunction("divide", [1, 0]);
    return { confirmed: true, evidence: "divide by zero returns Infinity" };
  });
}`;
    const code = stripFences(raw);
    expect(typeof code).toBe("string");
    expect(code).toContain("async function generatedProofs(toolkit)");
    expect(code).toContain("toolkit.prove(");
  });

  it("strips markdown javascript fences from response", () => {
    const raw = '```javascript\nasync function generatedProofs(toolkit) {\n  await toolkit.prove("H1", async () => {\n    return { confirmed: true, evidence: "works" };\n  });\n}\n```';
    const code = stripFences(raw);
    expect(code).not.toContain("```");
    expect(code).toContain("async function generatedProofs(toolkit)");
    expect(code).toContain("toolkit.prove(");
  });
});
