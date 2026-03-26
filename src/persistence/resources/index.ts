import runtimeStateResource from "./runtime-state.resource.ts";
import issuesResource from "./issues.resource.ts";
import milestonesResource from "./milestones.resource.ts";
import issuePlansResource from "./issue-plans.resource.ts";
import eventsResource from "./events.resource.ts";
import settingsResource from "./settings.resource.ts";
import agentSessionsResource from "./agent-sessions.resource.ts";
import agentPipelinesResource from "./agent-pipelines.resource.ts";
import servicesResource from "./services.resource.ts";
import variablesResource from "./variables.resource.ts";
import contextFragmentsResource from "./context-fragments.resource.ts";

export const NATIVE_RESOURCE_CONFIGS = [
  runtimeStateResource,
  issuesResource,
  milestonesResource,
  issuePlansResource,
  eventsResource,
  settingsResource,
  agentSessionsResource,
  agentPipelinesResource,
  servicesResource,
  variablesResource,
  contextFragmentsResource,
] as const;

export const NATIVE_RESOURCE_NAMES = NATIVE_RESOURCE_CONFIGS.map((resource) => resource.name);
