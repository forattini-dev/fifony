import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

type LintCheck = {
  id: string;
  roots: string[];
  extensions: Set<string>;
  pattern: RegExp;
  message: string;
};

type Violation = {
  file: string;
  line: number;
  snippet: string;
};

const ROOT = process.cwd();

const checks: LintCheck[] = [
  {
    id: "route-any",
    roots: ["src/routes", "src/persistence/plugins/api-server.ts"],
    extensions: new Set([".ts"]),
    pattern: /\bapp:\s*any\b|\bc:\s*any\b|RouteContext\s*\|\s*any|req\.param\?\(|req\.params\?\./,
    message: "Route boundaries must use the shared HTTP types instead of loose any/optional param access.",
  },
  {
    id: "destructive-git",
    roots: ["src"],
    extensions: new Set([".ts", ".js", ".jsx"]),
    pattern: /git reset --hard|git clean -fd\b/,
    message: "Runtime code must not use destructive git reset/clean flows.",
  },
  {
    id: "orphan-routes",
    roots: ["src", "app", "README.md"],
    extensions: new Set([".ts", ".js", ".jsx", ".md"]),
    pattern: /\/settings\/preferences|\/:id\/pipeline/,
    message: "Removed orphan routes must not reappear in product code or docs.",
  },
];

function collectFiles(root: string, extensions: Set<string>): string[] {
  const absoluteRoot = join(ROOT, root);
  let stats;
  try {
    stats = statSync(absoluteRoot);
  } catch {
    return [];
  }

  if (stats.isFile()) {
    const dot = root.lastIndexOf(".");
    const ext = dot >= 0 ? root.slice(dot) : "";
    return extensions.has(ext) ? [absoluteRoot] : [];
  }

  const files: string[] = [];
  for (const entry of readdirSync(absoluteRoot, { withFileTypes: true })) {
    const absolutePath = join(absoluteRoot, entry.name);
    const relativePath = absolutePath.slice(ROOT.length + 1);
    if (entry.isDirectory()) {
      files.push(...collectFiles(relativePath, extensions));
      continue;
    }
    const dot = entry.name.lastIndexOf(".");
    const ext = dot >= 0 ? entry.name.slice(dot) : "";
    if (extensions.has(ext)) files.push(absolutePath);
  }
  return files;
}

function findViolations(file: string, pattern: RegExp): Violation[] {
  const content = readFileSync(file, "utf8");
  const lines = content.split("\n");
  const violations: Violation[] = [];

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    pattern.lastIndex = 0;
    if (!pattern.test(line)) continue;
    violations.push({
      file: file.slice(ROOT.length + 1),
      line: index + 1,
      snippet: line.trim(),
    });
  }

  return violations;
}

const failures: Array<{ check: LintCheck; violations: Violation[] }> = [];

for (const check of checks) {
  const files = [...new Set(check.roots.flatMap((root) => collectFiles(root, check.extensions)))];
  const violations = files.flatMap((file) => findViolations(file, check.pattern));
  if (violations.length > 0) failures.push({ check, violations });
}

if (failures.length > 0) {
  console.error("Structural lint failed.\n");
  for (const failure of failures) {
    console.error(`[${failure.check.id}] ${failure.check.message}`);
    for (const violation of failure.violations) {
      console.error(`  - ${violation.file}:${violation.line} ${violation.snippet}`);
    }
    console.error("");
  }
  process.exit(1);
}

console.log("Structural lint passed.");
