import { describe, it, expect } from "vitest";
import { validateGeneratedCode } from "../src/sandbox/validator.js";

describe("validateGeneratedCode", () => {
  const validCode = `
async function generatedTests(toolkit) {
  const results = [];
  try {
    const r = await toolkit.callFunction("add", [2, 3]);
    results.push(await toolkit.assertEqual(r.result, 5, "add(2,3) = 5"));
  } catch (e) {
    results.push({ label: "add test", status: "execution_error", details: e.message });
  }
  const passed = results.filter(r => r.status === "passed").length;
  const failed = results.filter(r => r.status !== "passed").length;
  return { testsRun: results.length, testsPassed: passed, testsFailed: failed, results };
}`;

  it("accepts valid generated test code", () => {
    const result = validateGeneratedCode(validCode);
    expect(result.valid).toBe(true);
  });

  it("rejects code exceeding 10KB", () => {
    const big = validCode + "x".repeat(10_001);
    const result = validateGeneratedCode(big);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("10KB");
  });

  it("rejects code with require()", () => {
    const code = validCode.replace("toolkit.callFunction", 'require("fs"); toolkit.callFunction');
    const result = validateGeneratedCode(code);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("require(");
  });

  it("rejects code with import", () => {
    const code = 'import fs from "fs";\n' + validCode;
    const result = validateGeneratedCode(code);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("import ");
  });

  it("rejects code with eval()", () => {
    const code = validCode.replace("toolkit.callFunction", 'eval("bad"); toolkit.callFunction');
    const result = validateGeneratedCode(code);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("eval(");
  });

  it("rejects code with fetch()", () => {
    const code = validCode.replace("toolkit.callFunction", 'fetch("http://evil.com"); toolkit.callFunction');
    const result = validateGeneratedCode(code);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("fetch(");
  });

  it("rejects code with process.", () => {
    const code = validCode.replace("toolkit.callFunction", 'process.exit(); toolkit.callFunction');
    const result = validateGeneratedCode(code);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("process.");
  });

  it("rejects code with obfuscation patterns", () => {
    const code = validCode.replace("toolkit.callFunction", 'String.fromCharCode(65); toolkit.callFunction');
    const result = validateGeneratedCode(code);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("fromCharCode");
  });

  it("rejects code missing generatedTests function signature", () => {
    const code = `async function myTests(toolkit) { return { testsRun: 0, testsPassed: 0, testsFailed: 0, results: [] }; }`;
    const result = validateGeneratedCode(code);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Missing required function signature");
  });

  it("rejects code with multiple function definitions", () => {
    const code = validCode + "\n" + validCode;
    const result = validateGeneratedCode(code);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Multiple function definitions");
  });

  it("rejects code missing return shape fields", () => {
    const code = `async function generatedTests(toolkit) { return {}; }`;
    const result = validateGeneratedCode(code);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("must return");
  });

  it("rejects code exceeding max nesting depth", () => {
    // 7 levels of nesting (exceeds max of 6)
    const code = `async function generatedTests(toolkit) { if(true){if(true){if(true){if(true){if(true){if(true){if(true){}}}}}}; return { testsRun: 0, testsPassed: 0, testsFailed: 0, results: [] }; }`;
    const result = validateGeneratedCode(code);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("nesting depth");
  });

  it("rejects code with more than 20 toolkit calls", () => {
    let calls = "";
    for (let i = 0; i < 21; i++) {
      calls += `  toolkit.log("test ${i}");\n`;
    }
    const code = `async function generatedTests(toolkit) {\n  const results = [];\n${calls}  return { testsRun: 0, testsPassed: 0, testsFailed: 0, results };\n}`;
    const result = validateGeneratedCode(code);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("20 toolkit calls");
  });

  it("rejects unbounded while(true) loops", () => {
    const code = validCode.replace("const results = [];", "const results = []; while(true) { break; }");
    const result = validateGeneratedCode(code);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Unbounded loop");
  });

  it("rejects unbounded for(;;) loops", () => {
    const code = validCode.replace("const results = [];", "const results = []; for(;;) { break; }");
    const result = validateGeneratedCode(code);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Unbounded loop");
  });

  it("rejects unbounded do...while(true) loops", () => {
    const code = validCode.replace("const results = [];", "const results = []; do { break; } while(true)");
    const result = validateGeneratedCode(code);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Unbounded loop");
  });

  it("rejects for loop with empty condition", () => {
    const code = validCode.replace("const results = [];", "const results = []; for(var i=0;;i++) { break; }");
    const result = validateGeneratedCode(code);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Unbounded loop");
  });

  it("rejects design mode directly", () => {
    const result = validateGeneratedCode("any code", "design");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("generatedModel or generatedAttacks");
  });

  // -------------------------------------------------------------------------
  // Review mode tests
  // -------------------------------------------------------------------------

  const validReviewCode = `
async function generatedProofs(toolkit) {
  await toolkit.prove("H1", async () => {
    const r = await toolkit.callFunction("add", [1, 2]);
    return { confirmed: true, evidence: "works" };
  });
}`;

  it("review mode accepts generatedProofs signature", () => {
    const result = validateGeneratedCode(validReviewCode, "review");
    expect(result.valid).toBe(true);
  });

  it("review mode rejects generatedTests signature", () => {
    const result = validateGeneratedCode(validCode, "review");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("generatedProofs");
  });

  it("review mode rejects code without toolkit.prove()", () => {
    const code = `
async function generatedProofs(toolkit) {
  await toolkit.callFunction("add", [1, 2]);
}`;
    const result = validateGeneratedCode(code, "review");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("toolkit.prove()");
  });

  it("test mode still accepts generatedTests", () => {
    const result = validateGeneratedCode(validCode, "test");
    expect(result.valid).toBe(true);
  });

  it("test mode rejects generatedProofs signature", () => {
    const result = validateGeneratedCode(validReviewCode, "test");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("generatedTests");
  });
});
