# Agent 005: Recursive Verifier

A recursive verification framework that generates executable proof — not opinions — about code quality, design correctness, and system resilience.

## How It Works

The core loop: **reason → generate JavaScript code → execute in sandbox → measure outcome → iterate.**

The sandbox architecture (four-layer defense: Node 22 permission flags, global nullification, IPC-only toolkit, string-level validator) is ported from Agent 004's red team simulator and repurposed for constructive verification.

## Verification Modes

| Mode | What it verifies | Status |
|------|-----------------|--------|
| Test Generation | Behavior — "Does this code do what it should?" | Planned |
| Code Reviewer | Implementation — "Is this code correct and robust?" | Planned |
| API Design Adversary | Design — "Is this design sound before I build it?" | Planned |

## Setup

```bash
cp .env.example .env
# Add your ANTHROPIC_API_KEY to .env
npm install
```

## Usage

```bash
npm start -- --mode test-gen --target path/to/module.ts
```

## License

MIT
