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

  async assertType(value, expectedType, label) {
    return _toolkitCall("assertType", [value, expectedType, label]);
  },

  async assertCondition(condition, label, details) {
    return _toolkitCall("assertCondition", [condition, label, details]);
  },

  async measureTime(fnName, args, iterations) {
    return _toolkitCall("measureTime", [fnName, args, iterations]);
  },

  log(message) {
    _send({ type: "log", message: String(message) });
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
    try {
      const fn = new _Function("toolkit", msg.code + "\nreturn generatedTests(toolkit);");
      const result = await fn(toolkit);
      _send({ type: "result", result });
    } catch (err) {
      _send({ type: "error", error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
});
