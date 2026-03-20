// module-host.ts — Parent-side target module loader and function dispatcher.
//
// Loads a user's JS/TS module via dynamic import(), discovers exports,
// and provides callFunction/callFunctionAsync with 5-second timeout
// and result normalization for IPC serialization.

import { isDeepStrictEqual } from "node:util";
import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Status = "passed" | "failed_assertion" | "execution_error" | "timeout" | "invalid_test";

export interface CallResult {
  result: unknown;
  error: string | null;
  threwError: boolean;
  errorMessage: string | null;
  timeMs: number;
  status: Status;
}

export interface AssertEqualResult {
  passed: boolean;
  actual: unknown;
  expected: unknown;
  label: string;
  status: Status;
}

export interface AssertThrowsResult {
  passed: boolean;
  threwError: boolean;
  errorMessage: string | null;
  label: string;
  status: Status;
}

export interface AssertTypeResult {
  passed: boolean;
  actualType: string;
  expectedType: string;
  label: string;
  status: Status;
}

export interface AssertConditionResult {
  passed: boolean;
  label: string;
  details: string | null;
  status: Status;
}

export interface MeasureTimeResult {
  min: number;
  max: number;
  avg: number;
  median: number;
  iterations: number;
  status: Status;
}

// ---------------------------------------------------------------------------
// Result normalization (IPC serialization policy)
// ---------------------------------------------------------------------------

export function normalizeValue(value: unknown, _seen?: WeakSet<object>): unknown {
  const seen = _seen ?? new WeakSet();
  // Primitives
  if (value === null) return null;
  if (value === undefined) return "[undefined]";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    if (typeof value === "number" && Number.isNaN(value)) return { __type: "NaN" };
    return value;
  }
  if (typeof value === "bigint") return { __type: "BigInt", value: `${value}n` };
  if (typeof value === "symbol") return { __type: "Symbol", description: value.description ?? "" };
  if (typeof value === "function") return { __type: "Function", name: value.name || "anonymous" };

  // Error
  if (value instanceof Error) {
    return { __type: "Error", name: value.name, message: value.message, stack: value.stack ?? "" };
  }

  // Date
  if (value instanceof Date) return value.toISOString();

  // Map
  if (value instanceof Map) {
    return { __type: "Map", entries: Array.from(value.entries()).map(([k, v]) => [normalizeValue(k, seen), normalizeValue(v, seen)]) };
  }

  // Set
  if (value instanceof Set) {
    return { __type: "Set", values: Array.from(value.values()).map((v) => normalizeValue(v, seen)) };
  }

  // Circular reference detection
  if (typeof value === "object") {
    if (seen.has(value as object)) {
      let preview = "";
      try { preview = JSON.stringify(value).slice(0, 200); } catch { preview = "[circular]"; }
      return { __type: "Circular", preview };
    }
    seen.add(value as object);

    try {
      // Plain arrays
      if (Array.isArray(value)) {
        const result = value.map((v) => normalizeValue(v, seen));
        seen.delete(value);
        return result;
      }

      // Plain objects vs class instances
      const proto = Object.getPrototypeOf(value);
      if (proto === Object.prototype || proto === null) {
        const result: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value)) {
          result[k] = normalizeValue(v, seen);
        }
        seen.delete(value);
        return result;
      }

      // Class instance
      const className = (value as object).constructor?.name ?? "Unknown";
      const properties: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        properties[k] = normalizeValue(v, seen);
      }
      seen.delete(value);
      return { __type: "Instance", className, properties };
    } catch {
      seen.delete(value as object);
      return { __type: "Circular", preview: "[unserializable]" };
    }
  }

  return String(value);
}

// ---------------------------------------------------------------------------
// ModuleHost class
// ---------------------------------------------------------------------------

export class ModuleHost {
  private module: Record<string, unknown> | null = null;
  private filePath: string = "";
  private sourceCode: string = "";

  async load(filePath: string): Promise<void> {
    const absolutePath = path.resolve(filePath);

    // Read source code for the reasoner
    this.sourceCode = fs.readFileSync(absolutePath, "utf-8");
    this.filePath = absolutePath;

    // Dynamic import (tsx handles .ts files)
    this.module = await import(absolutePath);
  }

  getExports(): string[] {
    if (!this.module) throw new Error("Module not loaded");
    return Object.keys(this.module).filter((k) => typeof this.module![k] === "function");
  }

  getAllExportNames(): string[] {
    if (!this.module) throw new Error("Module not loaded");
    return Object.keys(this.module);
  }

  getSourceCode(): string {
    return this.sourceCode;
  }

  getFilePath(): string {
    return this.filePath;
  }

  private getFunction(fnName: string): Function {
    if (!this.module) throw new Error("Module not loaded");
    const fn = this.module[fnName];
    if (typeof fn !== "function") {
      throw new Error(`INVALID_TEST: "${fnName}" is not an exported function`);
    }
    return fn as Function;
  }

  // Call a function synchronously with 5-second timeout via Promise.race
  async callFunction(fnName: string, args: unknown[]): Promise<CallResult> {
    const start = Date.now();

    let fn: Function;
    try {
      fn = this.getFunction(fnName);
    } catch (err) {
      return {
        result: null,
        error: "INVALID_TEST",
        threwError: false,
        errorMessage: err instanceof Error ? err.message : String(err),
        timeMs: Date.now() - start,
        status: "invalid_test",
      };
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const resultPromise = Promise.resolve().then(() => fn(...args));
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("TIMEOUT")), 5000);
      });

      const result = await Promise.race([resultPromise, timeoutPromise]);
      clearTimeout(timer);
      return {
        result: normalizeValue(result),
        error: null,
        threwError: false,
        errorMessage: null,
        timeMs: Date.now() - start,
        status: "passed",
      };
    } catch (err) {
      clearTimeout(timer);
      const timeMs = Date.now() - start;
      const message = err instanceof Error ? err.message : String(err);

      if (message === "TIMEOUT") {
        return {
          result: null,
          error: "TIMEOUT",
          threwError: false,
          errorMessage: "Function execution exceeded 5000ms",
          timeMs: 5000,
          status: "timeout",
        };
      }

      return {
        result: null,
        error: message,
        threwError: true,
        errorMessage: message,
        timeMs,
        status: "execution_error",
      };
    }
  }

  // Same as callFunction but explicitly awaits — for async functions
  async callFunctionAsync(fnName: string, args: unknown[]): Promise<CallResult> {
    return this.callFunction(fnName, args);
  }

  // Deep equality assertion
  assertEqual(actual: unknown, expected: unknown, label: string): AssertEqualResult {
    const passed = isDeepStrictEqual(actual, expected);
    return {
      passed,
      actual: normalizeValue(actual),
      expected: normalizeValue(expected),
      label,
      status: passed ? "passed" : "failed_assertion",
    };
  }

  // Assert that calling a function throws
  async assertThrows(fnName: string, args: unknown[], label: string): Promise<AssertThrowsResult> {
    let fn: Function;
    try {
      fn = this.getFunction(fnName);
    } catch {
      return {
        passed: false,
        threwError: false,
        errorMessage: `"${fnName}" is not an exported function`,
        label,
        status: "invalid_test",
      };
    }

    try {
      const result = fn(...args);
      // If it returns a promise, await it
      if (result && typeof result === "object" && typeof result.then === "function") {
        await result;
      }
      return {
        passed: false,
        threwError: false,
        errorMessage: null,
        label,
        status: "failed_assertion",
      };
    } catch (err) {
      return {
        passed: true,
        threwError: true,
        errorMessage: err instanceof Error ? err.message : String(err),
        label,
        status: "passed",
      };
    }
  }

  // Type check assertion
  assertType(value: unknown, expectedType: string, label: string): AssertTypeResult {
    const actualType = (typeof value === "number" && Number.isNaN(value)) ? "NaN"
      : value === null ? "null"
      : Array.isArray(value) ? "array"
      : typeof value;
    const passed = actualType === expectedType;
    return {
      passed,
      actualType,
      expectedType,
      label,
      status: passed ? "passed" : "failed_assertion",
    };
  }

  // Boolean condition assertion
  assertCondition(condition: boolean, label: string, details?: string): AssertConditionResult {
    return {
      passed: condition,
      label,
      details: details ?? null,
      status: condition ? "passed" : "failed_assertion",
    };
  }

  // Measure function execution time over N iterations
  async measureTime(fnName: string, args: unknown[], iterations: number = 10): Promise<MeasureTimeResult> {
    const cappedIterations = Math.min(Math.max(iterations, 1), 1000);

    let fn: Function;
    try {
      fn = this.getFunction(fnName);
    } catch {
      return { min: 0, max: 0, avg: 0, median: 0, iterations: 0, status: "invalid_test" };
    }

    const times: number[] = [];

    for (let i = 0; i < cappedIterations; i++) {
      const start = performance.now();
      try {
        const result = fn(...args);
        if (result && typeof result === "object" && typeof result.then === "function") {
          await result;
        }
      } catch {
        // Still record the time even if it throws
      }
      times.push(performance.now() - start);
    }

    times.sort((a, b) => a - b);
    const sum = times.reduce((a, b) => a + b, 0);
    const mid = Math.floor(times.length / 2);
    const median = times.length % 2 === 0 ? (times[mid - 1] + times[mid]) / 2 : times[mid];

    return {
      min: Number(times[0].toFixed(4)),
      max: Number(times[times.length - 1].toFixed(4)),
      avg: Number((sum / times.length).toFixed(4)),
      median: Number(median.toFixed(4)),
      iterations: cappedIterations,
      status: "passed",
    };
  }
}
