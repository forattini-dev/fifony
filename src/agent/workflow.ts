import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { copyFile, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { argv, exit } from "node:process";
import {
  SOURCE_ROOT,
  SOURCE_MARKER,
  TARGET_ROOT,
} from "./constants.ts";
import {
  now,
  fail,
  parseIntArg,
} from "./helpers.ts";
import { logger } from "./logger.ts";

const SKIP_DIRS = new Set([
  ".git", ".fifony", "node_modules", ".venv", "data",
  "dist", "build", ".turbo", ".next", ".nuxt", ".tanstack",
  "coverage", "artifacts", "captures", "tmp", "temp",
]);

function shouldSkipPath(relativePath: string): boolean {
  const parts = relativePath.split("/");
  if (parts.some((segment) => SKIP_DIRS.has(segment))) return true;
  const base = parts.at(-1) ?? "";
  if (base.startsWith("map_scan_") && extname(base) === ".json") return true;
  if (extname(base) === ".xlsx") return true;
  return false;
}

export function bootstrapSource(): void {
  if (existsSync(SOURCE_MARKER)) return;

  logger.info("Creating local source snapshot for Fifony (local-only runtime)...");

  const copyRecursive = (source: string, target: string, rel = "") => {
    mkdirSync(target, { recursive: true });
    const items = readdirSync(source, { withFileTypes: true });

    for (const item of items) {
      const nextRel = rel ? `${rel}/${item.name}` : item.name;
      if (shouldSkipPath(nextRel)) continue;

      const sourcePath = `${source}/${item.name}`;
      const targetPath = `${target}/${item.name}`;
      const itemStat = statSync(sourcePath);

      if (item.isDirectory()) {
        copyRecursive(sourcePath, targetPath, nextRel);
        continue;
      }

      if (item.isSymbolicLink() || itemStat.isSymbolicLink()) continue;

      if (itemStat.isFile() || itemStat.isFIFO()) {
        try {
          const file = readFileSync(sourcePath);
          writeFileSync(targetPath, file);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            logger.debug(`Skipped missing source file: ${sourcePath}`);
          } else {
            throw error;
          }
        }
      }
    }
  };

  mkdirSync(SOURCE_ROOT, { recursive: true });
  copyRecursive(TARGET_ROOT, SOURCE_ROOT);
  writeFileSync(SOURCE_MARKER, `${now()}\n`, "utf8");
}

let sourceReadyPromise: Promise<void> | null = null;
let skipSourceFlag = false;

export function setSkipSource(skip: boolean): void {
  skipSourceFlag = skip;
}

/**
 * Async, lazy version of bootstrapSource().
 * Only runs the copy once, on first call. Subsequent calls resolve immediately.
 * Emits progress via optional callback.
 */
export async function ensureSourceReady(
  onProgress?: (status: "copying" | "ready") => void,
): Promise<void> {
  if (skipSourceFlag) {
    onProgress?.("ready");
    return;
  }
  if (existsSync(SOURCE_MARKER)) {
    onProgress?.("ready");
    return;
  }

  // Deduplicate concurrent calls
  if (sourceReadyPromise) return sourceReadyPromise;

  sourceReadyPromise = (async () => {
    onProgress?.("copying");
    logger.info("Creating local source snapshot (async) for Fifony...");

    const copyRecursiveAsync = async (source: string, target: string, rel = "") => {
      await mkdir(target, { recursive: true });
      const items = await readdir(source, { withFileTypes: true });

      for (const item of items) {
        const nextRel = rel ? `${rel}/${item.name}` : item.name;
        if (shouldSkipPath(nextRel)) continue;

        const sourcePath = `${source}/${item.name}`;
        const targetPath = `${target}/${item.name}`;
        const itemStat = await stat(sourcePath);

        if (item.isDirectory()) {
          await copyRecursiveAsync(sourcePath, targetPath, nextRel);
          continue;
        }

        if (item.isSymbolicLink() || itemStat.isSymbolicLink()) continue;

        if (itemStat.isFile() || itemStat.isFIFO()) {
          try {
            await copyFile(sourcePath, targetPath);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
              logger.debug(`Skipped missing source file: ${sourcePath}`);
            } else {
              throw error;
            }
          }
        }
      }
    };

    await mkdir(SOURCE_ROOT, { recursive: true });
    await copyRecursiveAsync(TARGET_ROOT, SOURCE_ROOT);
    await writeFile(SOURCE_MARKER, `${now()}\n`, "utf8");
    onProgress?.("ready");
    logger.info("Source snapshot ready (async).");
  })();

  return sourceReadyPromise;
}


export function parsePort(args: string[]): number | undefined {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      console.log(
        `Usage: ${argv[1]} [options]\n` +
        "Options:\n" +
        "  --port <n>             Start local dashboard (default: no UI and single batch run)\n" +
        "  --workspace <path>     Target workspace root (default: current directory)\n" +
        "  --persistence <path>   Persistence root (default: current directory)\n" +
        "  --concurrency <n>      Maximum number of parallel issue runners\n" +
        "  --attempts <n>         Maximum attempts per issue\n" +
        "  --poll <ms>            Polling interval for the scheduler\n" +
        "  --once                  Run one local batch and exit\n" +
        "  --help                  Show this message",
      );
      exit(0);
    }

    if (arg === "--port") {
      const value = args[i + 1];
      if (!value || !/^\d+$/.test(value)) {
        fail(`Invalid value for --port: ${value ?? "<empty>"}`);
      }
      return parseIntArg(value, 4040);
    }
  }

  return undefined;
}

