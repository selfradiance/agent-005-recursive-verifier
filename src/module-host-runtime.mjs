// module-host-runtime.mjs — Executes target module exports in a dedicated
// full-privilege child so synchronous hangs can be timed out safely.

import { pathToFileURL } from "node:url";
import { normalizeValue } from "./normalize.ts";

let loadedModule = null;

function getModuleForImport(filePath, cacheKey) {
  const url = pathToFileURL(filePath);
  url.searchParams.set("agent005_runtime", cacheKey);
  return url.href;
}

process.on("message", async (message) => {
  if (!message || typeof message !== "object" || message.type !== "runtime-request") {
    return;
  }

  const { id, command } = message;

  if (command === "load") {
    // KNOWN LIMITATION (F-6): This import() has no internal timeout. If the
    // target module hangs during top-level initialization, this child process
    // blocks forever. The parent's sendRuntimeRequest timeout will eventually
    // SIGKILL this process, but the error message won't distinguish a hang
    // from a crash.
    try {
      loadedModule = await import(getModuleForImport(message.filePath, message.cacheKey));
      const allExportNames = Object.keys(loadedModule);
      const functionExports = allExportNames.filter((name) => typeof loadedModule[name] === "function");

      process.send?.({
        type: "runtime-response",
        id,
        ok: true,
        payload: {
          allExportNames,
          functionExports,
        },
      });
    } catch (err) {
      process.send?.({
        type: "runtime-response",
        id,
        ok: false,
        errorKind: "load_error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }

  if (!loadedModule) {
    process.send?.({
      type: "runtime-response",
      id,
      ok: false,
      errorKind: "load_error",
      error: "Runtime module not loaded",
    });
    return;
  }

  if (command === "invoke") {
    const fn = loadedModule[message.fnName];
    if (typeof fn !== "function") {
      process.send?.({
        type: "runtime-response",
        id,
        ok: false,
        errorKind: "invalid_test",
        error: `INVALID_TEST: "${message.fnName}" is not an exported function`,
      });
      return;
    }

    try {
      const result = await fn(...(Array.isArray(message.args) ? message.args : []));
      process.send?.({
        type: "runtime-response",
        id,
        ok: true,
        payload: {
          result: normalizeValue(result),
        },
      });
    } catch (err) {
      process.send?.({
        type: "runtime-response",
        id,
        ok: false,
        errorKind: "execution_error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
});

process.on("disconnect", () => {
  process.exit(0);
});
