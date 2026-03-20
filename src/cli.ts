// cli.ts — Entry point for Agent 005 Recursive Verifier.
//
// Parses CLI arguments, shows startup banner, loads .env, and kicks off
// the recursive test generation loop.

import "dotenv/config";
import { run } from "./runner.js";
import { generateReport } from "./reporter.js";

// ---------------------------------------------------------------------------
// Argument parsing (minimal, no external deps)
// ---------------------------------------------------------------------------

interface CliArgs {
  file: string;
  functions?: string[];
  rounds: number;
  verbose: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    file: "",
    rounds: 3,
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
Agent 005 — Recursive Verifier v0.1.0
Mode: Test Generation

USAGE:
  npx tsx src/cli.ts --file <path> [options]

OPTIONS:
  --file <path>        Path to target .ts or .js module (required)
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

function printBanner(file: string, exportCount: number, rounds: number): void {
  console.log(`
═══════════════════════════════════════════════════════════
  AGENT 005 — RECURSIVE VERIFIER v0.1.0
  Mode: Test Generation
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

  // Round cap
  if (args.rounds > 10) {
    console.log("Rounds capped at 10 (maximum for v0.1.0).");
    args.rounds = 10;
  }
  if (args.rounds < 1) {
    args.rounds = 1;
  }

  try {
    // Quick-load module to get export count for banner
    const { ModuleHost } = await import("./module-host.js");
    const tempHost = new ModuleHost();
    await tempHost.load(args.file);
    const exports = tempHost.getExports();

    printBanner(args.file, exports.length, args.rounds);

    if (exports.length === 0) {
      console.log("⚠️  No exported functions found in target module. Nothing to test.");
      process.exit(0);
    }

    console.log(`Exported functions: ${exports.join(", ")}\n`);

    // Run the recursive loop
    const result = await run({
      filePath: args.file,
      functions: args.functions,
      rounds: args.rounds,
      verbose: args.verbose,
    });

    // Generate final report
    console.log("\n── Final Report ──────────────────────────────────────\n");
    const report = await generateReport(result);
    console.log(report.summary);
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
