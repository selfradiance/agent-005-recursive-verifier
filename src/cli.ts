// cli.ts — Entry point for Agent 005 Recursive Verifier.
//
// Parses CLI arguments, shows startup banner, loads .env, and kicks off
// the recursive test generation loop.

import "dotenv/config";
import fs from "node:fs";
import { run } from "./runner.js";
import { runDesignMode } from "./runner.js";
import { generateReport } from "./reporter.js";
import { generateReviewReport } from "./reporter-review.js";
import { generateDesignReport } from "./reporter-design.js";

// ---------------------------------------------------------------------------
// Argument parsing (minimal, no external deps)
// ---------------------------------------------------------------------------

export type Mode = "test" | "review" | "design";

interface CliArgs {
  file: string;
  functions?: string[];
  rounds: number;
  mode: Mode;
  verbose: boolean;
  help: boolean;
  spec: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    file: "",
    rounds: 3,
    mode: "test",
    verbose: false,
    help: false,
    spec: "",
  };

  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case "--file":
        args.file = argv[++i] ?? "";
        break;
      case "--functions":
        args.functions = (argv[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
        break;
      case "--rounds":
        args.rounds = parseInt(argv[++i] ?? "3", 10);
        break;
      case "--mode":
        // KNOWN LIMITATION (F-7): This cast accepts any string as Mode.
        // Validated later at line ~144 before use. The type is technically
        // a lie between parse and validate, but functionally safe.
        args.mode = (argv[++i] ?? "test") as Mode;
        break;
      case "--spec":
        args.spec = argv[++i] ?? "";
        break;
      case "--verbose":
        args.verbose = true;
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
    }
  }

  return args;
}

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

function printHelp(): void {
  console.log(`
Agent 005 — Recursive Verifier v0.3.0

USAGE:
  npx tsx src/cli.ts --file <path> [options]
  npx tsx src/cli.ts --mode design --spec <path> [options]

OPTIONS:
  --file <path>        Path to target .ts or .js module (required for test/review modes)
  --mode <mode>        "test" | "review" | "design" (default: test)
  --spec <path>        Path to API spec file (required for design mode, markdown or text)
  --functions <names>  Comma-separated function names to focus on (test/review modes)
  --rounds <n>         Number of recursive rounds (default: 3, max: 10)
  --verbose            Show generated code before execution
  --help, -h           Show this help message

EXAMPLES:
  npx tsx src/cli.ts --file examples/sample-math.ts
  npx tsx src/cli.ts --file src/parser.ts --mode review --rounds 5
  npx tsx src/cli.ts --mode design --spec examples/sample-api-spec.md
`);
}

// ---------------------------------------------------------------------------
// Startup banner
// ---------------------------------------------------------------------------

const MODE_LABELS: Record<Mode, string> = {
  test: "Test Generation",
  review: "Code Review",
  design: "API Design Adversary",
};

function printBanner(file: string, exportCount: number, rounds: number, mode: Mode): void {
  console.log(`
═══════════════════════════════════════════════════════════
  AGENT 005 — RECURSIVE VERIFIER v0.3.0
  Mode: ${MODE_LABELS[mode]}
  Target: ${file} (${exportCount} exports)
  Rounds: ${rounds}
  ⚠️  Target module runs unsandboxed. Trusted code only.
═══════════════════════════════════════════════════════════
`);
}

function printDesignBanner(specPath: string, rounds: number): void {
  console.log(`
═══════════════════════════════════════════════════════════
  AGENT 005 — RECURSIVE VERIFIER v0.3.0
  Mode: API Design Adversary
  Spec: ${specPath}
  Rounds: ${rounds}
═══════════════════════════════════════════════════════════
`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  // Validate --mode
  if (args.mode !== "test" && args.mode !== "review" && args.mode !== "design") {
    console.error(`Error: --mode must be "test", "review", or "design" (got: "${args.mode}")`);
    process.exit(1);
  }

  // Validate required args based on mode
  if (args.mode === "design") {
    if (!args.spec) {
      console.error("Error: --spec is required for design mode. Run with --help for usage.");
      process.exit(1);
    }
    if (!fs.existsSync(args.spec)) {
      console.error(`Error: spec file not found: ${args.spec}`);
      process.exit(1);
    }
  } else {
    if (!args.file) {
      console.error("Error: --file is required. Run with --help for usage.");
      process.exit(1);
    }
  }

  // Check for API key
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("Error: ANTHROPIC_API_KEY not set. Copy .env.example to .env and add your key.");
    process.exit(1);
  }

  // Validate --rounds
  if (!Number.isInteger(args.rounds) || args.rounds < 1) {
    const rawIdx = process.argv.indexOf("--rounds");
    const rawValue = rawIdx >= 0 ? process.argv[rawIdx + 1] ?? "undefined" : "undefined";
    console.error(`Error: --rounds must be a positive integer (got: ${rawValue})`);
    process.exit(1);
  }

  // Round cap
  if (args.rounds > 10) {
    console.log("Rounds capped at 10 (maximum for v0.3.0).");
    args.rounds = 10;
  }

  try {
    if (args.mode === "design") {
      // Design mode — no target module, just a spec file
      printDesignBanner(args.spec, args.rounds);

      const result = await runDesignMode({
        specPath: args.spec,
        rounds: args.rounds,
        verbose: args.verbose,
      });

      // Generate final report
      console.log("\n── Final Report ──────────────────────────────────────\n");
      const report = await generateDesignReport(result);
      console.log(report.summary);
      console.log("\n═══════════════════════════════════════════════════════════\n");
    } else {
      // Test or Review mode — needs a target module
      const { ModuleHost } = await import("./module-host.js");
      const moduleHost = new ModuleHost();
      await moduleHost.load(args.file);
      const exports = moduleHost.getExports();

      printBanner(args.file, exports.length, args.rounds, args.mode);

      if (exports.length === 0) {
        console.log("⚠️  No exported functions found in target module. Nothing to test.");
        process.exit(0);
      }

      console.log(`Exported functions: ${exports.join(", ")}\n`);

      // Run the recursive loop (pass pre-loaded module host)
      const result = await run({
        filePath: args.file,
        functions: args.functions,
        rounds: args.rounds,
        verbose: args.verbose,
        mode: args.mode,
        moduleHost,
      });

      // Generate final report
      console.log("\n── Final Report ──────────────────────────────────────\n");
      if (args.mode === "review") {
        const reviewScores = result.rounds
          .filter((r) => r.reviewScore !== null)
          .map((r) => r.reviewScore!);
        const report = await generateReviewReport({
          allVerdicts: result.allVerdicts,
          allHypotheses: result.allHypotheses,
          allScores: reviewScores,
          allFindings: result.allFindings,
          roundCount: result.rounds.length,
        });
        console.log(report.summary);
      } else {
        const report = await generateReport(result);
        console.log(report.summary);
      }
      console.log("\n═══════════════════════════════════════════════════════════\n");
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("Cannot find module")) {
      console.error(`Failed to load target module: ${err.message}`);
    } else {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
    process.exit(1);
  }
}

main();
