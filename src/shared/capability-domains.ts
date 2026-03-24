export type CapabilityContext = {
  title?: string;
  description?: string;
  paths?: string[];
};

export const CAPABILITY_DOMAIN_OPTIONS = [
  { value: "frontend", label: "Frontend" },
  { value: "backend", label: "Backend" },
  { value: "database", label: "Database" },
  { value: "devops", label: "DevOps" },
  { value: "security", label: "Security" },
  { value: "testing", label: "Testing" },
  { value: "mobile", label: "Mobile" },
  { value: "ai-ml", label: "AI/ML" },
  { value: "docs", label: "Docs" },
] as const;

const DOMAIN_RULES = {
  frontend: [
    /react|component|ui|ux|frontend|tailwind|css|scss|html|accessibility|design/,
    /\.(jsx|tsx|css|scss|html)\b/,
    /app\/src|components\/|pages\/|views\//,
  ],
  backend: [
    /backend|api|server|route|endpoint|controller|service|handler/,
    /src\/routes|src\/persistence|controllers\/|services\//,
  ],
  database: [
    /database|sqlite|postgres|sql|query|migration|schema|orm|index/,
    /migrations\/|schema\/|db\//,
  ],
  devops: [
    /docker|kubernetes|deploy|infra|terraform|ci\/cd|pipeline|github actions/,
    /\.github\/|dockerfile|compose|helm|terraform/,
  ],
  security: [
    /security|auth|oauth|permission|secret|xss|csrf|jwt|token/,
  ],
  testing: [
    /test|testing|coverage|jest|vitest|playwright|cypress|e2e/,
    /__tests__\/|\.test\.|\.spec\./,
  ],
  mobile: [
    /mobile|ios|android|react-native|swift|kotlin/,
  ],
  "ai-ml": [
    /ai|llm|model|embedding|prompt|inference|rag/,
  ],
  docs: [
    /docs|readme|documentation|copy|guide|markdown/,
    /\.md\b/,
  ],
} as const;

export function normalizeCapabilityContext(context: CapabilityContext) {
  return {
    title: typeof context.title === "string" ? context.title.trim() : "",
    description: typeof context.description === "string" ? context.description.trim() : "",
    paths: Array.isArray(context.paths)
      ? context.paths
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .map((value) => value.trim())
      : [],
  };
}

export function inferCapabilityDomains(context: CapabilityContext): string[] {
  const normalized = normalizeCapabilityContext(context);
  const haystack = [normalized.title, normalized.description, ...normalized.paths].join(" ").toLowerCase();

  return Object.entries(DOMAIN_RULES)
    .filter(([, patterns]) => patterns.some((pattern) => pattern.test(haystack)))
    .map(([domain]) => domain)
    .sort();
}
