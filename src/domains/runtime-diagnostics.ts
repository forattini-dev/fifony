import type {
  DoctorCheckResult,
  IssueEntry,
  ProviderCapabilities,
  RuntimeHealthSnapshot,
  RuntimeState,
  ServiceStatus,
  DetectedProvider,
} from "../types.ts";
import { now } from "../concerns/helpers.ts";
import { TARGET_ROOT, STATE_ROOT } from "../concerns/constants.ts";
import {
  detectAvailableProviders,
  getProviderCapabilityWarnings,
  resolveProviderCapabilities,
} from "../agents/providers.ts";
import { getGitRepoStatus, type GitRepoStatus } from "./workspace.ts";
import { listServiceStatuses } from "./services.ts";
import { getAgentStatus } from "./agents.ts";

type AgentStatusSnapshot = {
  issueId: string;
  state: "idle" | "preparing" | "running" | "paused" | "crashed" | "done" | "failed";
  running: boolean;
};

export type RuntimeDiagnosticsDeps = {
  workspaceStatus?: GitRepoStatus;
  providers?: DetectedProvider[];
  serviceStatuses?: ServiceStatus[];
  agentStatuses?: AgentStatusSnapshot[];
};

function findConfiguredCapabilities(
  configuredProvider: string,
  providers: DetectedProvider[],
): ProviderCapabilities {
  const detected = providers.find((provider) => provider.name === configuredProvider);
  return resolveProviderCapabilities(configuredProvider, detected?.capabilities);
}

function collectIssueCounts(issues: IssueEntry[]) {
  return {
    total: issues.length,
    planning: issues.filter((issue) => issue.state === "Planning").length,
    running: issues.filter((issue) => issue.state === "Running").length,
    reviewing: issues.filter((issue) => issue.state === "Reviewing").length,
    blocked: issues.filter((issue) => issue.state === "Blocked").length,
    pendingDecision: issues.filter((issue) => issue.state === "PendingDecision").length,
  };
}

function collectAgentStatuses(state: RuntimeState, deps?: RuntimeDiagnosticsDeps): AgentStatusSnapshot[] {
  if (deps?.agentStatuses) return deps.agentStatuses;
  return state.issues.map((issue) => {
    const status = getAgentStatus(STATE_ROOT, issue.id, issue.identifier);
    return {
      issueId: issue.id,
      state: status.state,
      running: status.running,
    };
  });
}

function collectServiceStatuses(state: RuntimeState, deps?: RuntimeDiagnosticsDeps): ServiceStatus[] {
  if (deps?.serviceStatuses) return deps.serviceStatuses;
  return listServiceStatuses(state.config.services ?? [], STATE_ROOT);
}

export function collectRuntimeHealthSnapshot(
  state: RuntimeState,
  deps?: RuntimeDiagnosticsDeps,
): RuntimeHealthSnapshot {
  const workspaceStatus = deps?.workspaceStatus ?? getGitRepoStatus(TARGET_ROOT);
  const providers = deps?.providers ?? detectAvailableProviders();
  const services = collectServiceStatuses(state, deps);
  const agentStatuses = collectAgentStatuses(state, deps);
  const issueCounts = collectIssueCounts(state.issues);
  const configuredCapabilities = findConfiguredCapabilities(state.config.agentProvider, providers);
  const capabilityWarnings = getProviderCapabilityWarnings(state.config.agentProvider, configuredCapabilities);

  const snapshot: RuntimeHealthSnapshot = {
    generatedAt: now(),
    ok: workspaceStatus.isGit && workspaceStatus.hasCommits,
    workspace: {
      root: TARGET_ROOT,
      git: workspaceStatus,
    },
    providers: {
      configuredProvider: state.config.agentProvider,
      configuredCommand: state.config.agentCommand,
      configuredCapabilities,
      capabilityWarnings,
      available: providers,
    },
    issues: issueCounts,
    agents: {
      active: agentStatuses.filter((status) => status.running).length,
      crashed: agentStatuses.filter((status) => status.state === "crashed" || status.state === "failed").length,
      idle: agentStatuses.filter((status) => !status.running && status.state === "idle").length,
    },
    services: {
      total: services.length,
      running: services.filter((service) => service.state === "running").length,
      starting: services.filter((service) => service.state === "starting").length,
      stopped: services.filter((service) => service.state === "stopped").length,
      crashed: services.filter((service) => service.state === "crashed").length,
    },
    memory: {
      issuesWithFlushes: state.issues.filter((issue) => (issue.memoryFlushCount ?? 0) > 0).length,
      totalFlushes: state.issues.reduce((sum, issue) => sum + (issue.memoryFlushCount ?? 0), 0),
    },
  };

  snapshot.ok = snapshot.ok
    && snapshot.providers.available.some((provider) => provider.name === snapshot.providers.configuredProvider && provider.available)
    && snapshot.agents.crashed === 0;
  return snapshot;
}

export function runDoctorChecks(
  state: RuntimeState,
  deps?: RuntimeDiagnosticsDeps,
): DoctorCheckResult[] {
  const snapshot = collectRuntimeHealthSnapshot(state, deps);
  const configuredProvider = snapshot.providers.available.find((provider) => provider.name === snapshot.providers.configuredProvider);
  const crashedIssues = state.issues.filter((issue) => issue.state === "Running" || issue.state === "Reviewing");
  const checks: DoctorCheckResult[] = [];

  checks.push(snapshot.workspace.git.isGit
    ? snapshot.workspace.git.hasCommits
      ? {
        id: "workspace-git",
        title: "Workspace git readiness",
        status: "pass",
        summary: `Git is ready on ${snapshot.workspace.root}.`,
        detail: `Branch: ${snapshot.workspace.git.branch ?? "unknown"}`,
      }
      : {
        id: "workspace-git",
        title: "Workspace git readiness",
        status: "fail",
        summary: "Workspace is a git repository but has no commits.",
        suggestedAction: "Create an initial commit before running worktree-based issue execution.",
      }
    : {
      id: "workspace-git",
      title: "Workspace git readiness",
      status: "fail",
      summary: "Workspace is not a git repository.",
      suggestedAction: "Initialize git and create an initial commit, or use the onboarding/setup flow.",
    });

  checks.push(configuredProvider?.available
    ? {
      id: "provider-runtime",
      title: "Configured provider runtime",
      status: "pass",
      summary: `Configured provider ${snapshot.providers.configuredProvider} is available.`,
      detail: configuredProvider.path,
    }
    : {
      id: "provider-runtime",
      title: "Configured provider runtime",
      status: "fail",
      summary: `Configured provider ${snapshot.providers.configuredProvider} is not available on PATH.`,
      suggestedAction: "Install the provider CLI or change the configured provider/command.",
    });

  checks.push(snapshot.providers.capabilityWarnings.length === 0
    ? {
      id: "provider-capabilities",
      title: "Provider capability coverage",
      status: "pass",
      summary: `Configured provider ${snapshot.providers.configuredProvider} exposes the runtime capabilities this harness expects natively.`,
    }
    : {
      id: "provider-capabilities",
      title: "Provider capability coverage",
      status: "warn",
      summary: `${snapshot.providers.configuredProvider} requires harness fallbacks for some runtime capabilities.`,
      detail: snapshot.providers.capabilityWarnings.join(" "),
      suggestedAction: "Use the warnings to understand which behaviors are enforced by Fifony runtime fallbacks instead of the provider CLI itself.",
    });

  checks.push(snapshot.services.crashed === 0
    ? {
      id: "services-health",
      title: "Managed services",
      status: snapshot.services.total > 0 ? "pass" : "warn",
      summary: snapshot.services.total > 0
        ? `All ${snapshot.services.total} managed services are healthy or stopped cleanly.`
        : "No managed services are configured.",
    }
    : {
      id: "services-health",
      title: "Managed services",
      status: "warn",
      summary: `${snapshot.services.crashed} managed service(s) are currently crashed.`,
      suggestedAction: "Inspect the workspace Services page or logs and restart the failed service.",
    });

  checks.push(snapshot.agents.crashed === 0
    ? {
      id: "agent-health",
      title: "Agent runtime health",
      status: crashedIssues.length > 0 ? "pass" : "warn",
      summary: crashedIssues.length > 0
        ? "Running/reviewing issues do not have crashed managed agents."
        : "No actively running issues right now.",
    }
    : {
      id: "agent-health",
      title: "Agent runtime health",
      status: "warn",
      summary: `${snapshot.agents.crashed} managed agent session(s) are crashed or failed.`,
      suggestedAction: "Use issue live logs and retry/replan from the affected issue drawer.",
    });

  checks.push(snapshot.memory.issuesWithFlushes > 0
    ? {
      id: "memory-pipeline",
      title: "Workspace memory pipeline",
      status: "pass",
      summary: `Workspace memory has flushed ${snapshot.memory.totalFlushes} time(s) across ${snapshot.memory.issuesWithFlushes} issue(s).`,
    }
    : {
      id: "memory-pipeline",
      title: "Workspace memory pipeline",
      status: "warn",
      summary: "No workspace memory flushes have been recorded yet.",
      suggestedAction: "Run at least one issue through planning/execution/review so memory files and context reports are seeded.",
    });

  return checks;
}

export function buildProbeResult(
  state: RuntimeState,
  deps?: RuntimeDiagnosticsDeps,
): {
  ok: boolean;
  generatedAt: string;
  checks: Array<{ id: string; ok: boolean; detail: string }>;
} {
  const doctorChecks = runDoctorChecks(state, deps);
  return {
    ok: doctorChecks.every((check) => check.status !== "fail"),
    generatedAt: now(),
    checks: doctorChecks.map((check) => ({
      id: check.id,
      ok: check.status !== "fail",
      detail: check.summary,
    })),
  };
}
