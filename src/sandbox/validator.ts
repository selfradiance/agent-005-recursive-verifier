// validator.ts — Checks generated test code against blocklist, structural rules,
// and size limits before execution in the sandbox.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
  "Function(",
  "globalThis",
  "__dirname",
  "__filename",
  "module.",
  "exports.",
  "constructor.",
  "prototype.",
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

// ---------------------------------------------------------------------------
// validateGeneratedCode
// ---------------------------------------------------------------------------

export function validateGeneratedCode(code: string): ValidationResult {
  // 1. Size check (10KB max)
  if (code.length > 10_000) {
    return { valid: false, reason: "Code exceeds maximum length of 10KB" };
  }

  // 2. Blocklist check
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

  // String concatenation heuristic: fragment followed by + within 20 chars
  for (const frag of CONCAT_FRAGMENTS) {
    const idx = code.indexOf(frag);
    if (idx !== -1) {
      const after = code.slice(idx, idx + frag.length + 20);
      if (after.includes("+")) {
        return { valid: false, reason: `Blocked pattern found: string concatenation near ${frag}` };
      }
    }
  }

  // 3. Function signature check — must have exactly one generatedTests(toolkit)
  const sigPattern = "async function generatedTests(toolkit)";
  const firstIdx = code.indexOf(sigPattern);
  if (firstIdx === -1) {
    return { valid: false, reason: "Missing required function signature: async function generatedTests(toolkit)" };
  }
  const secondIdx = code.indexOf(sigPattern, firstIdx + sigPattern.length);
  if (secondIdx !== -1) {
    return { valid: false, reason: "Multiple function definitions found" };
  }

  // 4. Return shape check — must reference testsRun, testsPassed, testsFailed, results
  if (!code.includes("testsRun") || !code.includes("testsPassed") || !code.includes("testsFailed") || !code.includes("results")) {
    return { valid: false, reason: "Generated function must return { testsRun, testsPassed, testsFailed, results }" };
  }

  // 5. Nesting depth check (max 6 levels — 1 for function + 3 for loops + margin)
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
  if (maxDepth > 6) {
    return { valid: false, reason: "Code exceeds maximum nesting depth of 6" };
  }

  // 6. Toolkit call count check (max 20)
  let toolkitCount = 0;
  let searchIdx = 0;
  while (true) {
    const found = code.indexOf("toolkit.", searchIdx);
    if (found === -1) break;
    toolkitCount++;
    searchIdx = found + 8;
  }
  if (toolkitCount > 20) {
    return { valid: false, reason: "Code exceeds maximum of 20 toolkit calls" };
  }

  // 7. Unbounded loop check
  for (const pattern of UNBOUNDED_LOOPS) {
    if (pattern.test(code)) {
      return { valid: false, reason: "Unbounded loop detected" };
    }
  }

  return { valid: true };
}
