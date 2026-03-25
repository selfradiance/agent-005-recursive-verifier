// validator.ts — Checks generated test code against blocklist, structural rules,
// and size limits before execution in the sandbox.

import type { Mode } from "../cli.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ValidatorMode = Mode | "generatedModel" | "generatedAttacks";

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Blocklist (same 34+ patterns from Agent 004)
// ---------------------------------------------------------------------------

const BLOCKLIST = [
  "require(",
  "import ",
  "import(",
  "process.",
  "fs.",
  "child_process",
  "net.",
  "http.",
  "https.",
  "fetch(",
  "eval(",
  "globalThis",
  "__dirname",
  "__filename",
  "module.",
  "exports.",
  "constructor.",
  "constructor[",
  '["constructor"]',
  "['constructor']",
  "prototype.",
  "__proto__",
  "Reflect.",
  "Reflect[",
  "Proxy",
  "Symbol.",
  "Symbol(",
  "AsyncFunction",
  "WebAssembly",
  "setImmediate",
  "queueMicrotask",
  "setTimeout",
  "setInterval",
  "dns.",
  "tls.",
  "worker_threads",
  "Object.defineProperty",
  "Object.setPrototypeOf",
  "Object.create(",
  "Object.getOwnPropertyDescriptor",
  "__defineGetter__",
  "__defineSetter__",
];

const OBFUSCATION_PATTERNS = [
  "fromCharCode",
  "atob(",
  "btoa(",
];

// Fragments that might be concatenated to reconstruct blocked identifiers
const CONCAT_FRAGMENTS = ["'req'", '"req"', "'imp'", '"imp"', "'pro'", '"pro"', "'fet'", '"fet"'];

// ---------------------------------------------------------------------------
// Unbounded loop patterns
// ---------------------------------------------------------------------------

const UNBOUNDED_LOOPS = [
  /while\s*\(\s*true\s*\)/,
  /while\s*\(\s*1\s*\)/,
  /for\s*\(\s*;\s*;\s*\)/,
];

// Standalone Function( — blocks `Function(` and `new Function(` but allows `callFunction(`
const STANDALONE_FUNCTION_PATTERN = /(?<![a-zA-Z])Function\s*\(/;

// Catch constructor access via string literal assigned to variable
// e.g., var c = 'constructor' or var c = "constructor"
const CONSTRUCTOR_STRING_PATTERN = /['"]constructor['"]/;

// ---------------------------------------------------------------------------
// Direct model access patterns (blocked in attack code)
// ---------------------------------------------------------------------------

const MODEL_DIRECT_ACCESS_PATTERNS = [
  "model.handlers",
  "model.invariants",
  "model.initState",
  "model[",
];

// ---------------------------------------------------------------------------
// Common blocklist + obfuscation checks (shared across all modes)
// ---------------------------------------------------------------------------

function checkBlocklist(code: string): ValidationResult | null {
  for (const pattern of BLOCKLIST) {
    if (code.includes(pattern)) {
      return { valid: false, reason: `Blocked pattern found: ${pattern}` };
    }
  }

  for (const pattern of OBFUSCATION_PATTERNS) {
    if (code.includes(pattern)) {
      return { valid: false, reason: `Blocked pattern found: ${pattern}` };
    }
  }

  if (STANDALONE_FUNCTION_PATTERN.test(code)) {
    return { valid: false, reason: "Blocked pattern found: Function(" };
  }

  if (CONSTRUCTOR_STRING_PATTERN.test(code)) {
    return { valid: false, reason: "Blocked pattern found: constructor string literal" };
  }

  for (const frag of CONCAT_FRAGMENTS) {
    const idx = code.indexOf(frag);
    if (idx !== -1) {
      const after = code.slice(idx, idx + frag.length + 20);
      if (after.includes("+")) {
        return { valid: false, reason: `Blocked pattern found: string concatenation near ${frag}` };
      }
    }
  }

  for (const pattern of UNBOUNDED_LOOPS) {
    if (pattern.test(code)) {
      return { valid: false, reason: "Unbounded loop detected" };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Nesting depth check
// ---------------------------------------------------------------------------

function checkNestingDepth(code: string, maxAllowed: number): ValidationResult | null {
  let maxDepth = 0;
  let currentDepth = 0;
  for (const ch of code) {
    if (ch === "{") {
      currentDepth++;
      if (currentDepth > maxDepth) maxDepth = currentDepth;
    } else if (ch === "}") {
      currentDepth--;
    }
  }
  if (maxDepth > maxAllowed) {
    return { valid: false, reason: `Code exceeds maximum nesting depth of ${maxAllowed}` };
  }
  return null;
}

// ---------------------------------------------------------------------------
// validateGeneratedCode — main entry point
// ---------------------------------------------------------------------------

export function validateGeneratedCode(code: string, mode: ValidatorMode = "test"): ValidationResult {
  // Route to design-specific validators
  if (mode === "generatedModel") {
    return validateGeneratedModel(code);
  }
  if (mode === "generatedAttacks") {
    return validateGeneratedAttacks(code);
  }

  // Original test/review mode validation
  // 1. Size check (10KB max)
  if (code.length > 10_000) {
    return { valid: false, reason: "Code exceeds maximum length of 10KB" };
  }

  // 2. Blocklist check
  const blocklistResult = checkBlocklist(code);
  if (blocklistResult) return blocklistResult;

  // 3. Function signature check — mode-dependent
  const sigPattern = mode === "review"
    ? "async function generatedProofs(toolkit)"
    : "async function generatedTests(toolkit)";
  const firstIdx = code.indexOf(sigPattern);
  if (firstIdx === -1) {
    return { valid: false, reason: `Missing required function signature: ${sigPattern}` };
  }
  const secondIdx = code.indexOf(sigPattern, firstIdx + sigPattern.length);
  if (secondIdx !== -1) {
    return { valid: false, reason: "Multiple function definitions found" };
  }

  // 4. Return shape check — mode-dependent
  if (mode === "review") {
    if (!code.includes("toolkit.prove(")) {
      return { valid: false, reason: "Review mode proof scripts must contain at least one toolkit.prove() call" };
    }
  } else {
    if (!code.includes("testsRun") || !code.includes("testsPassed") || !code.includes("testsFailed") || !code.includes("results")) {
      return { valid: false, reason: "Generated function must return { testsRun, testsPassed, testsFailed, results }" };
    }
  }

  // 5. Nesting depth check (max 6)
  const nestingResult = checkNestingDepth(code, 6);
  if (nestingResult) return nestingResult;

  // 6. Toolkit call count check (test: max 20, review: max 50)
  const maxToolkitCalls = mode === "review" ? 50 : 20;
  let toolkitCount = 0;
  let searchIdx = 0;
  while (true) {
    const found = code.indexOf("toolkit.", searchIdx);
    if (found === -1) break;
    toolkitCount++;
    searchIdx = found + 8;
  }
  if (toolkitCount > maxToolkitCalls) {
    return { valid: false, reason: `Code exceeds maximum of ${maxToolkitCalls} toolkit calls` };
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// validateGeneratedModel — checks for generatedModel mode
// ---------------------------------------------------------------------------

function validateGeneratedModel(code: string): ValidationResult {
  // 1. Size check (50KB max for models)
  if (code.length > 50_000) {
    return { valid: false, reason: "Model code exceeds maximum length of 50KB" };
  }

  // 2. Blocklist check
  const blocklistResult = checkBlocklist(code);
  if (blocklistResult) return blocklistResult;

  // 3. Must export required fields: assumptions, initState, handlers, invariants
  if (!code.includes("assumptions")) {
    return { valid: false, reason: "Model must define assumptions array" };
  }
  if (!code.includes("initState")) {
    return { valid: false, reason: "Model must define initState function" };
  }
  if (!code.includes("handlers")) {
    return { valid: false, reason: "Model must define handlers object" };
  }
  if (!code.includes("invariants")) {
    return { valid: false, reason: "Model must define invariants array" };
  }

  // 4. Handlers must be synchronous (no async in handler definitions)
  // Check for async in handler context — look for "async" followed by "(state"
  if (/async\s*\(\s*state\s*,/.test(code) || /async\s+function\s*\(\s*state/.test(code)) {
    return { valid: false, reason: "Model handlers must be synchronous (no async)" };
  }

  // 5. Nesting depth check (max 10 for models — handlers have nested if/for blocks)
  const nestingResult = checkNestingDepth(code, 10);
  if (nestingResult) return nestingResult;

  // 6. Must contain at least one inline comment with spec reference
  if (!code.includes("//")) {
    return { valid: false, reason: "Model handlers must contain inline comments with spec references" };
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// validateGeneratedAttacks — checks for generatedAttacks mode
// ---------------------------------------------------------------------------

function validateGeneratedAttacks(code: string): ValidationResult {
  // 1. Size check (10KB max for attacks)
  if (code.length > 10_000) {
    return { valid: false, reason: "Attack code exceeds maximum length of 10KB" };
  }

  // 2. Blocklist check
  const blocklistResult = checkBlocklist(code);
  if (blocklistResult) return blocklistResult;

  // 3. Must use api.reset()
  if (!code.includes("api.reset()")) {
    return { valid: false, reason: "Attack sequences must call api.reset()" };
  }

  // 4. Must return via api.finish()
  if (!code.includes("api.finish()")) {
    return { valid: false, reason: "Attack sequences must call api.finish()" };
  }

  // 5. Must NOT access model internals directly
  for (const pattern of MODEL_DIRECT_ACCESS_PATTERNS) {
    if (code.includes(pattern)) {
      return { valid: false, reason: `Attack code must not access model internals directly: ${pattern}` };
    }
  }

  // 6. Nesting depth check (max 5 for attacks)
  const nestingResult = checkNestingDepth(code, 5);
  if (nestingResult) return nestingResult;

  // 7. Handler call count check (max 50 api.request calls — multiple sequences need room)
  let requestCount = 0;
  let searchIdx = 0;
  while (true) {
    const found = code.indexOf("api.request(", searchIdx);
    if (found === -1) break;
    requestCount++;
    searchIdx = found + 12;
  }
  if (requestCount > 50) {
    return { valid: false, reason: "Attack code exceeds maximum of 50 api.request() calls" };
  }

  // 8. Must contain the function signature
  if (!code.includes("async function adversarialSequence(api)")) {
    return { valid: false, reason: "Missing required function signature: async function adversarialSequence(api)" };
  }

  return { valid: true };
}
