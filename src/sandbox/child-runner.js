// child-runner.js — Sandboxed execution environment for generated test code.
//
// This file runs directly via `node` (not tsx) with permission flags that restrict
// filesystem, child process, and worker access. Before any generated code executes,
// dangerous globals are deleted from the V8 context so the generated code cannot
// access the network, filesystem, timers, or process information.
//
// The child process is logic-only. All function calls and assertions go through
// an IPC-based toolkit that sends messages to the parent process, which owns all
// module access and execution capability.

"use strict";

// ---------------------------------------------------------------------------
// Step 1: Capture essentials before we delete everything
// ---------------------------------------------------------------------------

const _send = process.send.bind(process);
const _on = process.on.bind(process);
const _Function = Function;

// ---------------------------------------------------------------------------
// Step 2: Delete dangerous globals
// ---------------------------------------------------------------------------

// Network / IO
delete globalThis.fetch;
delete globalThis.XMLHttpRequest;
delete globalThis.WebSocket;
delete globalThis.Blob;
delete globalThis.URL;
delete globalThis.URLSearchParams;

// Module system
delete globalThis.require;
delete globalThis.module;
delete globalThis.exports;

// Process (captured _send and _on above)
delete globalThis.process;

// Code generation / eval
delete globalThis.eval;
delete globalThis.Function;

// Timers
delete globalThis.setTimeout;
delete globalThis.setInterval;
delete globalThis.setImmediate;
delete globalThis.queueMicrotask;

// Binary / encoding
delete globalThis.Buffer;
delete globalThis.TextEncoder;
delete globalThis.TextDecoder;

// ---------------------------------------------------------------------------
// Step 3: Set up IPC-based toolkit
// ---------------------------------------------------------------------------

let _requestId = 0;
const _pending = new Map(); // id → { resolve, reject }

// IPC round-trip: send request to parent, wait for matching response
function _toolkitCall(method, args) {
  const id = ++_requestId;
  return new Promise((resolve, reject) => {
    _pending.set(id, { resolve, reject });
    _send({ type: "toolkit-request", id, method, args });
  });
}

const toolkit = {
  async callFunction(fnName, args) {
    return _toolkitCall("callFunction", [fnName, args]);
  },

  async callFunctionAsync(fnName, args) {
    return _toolkitCall("callFunctionAsync", [fnName, args]);
  },

  async getExports() {
    return _toolkitCall("getExports", []);
  },

  async getSourceCode() {
    return _toolkitCall("getSourceCode", []);
  },

  async assertEqual(actual, expected, label) {
    return _toolkitCall("assertEqual", [actual, expected, label]);
  },

  async assertThrows(fnName, args, label) {
    return _toolkitCall("assertThrows", [fnName, args, label]);
  },

  async assertCondition(condition, label, details) {
    return _toolkitCall("assertCondition", [condition, label, details]);
  },

  async measureTime(fnName, args, iterations) {
    return _toolkitCall("measureTime", [fnName, args, iterations]);
  },

  async callFunctionMany(fnName, argSets) {
    return _toolkitCall("callFunctionMany", [fnName, argSets]);
  },

  async comparePerformance(fnName, smallArgs, largeArgs, iterations) {
    return _toolkitCall("comparePerformance", [fnName, smallArgs, largeArgs, iterations]);
  },

  log(message) {
    _send({ type: "log", message: String(message) });
  },

  async prove(hypothesisId, asyncFn) {
    const start = Date.now();
    let verdict;

    try {
      const result = await asyncFn();

      // Validate result shape
      if (!result || typeof result !== "object" || typeof result.confirmed !== "boolean" || typeof result.evidence !== "string") {
        verdict = {
          hypothesisId,
          verdict: "inconclusive",
          evidence: ("Proof callback returned malformed result: " + JSON.stringify(result)).slice(0, 500),
          durationMs: Date.now() - start,
          failureMode: "bad_proof",
        };
      } else {
        // Truncate evidence to 500 chars
        const evidence = result.evidence.length > 500 ? result.evidence.slice(0, 500) : result.evidence;
        verdict = {
          hypothesisId,
          verdict: result.confirmed ? "confirmed" : "refuted",
          evidence,
          durationMs: Date.now() - start,
        };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      verdict = {
        hypothesisId,
        verdict: "inconclusive",
        evidence: message.length > 500 ? message.slice(0, 500) : message,
        durationMs: Date.now() - start,
        failureMode: "bad_proof",
      };
    }

    _send({ type: "prove-result", verdict });
    return verdict;
  },
};

Object.freeze(toolkit);

// ---------------------------------------------------------------------------
// Step 4: Listen for messages from parent via IPC
// ---------------------------------------------------------------------------

_on("message", async (msg) => {
  if (!msg || typeof msg !== "object") return;

  // Handle toolkit responses from parent
  if (msg.type === "toolkit-response" && typeof msg.id === "number") {
    const pending = _pending.get(msg.id);
    if (pending) {
      _pending.delete(msg.id);
      pending.resolve(msg.result);
    }
    return;
  }

  if (msg.type === "toolkit-error" && typeof msg.id === "number") {
    const pending = _pending.get(msg.id);
    if (pending) {
      _pending.delete(msg.id);
      pending.reject(new Error(msg.error || "Unknown toolkit error"));
    }
    return;
  }

  // Handle execute command
  if (msg.type === "execute" && typeof msg.code === "string") {
    const fnName = msg.mode === "review" ? "generatedProofs" : "generatedTests";
    try {
      const fn = new _Function("toolkit", msg.code + "\nreturn " + fnName + "(toolkit);");
      const result = await fn(toolkit);
      _send({ type: "result", result });
    } catch (err) {
      _send({ type: "error", error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
});
