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
const _defineProperty = Object.defineProperty.bind(Object);
const _setPrototypeOf = Object.setPrototypeOf.bind(Object);
const _freeze = Object.freeze.bind(Object);

try {
  _defineProperty(Function.prototype, "constructor", {
    value: null,
    writable: false,
    configurable: false,
  });
} catch {
  // Best effort hardening; the validator remains a separate defense layer.
}

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

// Shared memory / atomics (prevent timing side-channels)
delete globalThis.SharedArrayBuffer;
delete globalThis.Atomics;

// ---------------------------------------------------------------------------
// Step 3: Set up IPC-based toolkit
// ---------------------------------------------------------------------------

let _requestId = 0;
const _pending = new Map(); // id → { resolve, reject }
let _toolkitCallCount = 0;
let _toolkitCallLimit = 20;

function _countToolkitCall() {
  _toolkitCallCount++;
  if (_toolkitCallCount > _toolkitCallLimit) {
    throw new Error("Toolkit call limit exceeded (" + _toolkitCallLimit + ")");
  }
}

function _hardenCallable(fn) {
  _setPrototypeOf(fn, null);
  return _freeze(fn);
}

// IPC round-trip: send request to parent, wait for matching response
function _toolkitCall(method, args) {
  _countToolkitCall();
  const id = ++_requestId;
  return new Promise((resolve, reject) => {
    _pending.set(id, { resolve, reject });
    _send({ type: "toolkit-request", id, method, args });
  });
}

const toolkit = Object.create(null);

toolkit.callFunction = _hardenCallable(async function callFunction(fnName, args) {
  return _toolkitCall("callFunction", [fnName, args]);
});

toolkit.callFunctionAsync = _hardenCallable(async function callFunctionAsync(fnName, args) {
  return _toolkitCall("callFunctionAsync", [fnName, args]);
});

toolkit.getExports = _hardenCallable(async function getExports() {
  return _toolkitCall("getExports", []);
});

toolkit.getSourceCode = _hardenCallable(async function getSourceCode() {
  return _toolkitCall("getSourceCode", []);
});

toolkit.assertEqual = _hardenCallable(async function assertEqual(actual, expected, label) {
  return _toolkitCall("assertEqual", [actual, expected, label]);
});

toolkit.assertThrows = _hardenCallable(async function assertThrows(fnName, args, label) {
  return _toolkitCall("assertThrows", [fnName, args, label]);
});

toolkit.assertCondition = _hardenCallable(async function assertCondition(condition, label, details) {
  return _toolkitCall("assertCondition", [condition, label, details]);
});

toolkit.measureTime = _hardenCallable(async function measureTime(fnName, args, iterations) {
  return _toolkitCall("measureTime", [fnName, args, iterations]);
});

toolkit.callFunctionMany = _hardenCallable(async function callFunctionMany(fnName, argSets) {
  return _toolkitCall("callFunctionMany", [fnName, argSets]);
});

toolkit.comparePerformance = _hardenCallable(async function comparePerformance(fnName, smallArgs, largeArgs, iterations) {
  return _toolkitCall("comparePerformance", [fnName, smallArgs, largeArgs, iterations]);
});

toolkit.log = _hardenCallable(function log(message) {
  _countToolkitCall();
  _send({ type: "log", message: String(message) });
});

toolkit.prove = _hardenCallable(async function prove(hypothesisId, asyncFn) {
  _countToolkitCall();
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
});

_freeze(toolkit);

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
    _toolkitCallCount = 0;
    _toolkitCallLimit = msg.mode === "review" ? 50 : 20;

    if (msg.mode === "design") {
      // Design mode: two-phase execution (model + attacks)
      try {
        const modelCode = msg.modelCode;
        const attackCode = msg.code;

        // Phase 1: Evaluate the model
        const modelFn = new _Function(modelCode + "\nreturn { assumptions, initState, handlers, invariants };");
        const model = modelFn();

        // Deep freeze the model to prevent mutation
        function deepFreeze(obj) {
          if (obj === null || typeof obj !== "object") return obj;
          Object.freeze(obj);
          const keys = Object.getOwnPropertyNames(obj);
          for (let i = 0; i < keys.length; i++) {
            const val = obj[keys[i]];
            if (typeof val === "object" && val !== null && !Object.isFrozen(val)) {
              deepFreeze(val);
            }
          }
          return obj;
        }
        deepFreeze(model);

        // Build the designApi helper
        const MAX_RUNTIME_REQUESTS = 200;

        function createDesignApi(frozenModel) {
          let state = null;
          let stepCount = 0;
          let requestCount = 0;
          const trace = [];
          const invariantResults = [];

          function structuredClonePolyfill(obj) {
            return JSON.parse(JSON.stringify(obj));
          }

          function runInvariants(currentState) {
            const results = [];
            for (let i = 0; i < frozenModel.invariants.length; i++) {
              const inv = frozenModel.invariants[i];
              try {
                const result = inv.check(structuredClonePolyfill(currentState));
                results.push({ id: inv.id, holds: result.holds, violation: result.violation });
              } catch (err) {
                results.push({ id: inv.id, holds: false, violation: "Invariant check threw: " + (err instanceof Error ? err.message : String(err)) });
              }
            }
            return results;
          }

          function hardenApiMethod(fn) {
            _setPrototypeOf(fn, null);
            return _freeze(fn);
          }

          const api = Object.create(null);

          api.reset = hardenApiMethod(function reset() {
              state = structuredClonePolyfill(frozenModel.initState());
              stepCount = 0;
              requestCount = 0;
              // Don't clear trace — preserve all sequences for analysis
              // Push a reset marker so the scorer can reliably split sequences
              trace.push({ step: 0, type: "reset" });
              invariantResults.length = 0;
            });

          api.request = hardenApiMethod(function request(endpoint, body) {
              stepCount++;
              requestCount++;

              // Runtime request count cap
              if (requestCount > MAX_RUNTIME_REQUESTS) {
                var capEntry = { step: stepCount, type: "handler_error", endpoint: endpoint, error: "Runtime request limit exceeded (" + MAX_RUNTIME_REQUESTS + ")" };
                trace.push(capEntry);
                return { error: "request_limit_exceeded", endpoint: endpoint };
              }

              var handler = frozenModel.handlers[endpoint];
              if (!handler) {
                var entry = { step: stepCount, type: "unknown_handler", endpoint: endpoint, body: body, error: "No handler for endpoint: " + endpoint };
                trace.push(entry);
                return { error: "unknown_handler", endpoint: endpoint };
              }

              // Clone body before passing to handler to prevent shared-reference mutation
              var clonedBody = structuredClonePolyfill(body);

              try {
                var previousState = structuredClonePolyfill(state);
                var result = handler(structuredClonePolyfill(state), clonedBody);

                // Validate handler response shape
                if (!result || typeof result !== "object" || !("nextState" in result) || !("response" in result)) {
                  var shapeEntry = { step: stepCount, type: "handler_shape_error", endpoint: endpoint, body: clonedBody, error: "Handler returned invalid shape" };
                  trace.push(shapeEntry);
                  return { error: "handler_shape_error", endpoint: endpoint };
                }

                state = result.nextState;

                // Run invariants after every handler call
                var invResults = runInvariants(state);
                for (var i = 0; i < invResults.length; i++) {
                  invariantResults.push(invResults[i]);
                }

                // Clone response before returning to attack code to prevent
                // shared-reference mutation of model state
                var clonedResponse = structuredClonePolyfill(result.response);

                var reqEntry = {
                  step: stepCount,
                  type: "request",
                  endpoint: endpoint,
                  body: clonedBody,
                  preStateSnapshot: previousState,
                  response: clonedResponse,
                  stateSnapshot: structuredClonePolyfill(state),
                  invariantResults: invResults,
                };
                trace.push(reqEntry);

                return clonedResponse;
              } catch (err) {
                // Sanitize error — only include message, not stack traces
                var errorMsg = err instanceof Error ? err.message : String(err);
                if (errorMsg.length > 200) errorMsg = errorMsg.slice(0, 200);
                var errEntry = { step: stepCount, type: "handler_error", endpoint: endpoint, body: clonedBody, error: errorMsg };
                trace.push(errEntry);
                return { error: "handler_error", endpoint: endpoint, message: errorMsg };
              }
            });

          api.expectRejected = hardenApiMethod(function expectRejected(response, reason) {
              stepCount++;
              // A null/undefined/falsy response is treated as rejected (error condition)
              const wasRejected = !response || response.status >= 400 || response.error || response.rejected === true;
              const entry = {
                step: stepCount,
                type: "expect_rejected",
                message: reason,
                response,
              };
              trace.push(entry);
              return { passed: !!wasRejected, reason, response };
            });

          api.expectAllowed = hardenApiMethod(function expectAllowed(response, reason) {
              stepCount++;
              // A null/undefined response is NOT allowed — must be a valid response object
              const wasAllowed = !!response && !response.error && (response.status === undefined || response.status < 400) && response.rejected !== true;
              const entry = {
                step: stepCount,
                type: "expect_allowed",
                message: reason,
                response,
              };
              trace.push(entry);
              return { passed: !!wasAllowed, reason, response };
            });

          api.assertInvariant = hardenApiMethod(function assertInvariant(invariantId) {
              stepCount++;
              var inv = frozenModel.invariants.find(function(i) { return i.id === invariantId; });
              if (!inv) {
                var entry = { step: stepCount, type: "invariant_check", message: "Unknown invariant: " + invariantId };
                trace.push(entry);
                return { holds: false, violation: "Unknown invariant: " + invariantId };
              }
              try {
                var result = inv.check(structuredClonePolyfill(state));
                var checkEntry = {
                  step: stepCount,
                  type: "invariant_check",
                  invariantResults: [{ id: invariantId, holds: result.holds, violation: result.violation }],
                };
                trace.push(checkEntry);
                return result;
              } catch (err) {
                var errorMsg = err instanceof Error ? err.message : String(err);
                if (errorMsg.length > 200) errorMsg = errorMsg.slice(0, 200);
                var errEntry = { step: stepCount, type: "invariant_check", error: errorMsg };
                trace.push(errEntry);
                return { holds: false, violation: "Invariant check threw: " + errorMsg };
              }
            });

          api.annotate = hardenApiMethod(function annotate(text) {
              stepCount++;
              trace.push({ step: stepCount, type: "annotation", message: String(text) });
            });

          api.finish = hardenApiMethod(function finish() {
              // Collect all invariant failures from the trace
              const allInvariantFailures = [];
              for (let i = 0; i < trace.length; i++) {
                const entry = trace[i];
                if (entry.invariantResults) {
                  for (let j = 0; j < entry.invariantResults.length; j++) {
                    if (!entry.invariantResults[j].holds) {
                      allInvariantFailures.push(entry.invariantResults[j]);
                    }
                  }
                }
              }

              // Collect annotations
              const annotations = [];
              for (let i = 0; i < trace.length; i++) {
                if (trace[i].type === "annotation") {
                  annotations.push(trace[i].message);
                }
              }

              return {
                trace: structuredClonePolyfill(trace),
                invariantFailures: allInvariantFailures,
                annotations: annotations,
                totalSteps: stepCount,
              };
            });

          _freeze(api);

          return api;
        }

        // Phase 2: Run attacks against the model
        const designApi = createDesignApi(model);
        const attackFn = new _Function("api", attackCode + "\nreturn adversarialSequence(api);");
        const result = await attackFn(designApi);
        _send({ type: "result", result });
      } catch (err) {
        _send({ type: "error", error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    // Test/Review mode
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
