// toolkit-host.ts — Parent-side IPC handler for the verification toolkit.
//
// Listens for toolkit-request messages from the sandboxed child process
// and dispatches to the ModuleHost. All 10 toolkit methods execute here
// in the parent process; the child is logic-only.

import type { ChildProcess } from "node:child_process";
import { ModuleHost } from "../module-host.js";
import type { ProofVerdict } from "../types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ToolkitHostOptions {
  moduleHost: ModuleHost;
}

// Track which functions were called and with what args (for scoring/edge detection)
export interface ToolkitCallLog {
  method: string;
  fnName?: string;
  args?: unknown[];
}

// ---------------------------------------------------------------------------
// Method handlers
// ---------------------------------------------------------------------------

type MethodHandler = (
  args: unknown[],
  moduleHost: ModuleHost,
) => Promise<unknown> | unknown;

const handlers: Record<string, MethodHandler> = {
  async callFunction(args, moduleHost) {
    const [fnName, fnArgs] = args as [string, unknown[]];
    return moduleHost.callFunction(fnName, fnArgs ?? []);
  },

  async callFunctionAsync(args, moduleHost) {
    const [fnName, fnArgs] = args as [string, unknown[]];
    return moduleHost.callFunctionAsync(fnName, fnArgs ?? []);
  },

  getExports(_args, moduleHost) {
    return moduleHost.getExports();
  },

  getSourceCode(_args, moduleHost) {
    return moduleHost.getSourceCode();
  },

  assertEqual(args, moduleHost) {
    const [actual, expected, label] = args as [unknown, unknown, string];
    return moduleHost.assertEqual(actual, expected, label);
  },

  async assertThrows(args, moduleHost) {
    const [fnName, fnArgs, label] = args as [string, unknown[], string];
    return moduleHost.assertThrows(fnName, fnArgs ?? [], label);
  },

  assertCondition(args, moduleHost) {
    const [condition, label, details] = args as [boolean, string, string | undefined];
    return moduleHost.assertCondition(condition, label, details);
  },

  async measureTime(args, moduleHost) {
    const [fnName, fnArgs, iterations] = args as [string, unknown[], number | undefined];
    return moduleHost.measureTime(fnName, fnArgs ?? [], iterations);
  },

  async callFunctionMany(args, moduleHost) {
    const [fnName, argSets] = args as [string, unknown[][]];
    const results = [];
    for (let i = 0; i < (argSets ?? []).length; i++) {
      try {
        const callResult = await moduleHost.callFunction(fnName, argSets[i] ?? []);
        if (callResult.threwError) {
          results.push({ index: i, args: argSets[i], ok: false, error: callResult.errorMessage ?? callResult.error ?? "Unknown error" });
        } else {
          results.push({ index: i, args: argSets[i], ok: true, result: callResult.result });
        }
      } catch (err) {
        results.push({ index: i, args: argSets[i], ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return results;
  },

  async comparePerformance(args, moduleHost) {
    const [fnName, smallArgs, largeArgs, rawIterations] = args as [string, unknown[], unknown[], number | undefined];
    const iterations = Math.max(rawIterations ?? 50, 50);

    // Warm-up: run once with each arg set, discard results
    await moduleHost.callFunction(fnName, smallArgs ?? []);
    await moduleHost.callFunction(fnName, largeArgs ?? []);

    // Collect small timings
    const smallTimes: number[] = [];
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      await moduleHost.callFunction(fnName, smallArgs ?? []);
      smallTimes.push(performance.now() - start);
    }

    // Collect large timings
    const largeTimes: number[] = [];
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      await moduleHost.callFunction(fnName, largeArgs ?? []);
      largeTimes.push(performance.now() - start);
    }

    // Compute medians
    smallTimes.sort((a, b) => a - b);
    largeTimes.sort((a, b) => a - b);
    const mid = Math.floor(iterations / 2);
    const smallMedianMs = iterations % 2 === 0
      ? (smallTimes[mid - 1] + smallTimes[mid]) / 2
      : smallTimes[mid];
    const largeMedianMs = iterations % 2 === 0
      ? (largeTimes[mid - 1] + largeTimes[mid]) / 2
      : largeTimes[mid];

    const ratio = smallMedianMs > 0 ? largeMedianMs / smallMedianMs : 0;
    const trending = ratio > 2.0;

    return {
      smallMedianMs: Number(smallMedianMs.toFixed(4)),
      largeMedianMs: Number(largeMedianMs.toFixed(4)),
      ratio: Number(ratio.toFixed(4)),
      trending,
    };
  },

  // log is handled specially — no return value needed
};

// ---------------------------------------------------------------------------
// Attach to child process
// ---------------------------------------------------------------------------

export function attachToolkitHost(
  child: ChildProcess,
  options: ToolkitHostOptions,
): { callLog: ToolkitCallLog[]; proofVerdicts: ProofVerdict[] } {
  const { moduleHost } = options;
  const callLog: ToolkitCallLog[] = [];
  const proofVerdicts: ProofVerdict[] = [];

  child.on("message", async (msg: unknown) => {
    const m = msg as Record<string, unknown>;
    if (!m || typeof m !== "object") return;

    // Handle proof verdicts from child
    if (m.type === "prove-result") {
      proofVerdicts.push(m.verdict as ProofVerdict);
      return;
    }

    if (m.type !== "toolkit-request") return;

    const id = m.id as number;
    const method = m.method as string;
    const args = m.args as unknown[];

    // Log the call for scoring
    const logEntry: ToolkitCallLog = { method };
    if (method === "callFunction" || method === "callFunctionAsync" || method === "assertThrows" || method === "measureTime") {
      logEntry.fnName = args[0] as string;
      logEntry.args = args[1] as unknown[];
    }
    callLog.push(logEntry);

    // Handle log specially — no response needed
    if (method === "log") {
      // Log messages are handled via the "log" message type in child-runner.js
      // This shouldn't arrive here, but just in case:
      child.send({ type: "toolkit-response", id, result: null });
      return;
    }

    const handler = handlers[method];
    if (!handler) {
      child.send({ type: "toolkit-error", id, error: `Unknown toolkit method: ${method}` });
      return;
    }

    try {
      const result = await handler(args, moduleHost);
      child.send({ type: "toolkit-response", id, result });
    } catch (err) {
      child.send({
        type: "toolkit-error",
        id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return { callLog, proofVerdicts };
}
