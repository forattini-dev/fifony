#!/usr/bin/env node
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { cwd, env, exit, argv, stderr } from "node:process";

// Immediate visual feedback before any heavy import. Module loading + tsx
// transpilation can take several seconds on first run; without this the
// terminal sits silent and the user thinks nothing is happening.
const QUIET = argv.includes("--quiet") || argv.includes("--silent") || argv.includes("--help") || argv.includes("-h");
if (!QUIET) {
  stderr.write("fifony: starting…\n");
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = resolve(__dirname, "..");
const workspaceRoot = env.FIFONY_WORKSPACE_ROOT ?? cwd();

// Make the package root available to all child processes (used by pty-daemon path resolution)
process.env.FIFONY_PKG_ROOT = packageRoot;

const distCli = resolve(packageRoot, "dist", "cli.js");
const srcCli = resolve(packageRoot, "src", "cli.ts");
const forceSource = argv.includes("--dev") || env.NODE_ENV === "development";
const hasCompiled = existsSync(distCli);
const hasSrc = existsSync(srcCli);

// Always prefer compiled dist — it's what ships in the npm package
if (hasCompiled && !forceSource) {
  process.env.FIFONY_WORKSPACE_ROOT = workspaceRoot;
  const cliUrl = new URL(`file://${distCli}`).href;
  import(cliUrl).catch((error) => {
    console.error(`Failed to start fifony: ${String(error)}`);
    exit(1);
  });
} else if (hasSrc) {
  // Development: use tsx to run TypeScript source
  const { spawn } = await import("node:child_process");
  const { createRequire } = await import("node:module");
  const { execPath } = await import("node:process");
  const require = createRequire(import.meta.url);

  let tsxCli;
  try {
    tsxCli = require.resolve("tsx/cli");
  } catch {
    console.error("Source found but tsx is not installed. Run 'pnpm install' or 'pnpm build' first.");
    exit(1);
  }

  const child = spawn(execPath, [tsxCli, srcCli, ...argv.slice(2)], {
    cwd: workspaceRoot,
    stdio: "inherit",
    env: { ...env, FIFONY_WORKSPACE_ROOT: workspaceRoot },
  });

  child.on("exit", (code, signal) => {
    if (signal) { process.kill(process.pid, signal); return; }
    exit(code ?? 1);
  });

  child.on("error", (error) => {
    console.error(`Failed to start fifony CLI: ${String(error)}`);
    exit(1);
  });
} else {
  console.error(`Fifony CLI entry point not found.`);
  console.error(`  Package root: ${packageRoot}`);
  console.error(`  Checked: ${distCli} (exists: ${hasCompiled})`);
  console.error(`  Checked: ${srcCli} (exists: ${hasSrc})`);
  console.error(`  Try: npx -y fifony@latest  or  pnpm build`);
  exit(1);
}
