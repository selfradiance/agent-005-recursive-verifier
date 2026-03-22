// executor.ts — Parent-side sandbox executor. Manages the full lifecycle of
// running generated test code in a permission-restricted child process.

import { fork, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { attachToolkitHost, type ToolkitCallLog } from "./toolkit-host.js";
import type { ModuleHost } from "../module-host.js";
import type { ProofVerdict } from "../types.js";
import type { Mode } from "../cli.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TestResult {
  label: string;
  status: string;
  details?: unknown;
}

export interface SandboxResult {
  success: boolean;
  result?: {
    testsRun: number;
    testsPassed: number;
    testsFailed: number;
    results: TestResult[];
  };
  error?: string;
  timedOut?: boolean;
  logs: string[];
  durationMs: number;
  callLog: ToolkitCallLog[];
  proofVerdicts: ProofVerdict[];
}

export interface ExecutorOptions {
  moduleHost: ModuleHost;
  mode?: Mode;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CHILD_RUNNER_SOURCE = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "child-runner.js",
);
const TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

export async function executeInSandbox(
  code: string,
  options: ExecutorOptions,
): Promise<SandboxResult> {
  const startTime = Date.now();
  const logs: string[] = [];
  let callLog: ToolkitCallLog[] = [];
  let proofVerdicts: ProofVerdict[] = [];
  let tempDir: string | undefined;

  try {
    // Step 1: Create temp directory and resolve symlinks (macOS: /var → /private/var)
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-005-sandbox-"));
    const realTempDir = fs.realpathSync(tempDir);

    // Step 2: Copy child runner into temp directory
    const childRunnerDest = path.join(realTempDir, "child-runner.js");
    fs.copyFileSync(CHILD_RUNNER_SOURCE, childRunnerDest);

    // Step 3: Spawn child process with permission flags
    const result = await new Promise<SandboxResult>((resolve) => {
      let settled = false;

      function settle(r: SandboxResult) {
        if (!settled) {
          settled = true;
          resolve(r);
        }
      }

      let child: ChildProcess;
      try {
        child = fork(childRunnerDest, [], {
          env: { NODE_ENV: "sandbox" },
          execArgv: [
            "--permission",
            "--allow-fs-read=" + realTempDir,
            "--max-old-space-size=64",
          ],
          stdio: ["pipe", "pipe", "pipe", "ipc"],
        });
      } catch (err) {
        settle({
          success: false,
          error: `Failed to spawn child process: ${err instanceof Error ? err.message : String(err)}`,
          logs,
          durationMs: Date.now() - startTime,
          callLog: [],
          proofVerdicts: [],
        });
        return;
      }

      // Attach verification toolkit host
      const hostResult = attachToolkitHost(child, {
        moduleHost: options.moduleHost,
      });
      callLog = hostResult.callLog;
      proofVerdicts = hostResult.proofVerdicts;

      // Step 4: Set up 15-second hard timeout
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        settle({
          success: false,
          timedOut: true,
          error: `Sandbox execution timed out after ${TIMEOUT_MS / 1000}s`,
          logs,
          durationMs: Date.now() - startTime,
          callLog,
          proofVerdicts,
        });
      }, TIMEOUT_MS);

      // Step 5: Collect logs and results via IPC
      child.on("message", (msg: unknown) => {
        const m = msg as Record<string, unknown>;
        if (!m || typeof m !== "object") return;

        // toolkit-request messages are handled by the attached host — skip here
        if (m.type === "toolkit-request") return;

        if (m.type === "log" && typeof m.message === "string") {
          logs.push(m.message);
          return;
        }

        if (m.type === "result") {
          clearTimeout(timer);
          child.kill();
          settle({
            success: true,
            result: m.result as SandboxResult["result"],
            logs,
            durationMs: Date.now() - startTime,
            callLog,
            proofVerdicts,
          });
          return;
        }

        if (m.type === "error") {
          clearTimeout(timer);
          child.kill();
          settle({
            success: false,
            error: typeof m.error === "string" ? m.error : "Unknown error from child",
            logs,
            durationMs: Date.now() - startTime,
            callLog,
            proofVerdicts,
          });
          return;
        }
      });

      // Step 6: Handle child events
      child.on("error", (err) => {
        clearTimeout(timer);
        settle({
          success: false,
          error: `Child process error: ${err.message}`,
          logs,
          durationMs: Date.now() - startTime,
          callLog,
          proofVerdicts,
        });
      });

      child.on("exit", (exitCode, signal) => {
        clearTimeout(timer);
        settle({
          success: false,
          error: `Child process exited unexpectedly (code: ${exitCode}, signal: ${signal})`,
          logs,
          durationMs: Date.now() - startTime,
          callLog,
          proofVerdicts,
        });
      });

      // Step 7: Send the code to execute
      child.send({ type: "execute", code, mode: options.mode ?? "test" });
    });

    return result;
  } catch (err) {
    return {
      success: false,
      error: `Executor error: ${err instanceof Error ? err.message : String(err)}`,
      logs,
      durationMs: Date.now() - startTime,
      callLog,
      proofVerdicts,
    };
  } finally {
    // Step 8: Cleanup temp directory
    if (tempDir) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Best effort cleanup
      }
    }
  }
}
