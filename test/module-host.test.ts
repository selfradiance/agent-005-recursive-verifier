import { describe, it, expect } from "vitest";
import path from "node:path";
import { ModuleHost, normalizeValue } from "../src/module-host.js";

// ---------------------------------------------------------------------------
// normalizeValue tests
// ---------------------------------------------------------------------------

describe("normalizeValue", () => {
  it("passes through primitives", () => {
    expect(normalizeValue(42)).toBe(42);
    expect(normalizeValue("hello")).toBe("hello");
    expect(normalizeValue(true)).toBe(true);
    expect(normalizeValue(null)).toBe(null);
  });

  it("normalizes undefined to typed marker", () => {
    expect(normalizeValue(undefined)).toEqual({ __type: "undefined" });
  });

  it("normalizes BigInt", () => {
    expect(normalizeValue(BigInt(123))).toEqual({ __type: "BigInt", value: "123n" });
  });

  it("normalizes Symbol", () => {
    expect(normalizeValue(Symbol("test"))).toEqual({ __type: "Symbol", description: "test" });
  });

  it("normalizes Function", () => {
    function myFunc() {}
    expect(normalizeValue(myFunc)).toEqual({ __type: "Function", name: "myFunc" });
  });

  it("normalizes Error", () => {
    const result = normalizeValue(new TypeError("bad type")) as Record<string, unknown>;
    expect(result.__type).toBe("Error");
    expect(result.name).toBe("TypeError");
    expect(result.message).toBe("bad type");
  });

  it("normalizes Date to ISO string", () => {
    const date = new Date("2026-01-01T00:00:00Z");
    expect(normalizeValue(date)).toBe("2026-01-01T00:00:00.000Z");
  });

  it("normalizes Map", () => {
    const map = new Map([["a", 1], ["b", 2]]);
    expect(normalizeValue(map)).toEqual({
      __type: "Map",
      entries: [["a", 1], ["b", 2]],
    });
  });

  it("normalizes Set", () => {
    const set = new Set([1, 2, 3]);
    expect(normalizeValue(set)).toEqual({
      __type: "Set",
      values: [1, 2, 3],
    });
  });

  it("normalizes plain objects recursively", () => {
    expect(normalizeValue({ a: 1, b: undefined })).toEqual({ a: 1, b: { __type: "undefined" } });
  });

  it("normalizes arrays recursively", () => {
    expect(normalizeValue([1, undefined, "hello"])).toEqual([1, { __type: "undefined" }, "hello"]);
  });

  it("normalizes class instances", () => {
    class Foo {
      x = 10;
      y = "bar";
    }
    const result = normalizeValue(new Foo()) as Record<string, unknown>;
    expect(result.__type).toBe("Instance");
    expect(result.className).toBe("Foo");
    expect(result.properties).toEqual({ x: 10, y: "bar" });
  });

  it("normalizes NaN", () => {
    expect(normalizeValue(NaN)).toEqual({ __type: "NaN" });
  });

  it("normalizes Infinity", () => {
    expect(normalizeValue(Infinity)).toEqual({ __type: "Infinity" });
  });

  it("normalizes -Infinity", () => {
    expect(normalizeValue(-Infinity)).toEqual({ __type: "-Infinity" });
  });
});

// ---------------------------------------------------------------------------
// ModuleHost tests (using sample-math.ts)
// ---------------------------------------------------------------------------

describe("ModuleHost", () => {
  const samplePath = path.resolve(__dirname, "../examples/sample-math.ts");
  const statefulPath = path.resolve(__dirname, "../examples/sample-stateful.ts");

  it("loads a module and discovers exports", async () => {
    const host = new ModuleHost();
    await host.load(samplePath);
    const exports = host.getExports();
    expect(exports).toContain("add");
    expect(exports).toContain("subtract");
    expect(exports).toContain("divide");
    expect(exports).toContain("factorial");
    expect(exports).toContain("isPrime");
    expect(exports).toContain("clamp");
  });

  it("reads source code", async () => {
    const host = new ModuleHost();
    await host.load(samplePath);
    const source = host.getSourceCode();
    expect(source).toContain("export function add");
    expect(source).toContain("export function divide");
  });

  it("calls a function successfully", async () => {
    const host = new ModuleHost();
    await host.load(samplePath);
    const result = await host.callFunction("add", [2, 3]);
    expect(result.status).toBe("passed");
    expect(result.result).toBe(5);
    expect(result.threwError).toBe(false);
  });

  it("handles function that throws", async () => {
    const host = new ModuleHost();
    await host.load(samplePath);
    const result = await host.callFunction("divide", [1, 0]);
    expect(result.status).toBe("execution_error");
    expect(result.threwError).toBe(true);
    expect(result.errorMessage).toContain("Division by zero");
  });

  it("returns invalid_test for non-existent function", async () => {
    const host = new ModuleHost();
    await host.load(samplePath);
    const result = await host.callFunction("nonExistent", []);
    expect(result.status).toBe("invalid_test");
  });

  it("assertEqual passes for equal values", async () => {
    const host = new ModuleHost();
    await host.load(samplePath);
    const result = host.assertEqual(5, 5, "5 equals 5");
    expect(result.passed).toBe(true);
    expect(result.status).toBe("passed");
  });

  it("assertEqual fails for unequal values", async () => {
    const host = new ModuleHost();
    await host.load(samplePath);
    const result = host.assertEqual(5, 6, "5 equals 6");
    expect(result.passed).toBe(false);
    expect(result.status).toBe("failed_assertion");
  });

  it("assertEqual does deep comparison", async () => {
    const host = new ModuleHost();
    await host.load(samplePath);
    const result = host.assertEqual({ a: [1, 2] }, { a: [1, 2] }, "deep equal");
    expect(result.passed).toBe(true);
  });

  it("assertThrows passes when function throws", async () => {
    const host = new ModuleHost();
    await host.load(samplePath);
    const result = await host.assertThrows("divide", [1, 0], "divide by zero throws");
    expect(result.passed).toBe(true);
    expect(result.status).toBe("passed");
    expect(result.threwError).toBe(true);
  });

  it("assertThrows fails when function does not throw", async () => {
    const host = new ModuleHost();
    await host.load(samplePath);
    const result = await host.assertThrows("add", [1, 2], "add should throw");
    expect(result.passed).toBe(false);
    expect(result.status).toBe("failed_assertion");
  });

  it("assertCondition passes for true", () => {
    const host = new ModuleHost();
    const result = host.assertCondition(true, "always true");
    expect(result.passed).toBe(true);
    expect(result.status).toBe("passed");
  });

  it("assertCondition fails for false", () => {
    const host = new ModuleHost();
    const result = host.assertCondition(false, "always false", "extra info");
    expect(result.passed).toBe(false);
    expect(result.status).toBe("failed_assertion");
    expect(result.details).toBe("extra info");
  });

  it("measureTime returns timing stats", async () => {
    const host = new ModuleHost();
    await host.load(samplePath);
    const result = await host.measureTime("add", [1, 2], 5);
    expect(result.status).toBe("passed");
    expect(result.iterations).toBe(5);
    expect(result.min).toBeGreaterThanOrEqual(0);
    expect(result.max).toBeGreaterThanOrEqual(result.min);
    expect(result.avg).toBeGreaterThanOrEqual(0);
    expect(result.median).toBeGreaterThanOrEqual(0);
  });

  it("measureTime caps iterations at 1000", async () => {
    const host = new ModuleHost();
    await host.load(samplePath);
    const result = await host.measureTime("add", [1, 2], 5000);
    expect(result.iterations).toBe(1000);
  });

  it("measureTime returns invalid_test for non-existent function", async () => {
    const host = new ModuleHost();
    await host.load(samplePath);
    const result = await host.measureTime("nonExistent", [], 5);
    expect(result.status).toBe("invalid_test");
  });

  it("reloadFresh() resets module state", async () => {
    const host = new ModuleHost();
    await host.load(statefulPath);

    // Confirm exports work
    const exports = host.getExports();
    expect(exports).toContain("increment");
    expect(exports).toContain("getCount");

    // Mutate state: increment counter
    const r1 = await host.callFunction("increment", []);
    expect(r1.result).toBe(1);
    const r2 = await host.callFunction("increment", []);
    expect(r2.result).toBe(2);
    const r3 = await host.callFunction("getCount", []);
    expect(r3.result).toBe(2);

    // Reload fresh — state should reset
    await host.reloadFresh();

    // Confirm the module is a fresh instance with counter back to 0
    const r4 = await host.callFunction("getCount", []);
    expect(r4.result).toBe(0);
    const r5 = await host.callFunction("increment", []);
    expect(r5.result).toBe(1);
  });

  it("reloadFresh() throws if module not loaded", async () => {
    const host = new ModuleHost();
    await expect(host.reloadFresh()).rejects.toThrow("Module not loaded");
  });
});
