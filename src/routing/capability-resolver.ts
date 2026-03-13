export type CapabilityResolverRole = "planner" | "executor" | "reviewer";

export type CapabilityResolverIssue = {
  id?: string;
  identifier?: string;
  title: string;
  description?: string;
  labels?: string[];
  paths?: string[];
};

export type CapabilityResolverBaseProvider = {
  provider: string;
  role: CapabilityResolverRole;
  command: string;
  profile?: string;
  profilePath?: string;
  profileInstructions?: string;
};

export type CapabilityResolverSuggestion = {
  provider: string;
  role: CapabilityResolverRole;
  profile: string;
  reason: string;
};

export type CapabilityResolution = {
  category: string;
  rationale: string[];
  overlays: string[];
  providers: CapabilityResolverSuggestion[];
};

export type CapabilityResolverOverride = {
  match?: {
    labels?: string[];
    terms?: string[];
    category?: string;
    paths?: string[];
  };
  category?: string;
  rationale?: string[];
  overlays?: string[];
  providers?: CapabilityResolverSuggestion[];
};

export type CapabilityResolverOptions = {
  enabled?: boolean;
  overrides?: CapabilityResolverOverride[];
};

function tokenize(issue: CapabilityResolverIssue): string {
  const labels = (issue.labels ?? []).filter((label) => !label.startsWith("capability:") && !label.startsWith("overlay:"));
  return [
    issue.identifier ?? "",
    issue.title,
    issue.description ?? "",
    ...labels,
    ...(issue.paths ?? []),
  ].join(" ").toLowerCase();
}

function normalizePath(value: string): string {
  return value.trim().replaceAll("\\", "/").toLowerCase();
}

export function inferCapabilityPaths(issue: CapabilityResolverIssue): string[] {
  const labels = (issue.labels ?? []).filter((label) => !label.startsWith("capability:") && !label.startsWith("overlay:"));
  const sources = [issue.title, issue.description ?? "", ...labels];
  const matches = new Set<string>();
  const pattern = /(?:[A-Za-z0-9._-]+\/)+(?:[A-Za-z0-9._-]+)|(?:[A-Za-z0-9._-]+\.(?:ts|tsx|js|jsx|mjs|cjs|css|scss|sass|less|html|md|mdx|json|yml|yaml|sql|sh))+/g;

  for (const source of sources) {
    for (const match of source.match(pattern) ?? []) {
      matches.add(normalizePath(match));
    }
  }

  return [...matches];
}

function getIssuePaths(issue: CapabilityResolverIssue): string[] {
  return [...new Set([
    ...(issue.paths ?? [])
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .map(normalizePath),
    ...inferCapabilityPaths(issue),
  ])];
}

function hasAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function hasPathMatch(paths: string[], fragments: string[] = [], extensions: string[] = []): boolean {
  return paths.some((path) => {
    if (fragments.some((fragment) => path.includes(fragment))) {
      return true;
    }

    return extensions.some((extension) => path.endsWith(extension));
  });
}

function buildResolution(
  category: string,
  rationale: string[],
  overlays: string[],
  providers: CapabilityResolverSuggestion[],
): CapabilityResolution {
  return {
    category,
    rationale,
    overlays,
    providers,
  };
}

function uniq(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function matchesOverride(
  issue: CapabilityResolverIssue,
  resolution: CapabilityResolution,
  override: CapabilityResolverOverride,
): boolean {
  const match = override.match ?? {};
  const issueLabels = new Set((issue.labels ?? []).map((label) => label.toLowerCase()));
  const text = tokenize(issue);
  const paths = getIssuePaths(issue);

  if (match.category && match.category !== resolution.category) {
    return false;
  }

  if (match.labels?.length) {
    const requiredLabels = match.labels.map((label) => label.toLowerCase());
    if (!requiredLabels.every((label) => issueLabels.has(label))) {
      return false;
    }
  }

  if (match.terms?.length) {
    if (!match.terms.some((term) => text.includes(term.toLowerCase()))) {
      return false;
    }
  }

  if (match.paths?.length) {
    const expectedPaths = match.paths.map((path) => normalizePath(path));
    if (!expectedPaths.some((expectedPath) => paths.some((path) => path.includes(expectedPath)))) {
      return false;
    }
  }

  return Boolean(match.category || match.labels?.length || match.terms?.length || match.paths?.length);
}

function applyOverrides(
  issue: CapabilityResolverIssue,
  resolution: CapabilityResolution,
  options?: CapabilityResolverOptions,
): CapabilityResolution {
  if (options?.enabled === false) {
    return buildResolution(
      "workflow-disabled",
      ["Automatic capability routing was disabled by workflow configuration."],
      [],
      [
        { provider: "codex", role: "executor", profile: "", reason: "Fallback executor because routing is disabled." },
      ],
    );
  }

  const override = options?.overrides?.find((entry) => matchesOverride(issue, resolution, entry));
  if (!override) {
    return resolution;
  }

  return {
    category: override.category ?? resolution.category,
    rationale: uniq([...(resolution.rationale ?? []), ...(override.rationale ?? []), "Workflow routing override applied."]),
    overlays: uniq([...(resolution.overlays ?? []), ...(override.overlays ?? [])]),
    providers: override.providers?.length ? override.providers : resolution.providers,
  };
}

export function resolveTaskCapabilities(
  issue: CapabilityResolverIssue,
  options?: CapabilityResolverOptions,
): CapabilityResolution {
  const text = tokenize(issue);
  const paths = getIssuePaths(issue);
  const frontendPathMatch = hasPathMatch(
    paths,
    ["src/web", "web", "frontend", "ui", "component", "dashboard", "style", "apps/web"],
    [".css", ".scss", ".sass", ".less", ".html", ".tsx", ".jsx", ".vue", ".svelte"],
  );
  const securityPathMatch = hasPathMatch(
    paths,
    ["security", "auth", "crypto", "secret", "permission", "token"],
    [".pem", ".key", ".crt"],
  );
  const architecturePathMatch = hasPathMatch(
    paths,
    ["workflow.md", "architecture.md", "spec.md", "claude.md", "openspec/"],
    [],
  );
  const devopsPathMatch = hasPathMatch(
    paths,
    [".github/workflows", "docker", "k8s", "helm", "terraform", "infra", "deploy", "release"],
    [".yml", ".yaml", ".tf"],
  );
  const backendPathMatch = hasPathMatch(
    paths,
    ["src/api", "api", "src/protocol", "protocol", "server", "persistence", "scanner", "ws", "websocket", "db", "apps/api"],
    [".sql"],
  );
  const docsPathMatch = hasPathMatch(
    paths,
    ["docs", "readme", "guide", "tutorial"],
    [".md", ".mdx"],
  );
  let resolution: CapabilityResolution;

  if (frontendPathMatch || hasAny(text, ["frontend", "ui", "ux", "design", "css", "html", "layout", "component", "react", "vue"])) {
    resolution = buildResolution(
      "frontend-ui",
      [
        ...(frontendPathMatch ? ["Detected frontend-oriented target paths or file extensions."] : []),
        "Detected frontend or design-oriented keywords in the task.",
        "Use Claude to plan and review, Codex to implement.",
        "Apply impeccable-style polish as a review overlay when available.",
      ],
      ["impeccable", "frontend-design"],
      [
        { provider: "claude", role: "planner", profile: "agency-ui-designer", reason: "UI planning and structure." },
        { provider: "codex", role: "executor", profile: "agency-frontend-developer", reason: "Frontend implementation." },
        { provider: "claude", role: "reviewer", profile: "agency-accessibility-auditor", reason: "Critical UX and accessibility review." },
      ],
    );
    return applyOverrides(issue, resolution, options);
  }

  if (securityPathMatch || hasAny(text, ["security", "auth", "oauth", "token", "secret", "permission", "compliance", "vulnerability"])) {
    resolution = buildResolution(
      "security",
      [
        ...(securityPathMatch ? ["Detected security-sensitive target paths or file extensions."] : []),
        "Detected security-sensitive keywords.",
        "Use a security profile to scope the work and keep a strict review pass.",
      ],
      ["security-review"],
      [
        { provider: "claude", role: "planner", profile: "agency-security-engineer", reason: "Threat and risk framing." },
        { provider: "codex", role: "executor", profile: "agency-security-engineer", reason: "Implementation with security context." },
        { provider: "claude", role: "reviewer", profile: "agency-code-reviewer", reason: "Independent correctness review." },
      ],
    );
    return applyOverrides(issue, resolution, options);
  }

  if (architecturePathMatch || hasAny(text, ["architecture", "design doc", "spec", "workflow", "orchestr", "roadmap", "plan"])) {
    resolution = buildResolution(
      "architecture",
      [
        ...(architecturePathMatch ? ["Detected workflow, architecture, or specification files in the targeted paths."] : []),
        "Detected architecture or planning-oriented keywords.",
        "Favor stronger planning and review roles around the executor.",
      ],
      ["spec-review"],
      [
        { provider: "claude", role: "planner", profile: "agency-software-architect", reason: "Architecture and system framing." },
        { provider: "codex", role: "executor", profile: "agency-senior-developer", reason: "Translate architecture into implementation." },
        { provider: "claude", role: "reviewer", profile: "agency-code-reviewer", reason: "Challenge assumptions and regressions." },
      ],
    );
    return applyOverrides(issue, resolution, options);
  }

  if (devopsPathMatch || hasAny(text, ["deploy", "release", "ci", "cicd", "github actions", "docker", "terraform", "kubernetes"])) {
    resolution = buildResolution(
      "devops",
      [
        ...(devopsPathMatch ? ["Detected deployment, infrastructure, or CI/CD paths in the task scope."] : []),
        "Detected release, deployment, or infrastructure keywords.",
        "Use a delivery-focused planner and a stricter reliability review pass.",
      ],
      ["delivery-review"],
      [
        { provider: "claude", role: "planner", profile: "agency-devops-automator", reason: "CI/CD and deployment framing." },
        { provider: "codex", role: "executor", profile: "agency-devops-automator", reason: "Implement workflow and release changes." },
        { provider: "claude", role: "reviewer", profile: "agency-sre-site-reliability-engineer", reason: "Reliability and rollback review." },
      ],
    );
    return applyOverrides(issue, resolution, options);
  }

  if (hasAny(text, ["bug", "fix", "regression", "debug", "crash", "broken", "error", "fail"])) {
    resolution = buildResolution(
      "bugfix",
      [
        "Detected bug-fix or debugging keywords.",
        "Use Codex to execute the fix and Claude to frame and verify the change.",
      ],
      ["debug"],
      [
        { provider: "claude", role: "planner", profile: "agency-code-reviewer", reason: "Clarify failure mode and acceptance criteria." },
        { provider: "codex", role: "executor", profile: "agency-senior-developer", reason: "Implement and iterate quickly." },
        { provider: "claude", role: "reviewer", profile: "agency-code-reviewer", reason: "Catch regressions and weak reasoning." },
      ],
    );
    return applyOverrides(issue, resolution, options);
  }

  if (backendPathMatch || hasAny(text, ["api", "backend", "database", "protocol", "server", "ws", "websocket", "persistence"])) {
    resolution = buildResolution(
      "backend",
      [
        ...(backendPathMatch ? ["Detected backend, protocol, or persistence paths in the task scope."] : []),
        "Detected backend, API, protocol, or persistence keywords.",
        "Use backend-oriented planning and critical review around the executor.",
      ],
      ["backend-review"],
      [
        { provider: "claude", role: "planner", profile: "agency-backend-architect", reason: "API and data-model framing." },
        { provider: "codex", role: "executor", profile: "agency-senior-developer", reason: "Implement the backend changes." },
        { provider: "claude", role: "reviewer", profile: "agency-code-reviewer", reason: "Critical regression review." },
      ],
    );
    return applyOverrides(issue, resolution, options);
  }

  if (docsPathMatch || hasAny(text, ["docs", "readme", "guide", "documentation", "tutorial"])) {
    resolution = buildResolution(
      "documentation",
      [
        ...(docsPathMatch ? ["Detected documentation-oriented paths or file extensions."] : []),
        "Detected documentation keywords.",
        "Use writing-oriented planning with an implementation pass that can still edit code and docs together.",
      ],
      ["documentation"],
      [
        { provider: "claude", role: "planner", profile: "agency-technical-writer", reason: "Structure and narrative." },
        { provider: "codex", role: "executor", profile: "agency-technical-writer", reason: "Apply documentation edits in repo context." },
        { provider: "claude", role: "reviewer", profile: "agency-code-reviewer", reason: "Check coherence with the implementation." },
      ],
    );
    return applyOverrides(issue, resolution, options);
  }

  resolution = buildResolution(
    "default",
    [
      "No specialized pattern matched strongly.",
      "Default to a balanced planner/executor/reviewer pipeline using both Claude and Codex.",
    ],
    [],
    [
      { provider: "claude", role: "planner", profile: "agency-senior-project-manager", reason: "Clarify scope and acceptance criteria." },
      { provider: "codex", role: "executor", profile: "agency-senior-developer", reason: "Implement the requested change." },
      { provider: "claude", role: "reviewer", profile: "agency-code-reviewer", reason: "Critical review before closure." },
    ],
  );

  return applyOverrides(issue, resolution, options);
}

export function mergeCapabilityProviders(
  baseProviders: CapabilityResolverBaseProvider[],
  resolution: CapabilityResolution,
): CapabilityResolverBaseProvider[] {
  return resolution.providers.map((suggestion) => {
    const exact = baseProviders.find((provider) => provider.provider === suggestion.provider && provider.role === suggestion.role);
    const sameRole = baseProviders.find((provider) => provider.role === suggestion.role);
    const sameProvider = baseProviders.find((provider) => provider.provider === suggestion.provider);
    const base = exact ?? sameRole ?? sameProvider;

    return {
      provider: suggestion.provider,
      role: suggestion.role,
      command: base?.command ?? "",
      profile: suggestion.profile || base?.profile || "",
      profilePath: base?.profilePath ?? "",
      profileInstructions: base?.profileInstructions ?? "",
    };
  });
}
