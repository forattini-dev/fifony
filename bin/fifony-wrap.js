#!/usr/bin/env node
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { env, exit, argv } from "node:process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = resolve(__dirname, "..");

const distEntry = resolve(packageRoot, "dist", "agent", "cli-wrapper.js");
const srcEntry = resolve(packageRoot, "src", "agent", "cli-wrapper.ts");
const forceSource = argv.includes("--dev") || env.NODE_ENV === "development";
const hasCompiled = existsSync(distEntry);
const hasSrc = existsSync(srcEntry);

if (hasCompiled && !forceSource) {
  import(new URL(`file://${distEntry}`).href).catch((error) => {
    console.error(`Failed to start fifony-wrap: ${String(error)}`);
    exit(1);
  });
} else if (hasSrc) {
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

  const child = spawn(execPath, [tsxCli, srcEntry, ...argv.slice(2)], {
    stdio: "inherit",
    env: { ...env },
  });

  child.on("exit", (code, signal) => {
    if (signal) { process.kill(process.pid, signal); return; }
    exit(code ?? 1);
  });

  child.on("error", (error) => {
    console.error(`Failed to start fifony-wrap: ${String(error)}`);
    exit(1);
  });
} else {
  console.error("fifony-wrap entry point not found. Try: pnpm build");
  exit(1);
}
