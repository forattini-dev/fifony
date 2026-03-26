import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import type {
  AgentContextHit,
  AgentContextHitKind,
  AgentContextPack,
  AgentProviderRole,
  AgentTraceStep,
  IssueEntry,
  RuntimeState,
} from "../types.ts";
import { TARGET_ROOT } from "../concerns/constants.ts";
import { now } from "../concerns/helpers.ts";
import { logger } from "../concerns/logger.ts";
import { getContextFragmentResource, getIssueStateResource } from "../persistence/store.ts";
import { getEmbeddingProvider } from "./embedding-provider.ts";
import { getMemoryEngine } from "./memory-engine.ts";

type QueryInputs = {
  role: AgentProviderRole;
  title: string;
  description?: string;
  issue?: IssueEntry;
  workspacePath?: string;
  previousOutput?: string;
  nextPrompt?: string;
  runtimeState?: RuntimeState | null;
};

type LexicalCandidate = {
  path: string;
  absolutePath: string;
  score: number;
  excerpt: string;
  kind: AgentContextHitKind;
  reason: string;
  source: AgentContextHit["source"];
};

type FragmentSeed = {
  kind: AgentContextHitKind;
  sourcePath?: string;
  sourceId: string;
  issueId?: string;
  role?: AgentProviderRole;
  text: string;
};

type StoredContextFragment = {
  id: string;
  projectKey: string;
  kind: AgentContextHitKind;
  sourcePath?: string;
  sourceId: string;
  issueId?: string;
  role?: AgentProviderRole;
  hash: string;
  text: string;
  embedding?: number[];
  createdAt: string;
  updatedAt: string;
};

const TEXT_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".json", ".md", ".mdx", ".txt", ".yml", ".yaml", ".toml",
  ".css", ".html", ".sh", ".sql",
]);

const SKIP_SEGMENTS = new Set([
  ".git", ".fifony", "node_modules", "dist", "build", "coverage", ".next", ".nuxt", ".turbo", "workspaces",
]);

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "from", "that", "this", "into", "then", "when", "will", "have", "your",
  "issue", "agent", "plan", "review", "code", "work", "task", "need", "make", "uses", "using",
  "what", "where", "which", "should", "must", "does", "dont", "cannot", "just",
]);

const DEFAULT_DOC_FILES = [
  "README.md",
  "CLAUDE.md",
  "WORKFLOW.md",
  "WORKFLOW.local.md",
  "package.json",
  "tsconfig.json",
];

const PROJECT_KEY = createHash("sha1").update(TARGET_ROOT).digest("hex").slice(0, 12);

function stableId(prefix: string, value: string): string {
  return `${prefix}-${createHash("sha1").update(value).digest("hex").slice(0, 12)}`;
}

function classifyPath(filePath: string): AgentContextHitKind {
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();
  const ext = extname(normalized);
  if (normalized.includes("/test") || normalized.includes(".test.") || normalized.includes(".spec.")) return "test";
  if (basename(normalized) === "claude.md" || basename(normalized).startsWith("workflow")) return "doc";
  if (ext === ".md" || ext === ".mdx" || ext === ".txt") return "doc";
  if (ext === ".json" || ext === ".toml" || ext === ".yml" || ext === ".yaml") return "config";
  return "code-snippet";
}

function extractTokens(text: string): string[] {
  const counts = new Map<string, number>();
  const normalized = text
    .toLowerCase()
    .replace(/[`"'()[\]{}:;,.!?/\\|<>*=+#-]+/g, " ")
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  for (const token of normalized) {
    if (token.length < 3 || STOP_WORDS.has(token)) continue;
    counts.set(token, (counts.get(token) || 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([token]) => token);
}

function buildQueryText(input: QueryInputs): string {
  return [
    input.title,
    input.description || "",
    input.issue?.plan?.summary || "",
    input.nextPrompt || "",
    input.previousOutput ? input.previousOutput.slice(-1200) : "",
    input.issue?.lastError || "",
  ].filter(Boolean).join("\n\n");
}

function resolveSearchRoot(input: QueryInputs): string {
  if (input.issue?.worktreePath && existsSync(input.issue.worktreePath)) {
    return input.issue.worktreePath;
  }
  if (!input.workspacePath) return TARGET_ROOT;
  if (existsSync(input.workspacePath)) return input.workspacePath;
  const workspacePath = input.workspacePath;
  const worktreePath = join(workspacePath, "worktree");
  if (existsSync(worktreePath)) return worktreePath;
  return TARGET_ROOT;
}

function shouldIndexFile(relativePath: string, absolutePath: string): boolean {
  const parts = relativePath.split("/").filter(Boolean);
  if (parts.some((part) => SKIP_SEGMENTS.has(part))) return false;
  const ext = extname(relativePath);
  if (!TEXT_EXTENSIONS.has(ext) && !DEFAULT_DOC_FILES.includes(basename(relativePath))) return false;
  try {
    return statSync(absolutePath).size <= 200_000;
  } catch {
    return false;
  }
}

function listTextFiles(root: string): string[] {
  try {
    const output = execFileSync("rg", ["--files"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((filePath) => shouldIndexFile(filePath, join(root, filePath)));
  } catch {
    const results: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const absolutePath = join(dir, entry.name);
        const relativePath = relative(root, absolutePath).replace(/\\/g, "/");
        if (!relativePath || relativePath.startsWith("..")) continue;
        if (entry.isDirectory()) {
          if (relativePath.split("/").some((part) => SKIP_SEGMENTS.has(part))) continue;
          walk(absolutePath);
          continue;
        }
        if (shouldIndexFile(relativePath, absolutePath)) results.push(relativePath);
      }
    };
    walk(root);
    return results;
  }
}

function readTextFileSafe(absolutePath: string): string {
  try {
    return readFileSync(absolutePath, "utf8");
  } catch {
    return "";
  }
}

function normalizeExcerpt(value: string, max = 420): string {
  const compact = value.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  return compact.length > max ? `${compact.slice(0, max).trimEnd()}...` : compact;
}

function extractExcerpt(text: string, tokens: string[], max = 420): string {
  if (!text.trim()) return "";
  const lower = text.toLowerCase();
  for (const token of tokens) {
    const index = lower.indexOf(token);
    if (index >= 0) {
      const start = Math.max(0, index - 180);
      const end = Math.min(text.length, index + 240);
      return normalizeExcerpt(text.slice(start, end), max);
    }
  }
  return normalizeExcerpt(text.slice(0, max), max);
}

function scorePathAndContent(relativePath: string, text: string, tokens: string[]): { score: number; matched: boolean } {
  const pathLower = relativePath.toLowerCase();
  const textLower = text.toLowerCase();
  let score = 0;
  let matched = false;
  for (const token of tokens) {
    if (pathLower.includes(token)) {
      score += 18;
      matched = true;
    }
    if (textLower.includes(token)) {
      score += 6;
      matched = true;
    }
  }
  if (relativePath.includes("README") || relativePath.includes("CLAUDE") || relativePath.includes("WORKFLOW")) score += 8;
  if (relativePath.includes(".test.") || relativePath.includes(".spec.")) score += 4;
  return { score, matched };
}

function chunkText(text: string, maxChars = 1000, overlap = 120): string[] {
  const normalized = text.trim();
  if (!normalized) return [];
  if (normalized.length <= maxChars) return [normalized];
  const chunks: string[] = [];
  let offset = 0;
  while (offset < normalized.length) {
    const next = normalized.slice(offset, offset + maxChars).trim();
    if (next) chunks.push(next);
    offset += Math.max(1, maxChars - overlap);
  }
  return chunks.slice(0, 6);
}

function stripKnownSuffixes(fileName: string): string {
  return fileName
    .replace(/\.(test|spec)$/i, "")
    .replace(/\.(tsx?|jsx?|mjs|cjs)$/i, "");
}

function buildStructuralNeighbors(
  candidates: LexicalCandidate[],
  root: string,
  allFiles: string[],
  tokens: string[],
): LexicalCandidate[] {
  const neighbors: LexicalCandidate[] = [];
  const existing = new Set(candidates.map((candidate) => candidate.path));
  const knownConfigs = new Set(["package.json", "tsconfig.json", "vite.config.ts", "vitest.config.ts", "README.md", "CLAUDE.md"]);

  const addNeighbor = (pathValue: string, score: number, reason: string) => {
    const relativePath = pathValue.replace(/\\/g, "/");
    if (existing.has(relativePath)) return;
    const absolutePath = join(root, relativePath);
    if (!existsSync(absolutePath)) return;
    const text = readTextFileSafe(absolutePath);
    if (!text) return;
    existing.add(relativePath);
    neighbors.push({
      path: relativePath,
      absolutePath,
      score,
      excerpt: extractExcerpt(text, tokens),
      kind: classifyPath(relativePath),
      reason,
      source: "structural",
    });
  };

  for (const candidate of candidates.slice(0, 4)) {
    const normalizedPath = candidate.path.replace(/\\/g, "/");
    const fileName = basename(normalizedPath);
    const stem = stripKnownSuffixes(fileName);
    const directory = normalizedPath.includes("/") ? normalizedPath.slice(0, normalizedPath.lastIndexOf("/")) : "";

    if (candidate.kind !== "test") {
      const siblingTests = allFiles.filter((filePath) => {
        const normalized = filePath.replace(/\\/g, "/");
        const sameDir = directory ? normalized.startsWith(`${directory}/`) : !normalized.includes("/");
        const testName = basename(normalized);
        return sameDir && new RegExp(`^${stem}\\.(test|spec)\\.(tsx?|jsx?|mjs|cjs)$`, "i").test(testName);
      });
      for (const pathValue of siblingTests.slice(0, 2)) {
        addNeighbor(pathValue, candidate.score - 6, "Sibling test for a strong code match");
      }
    }

    if (normalizedPath.includes("/routes/")) {
      const routePairs = allFiles.filter((filePath) => {
        const normalized = filePath.replace(/\\/g, "/");
        return normalized.includes("/components/") && stripKnownSuffixes(basename(normalized)) === stem;
      });
      for (const pathValue of routePairs.slice(0, 1)) {
        addNeighbor(pathValue, candidate.score - 10, "Component paired with a strong route match");
      }
    }

    if (normalizedPath.includes("/components/")) {
      const componentPairs = allFiles.filter((filePath) => {
        const normalized = filePath.replace(/\\/g, "/");
        return normalized.includes("/routes/") && stripKnownSuffixes(basename(normalized)) === stem;
      });
      for (const pathValue of componentPairs.slice(0, 1)) {
        addNeighbor(pathValue, candidate.score - 10, "Route paired with a strong component match");
      }
    }

    const segments = normalizedPath.split("/");
    for (let length = segments.length - 1; length >= 1; length -= 1) {
      const prefix = segments.slice(0, length).join("/");
      for (const configName of knownConfigs) {
        const candidatePath = prefix ? `${prefix}/${configName}` : configName;
        if (allFiles.includes(candidatePath)) {
          addNeighbor(candidatePath, candidate.score - 12, "Adjacent project configuration for a strong match");
        }
      }
    }
  }

  return neighbors;
}

async function loadComparableIssues(runtimeState?: RuntimeState | null): Promise<IssueEntry[]> {
  if (runtimeState?.issues?.length) return runtimeState.issues;
  const resource = getIssueStateResource();
  if (!resource?.list) return [];
  try {
    const records = await resource.list({ limit: 200 });
    return records as IssueEntry[];
  } catch {
    return [];
  }
}

function buildMemoryFragments(issue: IssueEntry): FragmentSeed[] {
  const fragments: FragmentSeed[] = [];
  const issueSummary = [
    `Issue ${issue.identifier}: ${issue.title}`,
    issue.description || "",
    issue.plan?.summary ? `Plan: ${issue.plan.summary}` : "",
  ].filter(Boolean).join("\n");

  fragments.push({
    kind: "issue-memory",
    sourceId: `issue:${issue.id}`,
    issueId: issue.id,
    text: issueSummary,
  });

  for (const [index, summary] of (issue.previousAttemptSummaries || []).entries()) {
    const memoryText = [
      `Failure memory for ${issue.identifier}`,
      summary.error,
      summary.insight?.rootCause || "",
      summary.insight?.suggestion || "",
      summary.outputTail || "",
    ].filter(Boolean).join("\n");
    fragments.push({
      kind: "failure-memory",
      sourceId: `failure:${issue.id}:${index}`,
      issueId: issue.id,
      text: memoryText,
    });
  }

  const failedCriteria = issue.gradingReport?.criteria?.filter((criterion) => criterion.result === "FAIL") || [];
  for (const criterion of failedCriteria) {
    fragments.push({
      kind: "review-memory",
      sourceId: `review:${issue.id}:${criterion.id}`,
      issueId: issue.id,
      text: [
        `Review memory for ${issue.identifier}`,
        criterion.description,
        criterion.evidence,
      ].filter(Boolean).join("\n"),
    });
  }

  return fragments;
}

function buildCurrentIssueMemoryHits(issue: IssueEntry): AgentContextHit[] {
  const hits: AgentContextHit[] = [];

  for (const [index, summary] of (issue.previousAttemptSummaries || []).entries()) {
    const detail = [
      summary.error,
      summary.insight?.rootCause || "",
      summary.insight?.suggestion || "",
      summary.outputTail || "",
    ].filter(Boolean).join("\n");
    if (!detail) continue;
    hits.push({
      id: stableId("current-failure", `${issue.id}:${index}`),
      kind: "failure-memory",
      source: "memory",
      issueId: issue.id,
      sourceId: `failure:${issue.id}:${index}`,
      score: 260 - (index * 5),
      reason: "Previous failed attempt on this issue",
      excerpt: normalizeExcerpt(detail),
    });
  }

  const failedCriteria = issue.gradingReport?.criteria?.filter((criterion) => criterion.result === "FAIL") || [];
  for (const criterion of failedCriteria) {
    const detail = [criterion.description, criterion.evidence].filter(Boolean).join("\n");
    if (!detail) continue;
    hits.push({
      id: stableId("current-review", `${issue.id}:${criterion.id}`),
      kind: "review-memory",
      source: "memory",
      issueId: issue.id,
      sourceId: `review:${issue.id}:${criterion.id}`,
      score: 255,
      reason: "Review failure evidence on this issue",
      excerpt: normalizeExcerpt(detail),
    });
  }

  return hits;
}

async function upsertContextFragments(seeds: FragmentSeed[]): Promise<StoredContextFragment[]> {
  const resource = getContextFragmentResource() as any;
  if (!resource) return [];

  const provider = await getEmbeddingProvider();
  const projectKey = PROJECT_KEY;
  const timestamp = now();
  const fragments = seeds
    .filter((seed) => seed.text.trim())
    .map((seed) => ({
      ...seed,
      hash: createHash("sha1").update(`${projectKey}:${seed.kind}:${seed.sourceId}:${seed.text}`).digest("hex"),
    }));

  if (fragments.length === 0) return [];

  let embeddings: number[][] = [];
  if (provider) {
    try {
      embeddings = await provider.embedTexts(fragments.map((fragment) => fragment.text));
    } catch (error) {
      logger.warn({ err: error }, "[Context] Embedding generation failed, falling back to lexical-only retrieval");
      embeddings = [];
    }
  }

  const stored: StoredContextFragment[] = [];

  for (const [index, fragment] of fragments.entries()) {
    let existing: StoredContextFragment | null = null;
    try {
      const results = await resource.list?.({
        partition: "byProjectHash",
        partitionValues: { projectKey, hash: fragment.hash },
        limit: 1,
      });
      if (Array.isArray(results) && results[0]) {
        existing = results[0] as StoredContextFragment;
      }
    } catch {
      existing = null;
    }

    const payload: StoredContextFragment = {
      id: existing?.id || stableId("ctx", `${fragment.kind}:${fragment.sourceId}:${fragment.hash}`),
      projectKey,
      kind: fragment.kind,
      sourcePath: fragment.sourcePath,
      sourceId: fragment.sourceId,
      issueId: fragment.issueId,
      role: fragment.role,
      hash: fragment.hash,
      text: fragment.text,
      embedding: embeddings[index] || existing?.embedding,
      createdAt: existing?.createdAt || timestamp,
      updatedAt: timestamp,
    };

    if (existing?.id) {
      await resource.replace(existing.id, payload);
    } else if (typeof resource.insert === "function") {
      await resource.insert(payload);
    } else {
      await resource.replace(payload.id, payload);
    }

    stored.push(payload);
  }

  return stored;
}

async function searchSemantic(query: string, limit: number): Promise<AgentContextHit[]> {
  const resource = getContextFragmentResource() as any;
  if (!resource || typeof resource.vectorSearchPaged !== "function") return [];

  const provider = await getEmbeddingProvider();
  if (!provider) return [];

  try {
    const [queryEmbedding] = await provider.embedTexts([query]);
    if (!Array.isArray(queryEmbedding) || queryEmbedding.length === 0) return [];

    const result = await resource.vectorSearchPaged(queryEmbedding, {
      limit,
      pageSize: 200,
      partition: "byProject",
      partitionValues: { projectKey: PROJECT_KEY },
    });

    const rows = Array.isArray(result?.results) ? result.results : [];
    return rows.map((entry: { record?: StoredContextFragment; distance?: number }) => {
      const record = entry.record;
      const distance = typeof entry.distance === "number" ? entry.distance : 1;
      return {
        id: stableId("semantic", `${record?.sourceId || ""}:${distance}`),
        kind: record?.kind || "code-snippet",
        source: record?.kind?.includes("memory") ? "memory" : "semantic",
        path: record?.sourcePath,
        sourceId: record?.sourceId,
        issueId: record?.issueId,
        score: Math.max(0, 220 - Math.round(distance * 120)),
        reason: record?.kind?.includes("memory") ? "Semantically similar historical memory" : "Semantically similar indexed fragment",
        excerpt: normalizeExcerpt(record?.text || ""),
      } satisfies AgentContextHit;
    });
  } catch (error) {
    logger.warn({ err: error }, "[Context] Semantic search failed");
    return [];
  }
}

function dedupeHits(hits: AgentContextHit[]): AgentContextHit[] {
  const byKey = new Map<string, AgentContextHit>();
  for (const hit of hits) {
    const key = `${hit.path || ""}::${hit.sourceId || hit.id}::${hit.kind}`;
    const existing = byKey.get(key);
    if (!existing || hit.score > existing.score) {
      byKey.set(key, hit);
    }
  }
  return [...byKey.values()].sort((a, b) => b.score - a.score || a.reason.localeCompare(b.reason));
}

function renderSnippetSeeds(candidates: LexicalCandidate[]): FragmentSeed[] {
  return candidates.map((candidate) => ({
    kind: candidate.kind,
    sourcePath: candidate.path,
    sourceId: `file:${candidate.path}`,
    text: candidate.excerpt,
  }));
}

function renderWorkspaceSeeds(workspaceDocs: Array<{
  kind: "doc" | "issue-memory";
  path: string;
  sourceId: string;
  text: string;
}>): FragmentSeed[] {
  return workspaceDocs.map((document) => ({
    kind: document.kind === "doc" ? "doc" : "issue-memory",
    sourcePath: document.path,
    sourceId: document.sourceId,
    text: document.text,
  }));
}

function buildExplicitHits(paths: string[], root: string, tokens: string[]): LexicalCandidate[] {
  const hits: LexicalCandidate[] = [];
  for (const pathValue of paths) {
    const relativePath = pathValue.replace(/\\/g, "/");
    const absolutePath = resolve(root, relativePath);
    const text = readTextFileSafe(absolutePath);
    if (!text) continue;
    hits.push({
      path: relativePath,
      absolutePath,
      score: 1000,
      excerpt: extractExcerpt(text, tokens),
      kind: classifyPath(relativePath),
      reason: "Explicitly referenced by issue or plan",
      source: "explicit",
    });
  }
  return hits;
}

function searchLexical(tokens: string[], root: string, explicitPaths: string[], allFiles?: string[]): LexicalCandidate[] {
  const explicitHits = buildExplicitHits(explicitPaths, root, tokens);
  const explicitSet = new Set(explicitHits.map((hit) => hit.path));
  const files = allFiles || listTextFiles(root);
  const candidates: LexicalCandidate[] = [...explicitHits];

  for (const relativePath of files) {
    if (explicitSet.has(relativePath)) continue;
    const absolutePath = join(root, relativePath);
    const text = readTextFileSafe(absolutePath);
    if (!text) continue;
    const scored = scorePathAndContent(relativePath, text, tokens);
    if (!scored.matched || scored.score <= 0) continue;
    candidates.push({
      path: relativePath,
      absolutePath,
      score: scored.score,
      excerpt: extractExcerpt(text, tokens),
      kind: classifyPath(relativePath),
      reason: relativePath.toLowerCase().includes("readme") || relativePath.toLowerCase().includes("claude")
        ? "Operational documentation matched the query"
        : "Lexical match in repo content",
      source: "lexical",
    });
  }

  return candidates
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, 12);
}

function similarIssueScore(issue: IssueEntry, tokens: string[], explicitPaths: string[]): number {
  if (!issue.title && !issue.description) return 0;
  const haystack = `${issue.title}\n${issue.description || ""}`.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) score += 4;
  }
  const issuePaths = new Set((issue.paths || []).map((pathValue) => basename(pathValue).toLowerCase()));
  for (const explicit of explicitPaths) {
    if (issuePaths.has(basename(explicit).toLowerCase())) score += 10;
  }
  return score;
}

export function renderContextPackMarkdown(pack: AgentContextPack): string {
  if (!pack.hits.length) return "";
  const lines = [
    "## Retrieved Context",
    "",
    `Query: ${pack.query}`,
    "",
  ];
  if (pack.report?.layers?.length) {
    lines.push("Layers:");
    for (const layer of pack.report.layers) {
      lines.push(`- ${layer.name}: ${layer.selectedHitCount}/${layer.hitCount} selected`);
    }
    if (pack.report.memoryFlush) {
      lines.push(`- memory-flush: ${pack.report.memoryFlush.promotedEntries} promoted, ${pack.report.memoryFlush.changedFiles.length} file(s) updated`);
    }
    lines.push("");
  }
  for (const [index, hit] of pack.hits.entries()) {
    lines.push(`${index + 1}. [${hit.source}/${hit.kind}] ${hit.path || hit.sourceId || hit.id}`);
    lines.push(`   Why: ${hit.reason}`);
    if (hit.excerpt) {
      lines.push("   Excerpt:");
      lines.push("   ```text");
      lines.push(hit.excerpt);
      lines.push("   ```");
    }
  }
  return lines.join("\n");
}

function buildTraceSteps(pack: AgentContextPack, directive: {
  status: string;
  toolsUsed?: string[];
  skillsUsed?: string[];
  agentsUsed?: string[];
  commandsRun?: string[];
}): AgentTraceStep[] {
  const steps: AgentTraceStep[] = [];
  steps.push({
    type: "context_built",
    label: `Built context pack with ${pack.hits.length} hit(s)`,
    detail: `${pack.explicitHitCount} explicit, ${pack.lexicalHitCount} lexical, ${pack.semanticHitCount} semantic, ${pack.memoryHitCount} memory`,
  });
  if (pack.lexicalHitCount > 0) {
    steps.push({ type: "lexical_search", label: `Lexical retrieval matched ${pack.lexicalHitCount} candidate(s)` });
  }
  if (pack.semanticHitCount > 0) {
    steps.push({ type: "semantic_search", label: `Semantic retrieval returned ${pack.semanticHitCount} candidate(s)` });
  }
  if (pack.memoryHitCount > 0) {
    steps.push({ type: "memory_loaded", label: `Loaded ${pack.memoryHitCount} memory-derived hit(s)` });
  }
  steps.push({ type: "prompt_compiled", label: "Compiled prompt with retrieved context" });
  for (const tool of directive.toolsUsed || []) steps.push({ type: "tool_used", label: tool });
  for (const skill of directive.skillsUsed || []) steps.push({ type: "skill_used", label: skill });
  for (const agent of directive.agentsUsed || []) steps.push({ type: "subagent_used", label: agent });
  for (const command of directive.commandsRun || []) steps.push({ type: "command_used", label: command });
  steps.push({ type: "turn_finished", label: `Turn finished with status ${directive.status}` });
  return steps;
}

export async function buildContextPack(input: QueryInputs): Promise<AgentContextPack> {
  const query = buildQueryText(input).trim();
  const tokens = extractTokens(query);
  const root = resolveSearchRoot(input);
  const workspacePath = input.issue?.workspacePath ?? input.workspacePath;
  const memoryEngine = getMemoryEngine();
  const issuePaths = [
    ...(input.issue?.paths || []),
    ...(input.issue?.plan?.suggestedPaths || []),
  ].filter((value, index, array) => value && array.indexOf(value) === index);

  const memoryFlush = input.issue && workspacePath
    ? memoryEngine.flushIssueMemory(input.issue, workspacePath, "context-assembly")
    : null;
  const workspaceDocs = workspacePath
    ? memoryEngine.listContextDocuments(workspacePath)
    : [];
  const bootstrapDocs = workspaceDocs.filter((document) => document.layer === "bootstrap");
  const workspaceMemoryDocs = workspaceDocs.filter((document) => document.layer === "workspace-memory");

  const allFiles = listTextFiles(root);
  const lexicalCandidates = searchLexical(tokens, root, issuePaths, allFiles);
  const explicitHitCount = lexicalCandidates.filter((candidate) => candidate.source === "explicit").length;
  const structuralCandidates = buildStructuralNeighbors(lexicalCandidates, root, allFiles, tokens);
  const currentIssueMemoryHits = input.issue ? buildCurrentIssueMemoryHits(input.issue) : [];

  const docSeeds: FragmentSeed[] = [];
  for (const docName of DEFAULT_DOC_FILES) {
    const absolutePath = join(root, docName);
    const content = readTextFileSafe(absolutePath);
    for (const [index, chunk] of chunkText(content, 1200, 160).entries()) {
      docSeeds.push({
        kind: classifyPath(docName),
        sourcePath: docName,
        sourceId: `doc:${docName}:${index}`,
        text: chunk,
      });
    }
  }

  const candidateIssues = await loadComparableIssues(input.runtimeState);
  const currentIssueSeeds = input.issue ? buildMemoryFragments(input.issue) : [];
  const similarIssues = candidateIssues
    .filter((candidate) => candidate.id !== input.issue?.id)
    .map((candidate) => ({ issue: candidate, score: similarIssueScore(candidate, tokens, issuePaths) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.issue.updatedAt.localeCompare(b.issue.updatedAt))
    .slice(0, 5)
    .flatMap((entry) => buildMemoryFragments(entry.issue));

  const storedFragments = await upsertContextFragments([
    ...docSeeds,
    ...renderWorkspaceSeeds(workspaceDocs),
    ...renderSnippetSeeds(lexicalCandidates.slice(0, 8)),
    ...currentIssueSeeds,
    ...similarIssues,
  ]);

  const semanticHits = await searchSemantic(query, 8);
  const lexicalHits: AgentContextHit[] = lexicalCandidates.map((candidate) => ({
    id: stableId("lex", candidate.path),
    kind: candidate.kind,
    source: candidate.source,
    path: candidate.path,
    score: candidate.source === "explicit" ? candidate.score : 120 + candidate.score,
    reason: candidate.reason,
    excerpt: candidate.excerpt,
  }));
  const structuralHits: AgentContextHit[] = structuralCandidates.map((candidate) => ({
    id: stableId("struct", candidate.path),
    kind: candidate.kind,
    source: "structural",
    path: candidate.path,
    score: 110 + candidate.score,
    reason: candidate.reason,
    excerpt: candidate.excerpt,
  }));
  const bootstrapHits: AgentContextHit[] = bootstrapDocs.map((document, index) => ({
    id: stableId("bootstrap", `${document.sourceId}:${index}`),
    kind: "doc",
    source: "explicit",
    path: document.path,
    sourceId: document.sourceId,
    score: 400 - index,
    reason: "Bootstrap workspace context",
    excerpt: normalizeExcerpt(document.text, 420),
  }));
  const workspaceMemoryHits: AgentContextHit[] = workspaceMemoryDocs.map((document, index) => ({
    id: stableId("workspace-memory", `${document.sourceId}:${index}`),
    kind: "issue-memory",
    source: "memory",
    path: document.path,
    sourceId: document.sourceId,
    score: 280 - index,
    reason: "Durable workspace memory",
    excerpt: normalizeExcerpt(document.text, 420),
  }));

  const semanticIds = new Set(semanticHits.map((hit) => hit.sourceId).filter(Boolean));
  const historicalMemoryHits = storedFragments
    .filter((fragment) => semanticIds.has(fragment.sourceId) && fragment.kind.includes("memory"))
    .map((fragment) => ({
      id: stableId("mem", fragment.sourceId),
      kind: fragment.kind,
      source: "memory" as const,
      path: fragment.sourcePath,
      sourceId: fragment.sourceId,
      issueId: fragment.issueId,
      score: 170,
      reason: "Historical memory relevant to the current issue",
      excerpt: normalizeExcerpt(fragment.text),
    }));
  const memoryHitCount = workspaceMemoryHits.length
    + currentIssueMemoryHits.length
    + semanticHits.filter((hit) => hit.source === "memory").length
    + historicalMemoryHits.length;
  const combined = dedupeHits([
    ...bootstrapHits,
    ...workspaceMemoryHits,
    ...lexicalHits,
    ...structuralHits,
    ...semanticHits,
    ...currentIssueMemoryHits,
    ...historicalMemoryHits,
  ]);

  const limit = input.role === "planner" ? 6 : 8;
  const selectedHits = combined.slice(0, limit);
  const selectedIds = new Set(selectedHits.map((hit) => hit.id));
  const buildLayerReport = (
    name: "bootstrap" | "workspace-memory" | "issue-memory" | "retrieval",
    hits: AgentContextHit[],
    notes?: string[],
  ) => ({
    name,
    hitCount: hits.length,
    selectedHitCount: hits.filter((hit) => selectedIds.has(hit.id)).length,
    discardedHitCount: hits.filter((hit) => !selectedIds.has(hit.id)).length,
    notes,
  });

  return {
    role: input.role,
    query,
    generatedAt: now(),
    hits: selectedHits,
    lexicalHitCount: lexicalCandidates.length,
    semanticHitCount: semanticHits.length,
    memoryHitCount,
    explicitHitCount: explicitHitCount + bootstrapHits.length,
    report: {
      role: input.role,
      query,
      generatedAt: now(),
      maxHits: limit,
      totalHits: combined.length,
      selectedHits: selectedHits.length,
      discardedHits: Math.max(0, combined.length - selectedHits.length),
      layers: [
        buildLayerReport("bootstrap", bootstrapHits, bootstrapHits.length > 0 ? ["Canonical workspace docs"] : undefined),
        buildLayerReport("workspace-memory", workspaceMemoryHits, workspaceMemoryHits.length > 0 ? ["Durable workspace notes and recent daily memory"] : undefined),
        buildLayerReport("issue-memory", currentIssueMemoryHits, currentIssueMemoryHits.length > 0 ? ["Current issue failures and reviewer evidence"] : undefined),
        buildLayerReport("retrieval", [...lexicalHits, ...structuralHits, ...semanticHits, ...historicalMemoryHits]),
      ],
      memoryFlush,
    },
  };
}

export interface ContextEngine {
  ingest(input: QueryInputs): Promise<void>;
  assemble(input: QueryInputs): Promise<AgentContextPack>;
  compact(input: QueryInputs): Promise<AgentContextPack>;
}

export const DEFAULT_CONTEXT_ENGINE: ContextEngine = {
  async ingest() {},
  async assemble(input) {
    return await buildContextPack(input);
  },
  async compact(input) {
    return await buildContextPack(input);
  },
};

export async function buildContextMarkdown(input: QueryInputs): Promise<{ pack: AgentContextPack; markdown: string }> {
  const pack = await buildContextPack(input);
  return { pack, markdown: renderContextPackMarkdown(pack) };
}

export function buildTraceFromContext(
  pack: AgentContextPack,
  directive: {
    status: string;
    toolsUsed?: string[];
    skillsUsed?: string[];
    agentsUsed?: string[];
    commandsRun?: string[];
  },
): AgentTraceStep[] {
  return buildTraceSteps(pack, directive);
}
