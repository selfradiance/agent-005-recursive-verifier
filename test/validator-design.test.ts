import { describe, it, expect } from "vitest";
import { validateGeneratedCode } from "../src/sandbox/validator.js";

describe("validateGeneratedCode — generatedModel mode", () => {
  const validModel = `
// Behavioral model for BondGate API
const assumptions = [
  { id: "A1", text: "Admin bond creation returns 403", specRef: "R5", confidence: "medium", kind: "ambiguity", relatedRules: ["R5"] }
];

// R1: initial state
function initState() {
  return { identities: [], bonds: [], actions: [], nextId: 1 };
}

const handlers = {
  "POST /v1/identities": function(state, request) {
    // R5: only admin can create identities
    if (request.callerRole !== "admin") {
      return { nextState: state, response: { status: 403, error: "forbidden" } };
    }
    const id = "id-" + state.nextId;
    const identity = { id, publicKey: request.publicKey, role: request.role, status: "active" };
    const nextState = { ...state, identities: [...state.identities, identity], nextId: state.nextId + 1 };
    return { nextState, response: { status: 201, ...identity } };
  }
};

const invariants = [
  {
    id: "INV1",
    description: "Used amount never exceeds bonded amount",
    sourceRule: "R1",
    check: function(state) {
      return { holds: true };
    }
  }
];`;

  it("accepts valid model code", () => {
    const result = validateGeneratedCode(validModel, "generatedModel");
    expect(result.valid).toBe(true);
  });

  it("rejects model exceeding 50KB", () => {
    const big = validModel + "x".repeat(50_001);
    const result = validateGeneratedCode(big, "generatedModel");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("50KB");
  });

  it("rejects model missing assumptions", () => {
    const code = validModel.replace("assumptions", "suppositions");
    const result = validateGeneratedCode(code, "generatedModel");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("assumptions");
  });

  it("rejects model missing initState", () => {
    const code = validModel.replace("initState", "initialState");
    const result = validateGeneratedCode(code, "generatedModel");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("initState");
  });

  it("rejects model missing handlers", () => {
    const code = validModel.replace("handlers", "endpoints");
    const result = validateGeneratedCode(code, "generatedModel");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("handlers");
  });

  it("rejects model missing invariants", () => {
    const code = validModel.replace(/invariants/g, "checks");
    const result = validateGeneratedCode(code, "generatedModel");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("invariants");
  });

  it("rejects model without inline comments", () => {
    const code = validModel.split("\n").filter(line => !line.trim().startsWith("//")).join("\n");
    const result = validateGeneratedCode(code, "generatedModel");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("inline comments");
  });

  it("rejects model with blocked patterns", () => {
    const code = validModel + '\nrequire("fs");';
    const result = validateGeneratedCode(code, "generatedModel");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("require(");
  });

  it("rejects deeply nested model code", () => {
    // 11+ open braces to exceed max depth of 10 for models
    const nested = validModel + "\n{{{{{{{{{{{{{";
    const result = validateGeneratedCode(nested, "generatedModel");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("nesting depth");
  });
});

describe("validateGeneratedCode — generatedAttacks mode", () => {
  const validAttack = `
async function adversarialSequence(api) {
  // Attack 1: admin tries to create bond
  api.reset();
  api.annotate("Testing admin bond creation");
  const id = api.request("POST /v1/identities", { callerRole: "admin", publicKey: "k1", role: "holder" });
  const bondResp = api.request("POST /v1/bonds", { callerRole: "admin", identityId: id.id, amount: 100 });
  api.expectRejected(bondResp, "Admin should not be able to create bonds");
  api.assertInvariant("INV1");
  return api.finish();
}`;

  it("accepts valid attack code", () => {
    const result = validateGeneratedCode(validAttack, "generatedAttacks");
    expect(result.valid).toBe(true);
  });

  it("rejects attack exceeding 10KB", () => {
    const big = validAttack + "x".repeat(10_001);
    const result = validateGeneratedCode(big, "generatedAttacks");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("10KB");
  });

  it("rejects attack without api.reset()", () => {
    const code = validAttack.replace("api.reset()", "// no reset");
    const result = validateGeneratedCode(code, "generatedAttacks");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("api.reset()");
  });

  it("rejects attack without api.finish()", () => {
    const code = validAttack.replace("api.finish()", "// no finish");
    const result = validateGeneratedCode(code, "generatedAttacks");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("api.finish()");
  });

  it("rejects attack accessing model.handlers", () => {
    const code = validAttack.replace("api.annotate", "model.handlers; api.annotate");
    const result = validateGeneratedCode(code, "generatedAttacks");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("model internals");
  });

  it("rejects attack accessing model.invariants", () => {
    const code = validAttack.replace("api.annotate", "model.invariants; api.annotate");
    const result = validateGeneratedCode(code, "generatedAttacks");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("model internals");
  });

  it("rejects attack without adversarialSequence signature", () => {
    const code = validAttack.replace("adversarialSequence", "myAttack");
    const result = validateGeneratedCode(code, "generatedAttacks");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("adversarialSequence");
  });

  it("rejects attack with more than 50 api.request calls", () => {
    let calls = "";
    for (let i = 0; i < 51; i++) {
      calls += `  api.request("GET /v1/identities/1", { callerRole: "admin" });\n`;
    }
    const code = `async function adversarialSequence(api) {\n  api.reset();\n${calls}  return api.finish();\n}`;
    const result = validateGeneratedCode(code, "generatedAttacks");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("50 api.request()");
  });

  it("rejects attack with blocked patterns", () => {
    const code = validAttack + '\nfetch("http://evil.com");';
    const result = validateGeneratedCode(code, "generatedAttacks");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("fetch(");
  });

  it("rejects deeply nested attack code", () => {
    const code = `async function adversarialSequence(api) {
  api.reset();
  if(true){if(true){if(true){if(true){if(true){if(true){}}}}}}
  return api.finish();
}`;
    const result = validateGeneratedCode(code, "generatedAttacks");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("nesting depth");
  });
});
