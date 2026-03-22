// cli.ts — Entry point for Agent 005 Recursive Verifier.
//
// Parses CLI arguments, shows startup banner, loads .env, and kicks off
// the recursive test generation loop.

import "dotenv/config";
import { run } from "./runner.js";
import { generateReport } from "./reporter.js";
import { generateReviewReport } from "./reporter-review.js";

// ---------------------------------------------------------------------------
// Argument parsing (minimal, no external deps)
// ---------------------------------------------------------------------------

export type Mode = "test" | "review";

interface CliArgs {
  file: string;
  functions?: string[];
  rounds: number;
  mode: Mode;
  verbose: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    file: "",
    rounds: 3,
    mode: "test",
    verbose: false,
    help: false,
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
        args.mode = (argv[++i] ?? "test") as Mode;
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
Agent 005 — Recursive Verifier v0.2.0

USAGE:
  npx tsx src/cli.ts --file <path> [options]

OPTIONS:
  --file <path>        Path to target .ts or .js module (required)
  --mode <mode>        "test" (v0.1.0 test generation) or "review" (v0.2.0 code review) (default: test)
  --functions <names>  Comma-separated function names to focus on
  --rounds <n>         Number of recursive rounds (default: 3, max: 10)
  --verbose            Show generated test code before execution
  --help, -h           Show this help message

⚠️  Target module runs in the parent process (not sandboxed).
    Use trusted, local modules only. Pure functions work best.

EXAMPLES:
  npx tsx src/cli.ts --file src/utils/math.ts
  npx tsx src/cli.ts --file src/parser.ts --functions "parse,validate" --rounds 5
  npx tsx src/cli.ts --file examples/sample-math.ts --verbose
`);
}

// ---------------------------------------------------------------------------
// Startup banner
// ---------------------------------------------------------------------------

const MODE_LABELS: Record<Mode, string> = {
  test: "Test Generation",
  review: "Code Review",
};

function printBanner(file: string, exportCount: number, rounds: number, mode: Mode): void {
  console.log(`
═══════════════════════════════════════════════════════════
  AGENT 005 — RECURSIVE VERIFIER v0.2.0
  Mode: ${MODE_LABELS[mode]}
  Target: ${file} (${exportCount} exports)
  Rounds: ${rounds}
  ⚠️  Target module runs unsandboxed. Trusted code only.
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

  // Validate required args
  if (!args.file) {
    console.error("Error: --file is required. Run with --help for usage.");
    process.exit(1);
  }

  // Check for API key
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("Error: ANTHROPIC_API_KEY not set. Copy .env.example to .env and add your key.");
    process.exit(1);
  }

  // Validate --mode
  if (args.mode !== "test" && args.mode !== "review") {
    console.error(`Error: --mode must be "test" or "review" (got: "${args.mode}")`);
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
    console.log("Rounds capped at 10 (maximum for v0.2.0).");
    args.rounds = 10;
  }

  try {
    // Load module once for banner info, then pass to runner
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
