// toolkit-host.ts — Parent-side IPC handler for the verification toolkit.
//
// Listens for toolkit-request messages from the sandboxed child process
// and dispatches to the ModuleHost. All 10 toolkit methods execute here
// in the parent process; the child is logic-only.

import type { ChildProcess } from "node:child_process";
import { ModuleHost } from "../module-host.js";

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

  assertType(args, moduleHost) {
    const [value, expectedType, label] = args as [unknown, string, string];
    return moduleHost.assertType(value, expectedType, label);
  },

  assertCondition(args, moduleHost) {
    const [condition, label, details] = args as [boolean, string, string | undefined];
    return moduleHost.assertCondition(condition, label, details);
  },

  async measureTime(args, moduleHost) {
    const [fnName, fnArgs, iterations] = args as [string, unknown[], number | undefined];
    return moduleHost.measureTime(fnName, fnArgs ?? [], iterations);
  },

  // log is handled specially — no return value needed
};

// ---------------------------------------------------------------------------
// Attach to child process
// ---------------------------------------------------------------------------

export function attachToolkitHost(
  child: ChildProcess,
  options: ToolkitHostOptions,
): { callLog: ToolkitCallLog[] } {
  const { moduleHost } = options;
  const callLog: ToolkitCallLog[] = [];

  child.on("message", async (msg: unknown) => {
    const m = msg as Record<string, unknown>;
    if (!m || typeof m !== "object" || m.type !== "toolkit-request") return;

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

  return { callLog };
}
