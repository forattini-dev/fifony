import { useState, useEffect, useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../../api";
import { useSettings, getSettingsList, getSettingValue, SETTINGS_QUERY_KEY, upsertSettingPayload } from "../../hooks";
import { PROJECT_SETTING_ID, buildQueueTitle, normalizeProjectName, resolveProjectMeta } from "../../project-meta.js";
import Confetti from "../Confetti";
import OnboardingParticles from "../OnboardingParticles";
import { ChevronRight } from "lucide-react";
import { DiscoveredIssuesOnboarding } from "../DiscoveredIssuesView";

import { getStepLabels, getStepCount } from "./constants";
import { saveSetting, normalizeRoleEfforts, buildWorkflowConfig } from "./helpers";

import StepIndicator from "./steps/StepIndicator";
import StepContent from "./steps/StepContent";
import WizardNavFooter from "./steps/WizardNavFooter";
import WelcomeStep from "./steps/WelcomeStep";
import ProjectStep from "./steps/ProjectStep";
import BranchStep from "./steps/BranchStep";
import PipelineStep from "./steps/PipelineStep";
import ScanProjectStep from "./steps/ScanProjectStep";
import DomainsStep from "./steps/DomainsStep";
import AgentsSkillsStep from "./steps/AgentsSkillsStep";
import EffortStep from "./steps/EffortStep";
import WorkersThemeStep from "./steps/WorkersThemeStep";
import CompleteStep from "./steps/CompleteStep";

// ── Main Wizard Component ─────────────────────────────────────────────────────

export default function OnboardingWizard({ onComplete }) {
  const qc = useQueryClient();
  const settingsQuery = useSettings();
  const settings = getSettingsList(settingsQuery.data);

  // Wizard state
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState("forward");
  const [launching, setLaunching] = useState(false);
  const [confetti, setConfetti] = useState(null);
  const hydratedRef = useRef(false);
  const projectHydratedRef = useRef(false);

  // Config state
  const [pipeline, setPipeline] = useState({ planner: "", executor: "", reviewer: "" });
  const [efforts, setEfforts] = useState(() => normalizeRoleEfforts(null));
  const [concurrency, setConcurrency] = useState(3);
  const [selectedTheme, setSelectedTheme] = useState("auto");

  // New step state
  const [scanResult, setScanResult] = useState(null);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [projectDescription, setProjectDescription] = useState("");
  const [projectName, setProjectNameState] = useState("");
  const [projectSource, setProjectSource] = useState("missing");
  const [runtimeSnapshot, setRuntimeSnapshot] = useState(null);
  const [selectedDomains, setSelectedDomains] = useState([]);
  const [selectedAgents, setSelectedAgents] = useState([]);
  const [selectedSkills, setSelectedSkills] = useState([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [wantsDiscovery, setWantsDiscovery] = useState(false);

  const STEP_COUNT = getStepCount(wantsDiscovery);
  const STEP_LABELS = getStepLabels(wantsDiscovery);

  // Map logical step index to step name (handles the optional discovery step)
  const stepName = STEP_LABELS[step] || "";

  // Provider detection
  const [providers, setProviders] = useState(null);
  const [providersLoading, setProvidersLoading] = useState(false);
  const [modelsByProvider, setModelsByProvider] = useState({});
  const [models, setModels] = useState({ plan: "", execute: "", review: "" });

  // Workspace path and default branch from runtime state
  const [workspacePath, setWorkspacePath] = useState("");
  const [defaultBranch, setDefaultBranch] = useState("");

  // Load workspace path and branch on mount
  useEffect(() => {
    api.get("/state").then((data) => {
      setRuntimeSnapshot(data || {});
      const path = data?.sourceRepoUrl || data?.config?.sourceRepo || "";
      setWorkspacePath(path);
      setDefaultBranch(data?.config?.defaultBranch || "");
    }).catch(() => {
      setRuntimeSnapshot({});
    });
  }, []);

  useEffect(() => {
    if (hydratedRef.current || settingsQuery.isLoading) return;
    hydratedRef.current = true;

    const savedProvider = getSettingValue(settings, "runtime.agentProvider", "");
    const savedEfforts = getSettingValue(settings, "runtime.defaultEffort", null);
    const savedTheme = getSettingValue(settings, "ui.theme", "auto");
    const savedConcurrency = getSettingValue(settings, "runtime.workerConcurrency", 3);

    if (typeof savedProvider === "string" && savedProvider.trim()) {
      setPipeline((prev) => ({
        planner: prev.planner || savedProvider,
        executor: prev.executor || savedProvider,
        reviewer: prev.reviewer || savedProvider,
      }));
    }
    setEfforts(normalizeRoleEfforts(savedEfforts));
    if (typeof savedTheme === "string" && savedTheme.trim()) {
      setSelectedTheme(savedTheme);
    }

    const parsedConcurrency = Number.parseInt(String(savedConcurrency ?? 2), 10);
    if (Number.isFinite(parsedConcurrency)) {
      setConcurrency(Math.min(16, Math.max(1, parsedConcurrency)));
    }
  }, [settings, settingsQuery.isLoading]);

  useEffect(() => {
    if (projectHydratedRef.current || settingsQuery.isLoading || runtimeSnapshot === null) return;
    projectHydratedRef.current = true;

    const projectMeta = resolveProjectMeta(settings, runtimeSnapshot);
    setProjectNameState(projectMeta.projectName);
    setProjectSource(projectMeta.source);
  }, [runtimeSnapshot, settings, settingsQuery.isLoading]);

  const setProjectName = useCallback((value) => {
    setProjectNameState(value);
    setProjectSource("manual");
  }, []);

  const normalizedProjectName = normalizeProjectName(projectName);
  const queueTitle = buildQueueTitle(normalizedProjectName);

  useEffect(() => {
    document.title = buildQueueTitle(normalizedProjectName || runtimeSnapshot?.detectedProjectName || runtimeSnapshot?.projectName || "");
  }, [normalizedProjectName, runtimeSnapshot]);

  // Fetch providers (and models) shortly before the pipeline step
  useEffect(() => {
    if (step >= 2 && providers === null) {
      setProvidersLoading(true);
      Promise.all([
        api.get("/providers"),
        api.get("/config/workflow?details=1").catch(() => null),
      ]).then(([provData, workflowData]) => {
        const list = Array.isArray(provData) ? provData : provData?.providers || [];
        setProviders(list);

        // Models from workflow endpoint
        const fetchedModels = workflowData?.models || {};
        setModelsByProvider(fetchedModels);

        // Auto-select first available + set default pipeline
        const available = list.filter((p) => p.available !== false);
        const firstName = available[0]?.id || available[0]?.name || "";

        // Default pipeline: claude plans + reviews, first available executes
        const claudeAvailable = available.find((p) => (p.id || p.name) === "claude");
        const defaultCli = firstName;
        const planReviewCli = claudeAvailable ? "claude" : defaultCli;
        const newPipeline = {
          planner: planReviewCli,
          executor: defaultCli,
          reviewer: planReviewCli,
        };
        setPipeline((prev) => ({
          planner: prev.planner || newPipeline.planner,
          executor: prev.executor || newPipeline.executor,
          reviewer: prev.reviewer || newPipeline.reviewer,
        }));

        // Auto-select first model per stage
        setModels((prev) => ({
          plan: prev.plan || fetchedModels[planReviewCli]?.[0]?.id || "",
          execute: prev.execute || fetchedModels[defaultCli]?.[0]?.id || "",
          review: prev.review || fetchedModels[planReviewCli]?.[0]?.id || "",
        }));
      }).catch(() => {
        setProviders([]);
      }).finally(() => {
        setProvidersLoading(false);
      });
    }
  }, [step, providers]);

  // Apply theme preview immediately
  useEffect(() => {
    const resolved = selectedTheme === "auto"
      ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      : selectedTheme;
    document.documentElement.setAttribute("data-theme", resolved);
  }, [selectedTheme]);

  // Save settings progressively as user advances
  const saveStepSettings = useCallback((currentStepName) => {
    if (currentStepName === "Project") {
      if (normalizedProjectName) {
        saveSetting(PROJECT_SETTING_ID, normalizedProjectName, "system").catch(() => {});
      }
    } else if (currentStepName === "Providers") {
      // Save pipeline as providers array + primary provider
      const pipelineProviders = [
        { provider: pipeline.planner, role: "planner" },
        { provider: pipeline.executor, role: "executor" },
        { provider: pipeline.reviewer, role: "reviewer" },
      ];
      saveSetting("runtime.agentProvider", pipeline.executor, "runtime").catch(() => {});
      saveSetting("runtime.pipeline", pipelineProviders, "runtime").catch(() => {});
      // Also save as WorkflowConfig so planner/executor/reviewer use correct providers
      saveSetting("runtime.workflowConfig", buildWorkflowConfig(pipeline, efforts, models), "runtime").catch(() => {});
    } else if (currentStepName === "Effort") {
      saveSetting("runtime.defaultEffort", efforts, "runtime").catch(() => {});
      // Update WorkflowConfig with latest efforts + models
      saveSetting("runtime.workflowConfig", buildWorkflowConfig(pipeline, efforts, models), "runtime").catch(() => {});
    } else if (currentStepName === "Workers & Theme") {
      saveSetting("ui.theme", selectedTheme, "ui").catch(() => {});
      api.post("/config/concurrency", { concurrency }).catch(() => {});
    }
  }, [pipeline, efforts, models, concurrency, selectedTheme, normalizedProjectName]);

  const goNext = useCallback(() => {
    if (step < STEP_COUNT - 1) {
      saveStepSettings(stepName);
      setDirection("forward");
      setStep((s) => s + 1);
    }
  }, [step, STEP_COUNT, stepName, saveStepSettings]);

  const goBack = useCallback(() => {
    if (step > 0) {
      setDirection("backward");
      setStep((s) => s - 1);
    }
  }, [step]);

  const handleLaunch = useCallback(async () => {
    if (!normalizedProjectName) return;
    setLaunching(true);
    try {
      // Save all settings in parallel
      const saves = [
        saveSetting(PROJECT_SETTING_ID, normalizedProjectName, "system"),
        saveSetting("ui.theme", selectedTheme, "ui"),
        saveSetting("ui.onboarding.completed", true, "ui"),
      ];

      // Save pipeline configuration
      const pipelineProviders = [
        { provider: pipeline.planner, role: "planner" },
        { provider: pipeline.executor, role: "executor" },
        { provider: pipeline.reviewer, role: "reviewer" },
      ];
      saves.push(saveSetting("runtime.agentProvider", pipeline.executor, "runtime"));
      saves.push(saveSetting("runtime.pipeline", pipelineProviders, "runtime"));

      saves.push(saveSetting("runtime.defaultEffort", efforts, "runtime"));
      // Save as WorkflowConfig (the format read by planner, executor, reviewer stages)
      saves.push(saveSetting("runtime.workflowConfig", buildWorkflowConfig(pipeline, efforts, models), "runtime"));
      saves.push(api.post("/config/concurrency", { concurrency }));

      // Install selected agents and skills
      if (selectedAgents.length > 0) {
        saves.push(api.post("/install/agents", { agents: selectedAgents }));
      }
      if (selectedSkills.length > 0) {
        saves.push(api.post("/install/skills", { skills: selectedSkills }));
      }

      await Promise.allSettled(saves);

      // Optimistically update settings cache so OnboardingGate immediately sees completed=true
      qc.setQueryData(SETTINGS_QUERY_KEY, (current) => upsertSettingPayload(current, {
        id: PROJECT_SETTING_ID,
        scope: "system",
        value: normalizedProjectName,
        source: "user",
        updatedAt: new Date().toISOString(),
      }));
      qc.setQueryData(SETTINGS_QUERY_KEY, (current) => upsertSettingPayload(current, {
        id: "ui.onboarding.completed",
        scope: "ui",
        value: true,
        source: "user",
        updatedAt: new Date().toISOString(),
      }));

      // Show confetti, then navigate
      setConfetti({ x: window.innerWidth / 2, y: window.innerHeight / 3 });
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: SETTINGS_QUERY_KEY });
        onComplete?.();
      }, 1200);
    } catch {
      // Even on error, mark as done so user isn't stuck
      qc.setQueryData(SETTINGS_QUERY_KEY, (current) => upsertSettingPayload(current, {
        id: PROJECT_SETTING_ID,
        scope: "system",
        value: normalizedProjectName,
        source: "user",
        updatedAt: new Date().toISOString(),
      }));
      qc.setQueryData(SETTINGS_QUERY_KEY, (current) => upsertSettingPayload(current, {
        id: "ui.onboarding.completed",
        scope: "ui",
        value: true,
        source: "user",
        updatedAt: new Date().toISOString(),
      }));
      await saveSetting("ui.onboarding.completed", true, "ui").catch(() => {});
      qc.invalidateQueries({ queryKey: SETTINGS_QUERY_KEY });
      onComplete?.();
    }
  }, [normalizedProjectName, pipeline, efforts, models, concurrency, selectedTheme, selectedAgents, selectedSkills, qc, onComplete]);

  // Can proceed from step
  const canProceed =
    stepName === "Welcome" ||
    (stepName === "Project" && Boolean(normalizedProjectName)) ||
    stepName === "Branch" ||
    (stepName === "Providers" && (pipeline.executor || providersLoading)) ||
    stepName === "Scan Project" ||
    stepName === "Discover Issues" ||
    stepName === "Domains" ||
    stepName === "Agents & Skills" ||
    stepName === "Effort" ||
    stepName === "Workers & Theme" ||
    stepName === "Launch";

  const existingAgents = (scanResult?.existingAgents || []).map((a) => typeof a === "string" ? { name: a } : a);
  const existingSkills = (scanResult?.existingSkills || []).map((s) => typeof s === "string" ? { name: s } : s);

  const config = {
    projectName: normalizedProjectName,
    queueTitle,
    pipeline,
    efforts,
    concurrency,
    theme: selectedTheme,
    domains: selectedDomains,
    agents: selectedAgents,
    skills: selectedSkills,
  };

  return (
    <div className="fixed inset-0 z-50 bg-base-100 flex flex-col overflow-hidden">
      <OnboardingParticles />

      {confetti && (
        <Confetti x={confetti.x} y={confetti.y} active onDone={() => setConfetti(null)} />
      )}

      {/* Header with step indicator — hidden on welcome screen */}
      {step > 0 && (
        <div className="relative z-10 pt-6 pb-2 px-4 flex justify-center">
          <StepIndicator current={step} wantsDiscovery={wantsDiscovery} />
        </div>
      )}

      {/* Step content area */}
      <div className="relative z-10 flex-1 flex flex-col items-center justify-start px-4 py-6 overflow-y-auto">
        <StepContent direction={direction} stepKey={step} center={stepName === "Welcome" || stepName === "Project" || stepName === "Branch" || stepName === "Providers" || stepName === "Launch"}>
          {stepName === "Welcome" && <WelcomeStep workspacePath={workspacePath} onGetStarted={goNext} />}
          {stepName === "Project" && (
            <ProjectStep
              projectName={projectName}
              setProjectName={setProjectName}
              detectedProjectName={runtimeSnapshot?.detectedProjectName || ""}
              projectSource={projectSource}
              workspacePath={workspacePath}
            />
          )}
          {stepName === "Branch" && (
            <BranchStep
              currentBranch={defaultBranch}
              onBranchCreated={(branch) => setDefaultBranch(branch)}
            />
          )}
          {stepName === "Providers" && (
            <PipelineStep
              providers={providers || []}
              providersLoading={providersLoading}
              pipeline={pipeline}
              setPipeline={setPipeline}
            />
          )}
          {stepName === "Scan Project" && (
            <ScanProjectStep
              scanResult={scanResult}
              setScanResult={setScanResult}
              projectDescription={projectDescription}
              setProjectDescription={setProjectDescription}
              analysisResult={analysisResult}
              setAnalysisResult={setAnalysisResult}
              selectedProvider={pipeline.executor}
              analyzing={analyzing}
              setAnalyzing={setAnalyzing}
              wantsDiscovery={wantsDiscovery}
              setWantsDiscovery={setWantsDiscovery}
            />
          )}
          {stepName === "Discover Issues" && (
            <DiscoveredIssuesOnboarding />
          )}
          {stepName === "Domains" && (
            <DomainsStep
              selectedDomains={selectedDomains}
              setSelectedDomains={setSelectedDomains}
              analysisResult={analysisResult}
            />
          )}
          {stepName === "Agents & Skills" && (
            <AgentsSkillsStep
              selectedDomains={selectedDomains}
              selectedAgents={selectedAgents}
              setSelectedAgents={setSelectedAgents}
              selectedSkills={selectedSkills}
              setSelectedSkills={setSelectedSkills}
              existingAgents={existingAgents}
              existingSkills={existingSkills}
            />
          )}
          {stepName === "Effort" && (
            <EffortStep
              efforts={efforts}
              setEfforts={setEfforts}
              pipeline={pipeline}
              models={models}
              setModels={setModels}
              modelsByProvider={modelsByProvider}
            />
          )}
          {stepName === "Workers & Theme" && (
            <WorkersThemeStep
              concurrency={concurrency}
              setConcurrency={setConcurrency}
              selectedTheme={selectedTheme}
              setSelectedTheme={setSelectedTheme}
            />
          )}
          {stepName === "Launch" && <CompleteStep config={config} launching={launching} />}
        </StepContent>
      </div>

      {/* Navigation footer — hidden on welcome (button is inline) */}
      <WizardNavFooter
        step={step}
        stepCount={STEP_COUNT}
        stepName={stepName}
        canProceed={canProceed}
        launching={launching}
        onBack={goBack}
        onNext={goNext}
        onLaunch={handleLaunch}
      />
    </div>
  );
}
