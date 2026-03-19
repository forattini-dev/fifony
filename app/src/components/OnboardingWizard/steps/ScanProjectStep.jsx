import { useState, useEffect, useCallback, useRef } from "react";
import {
  FolderSearch, Loader2, FileText, CircleCheck, CircleX,
  Sparkles, Bot, Boxes, Eye,
} from "lucide-react";
import { api } from "../../../api";


const FILE_LABELS = {
  claudeMd: "CLAUDE.md", claudeDir: ".claude/", codexDir: ".codex/",
  readmeMd: "README.md", packageJson: "package.json",
  cargoToml: "Cargo.toml", pyprojectToml: "pyproject.toml",
  goMod: "go.mod", buildGradle: "build.gradle", gemfile: "Gemfile",
  dockerfile: "Dockerfile", workflowMd: "WORKFLOW.md",
  agentsMd: "AGENTS.md", claudeAgentsDir: ".claude/agents/", claudeSkillsDir: ".claude/skills/",
  codexAgentsDir: ".codex/agents/", codexSkillsDir: ".codex/skills/",
};

function ScanProjectStep({
  scanResult, setScanResult,
  projectDescription, setProjectDescription,
  analysisResult, setAnalysisResult,
  selectedProvider, analyzing, setAnalyzing,
  wantsDiscovery, setWantsDiscovery,
}) {
  const [scanLoading, setScanLoading] = useState(false);
  const [scanError, setScanError] = useState(null);
  const [analyzeError, setAnalyzeError] = useState(null);
  const didScan = useRef(false);

  // Auto-trigger filesystem scan on mount, then auto-analyze with AI
  useEffect(() => {
    if (didScan.current || scanResult) return;
    didScan.current = true;
    setScanLoading(true);
    setScanError(null);
    api.get("/scan/project")
      .then((data) => {
        setScanResult(data);
        if (!projectDescription) {
          const desc = data?.packageDescription || data?.packageInfo?.description || data?.readmeExcerpt || "";
          if (desc) setProjectDescription(desc);
        }
        // Auto-trigger AI analysis if a provider is available
        if (selectedProvider && !analysisResult) {
          setAnalyzing(true);
          api.post("/scan/analyze", { provider: selectedProvider })
            .then((analysis) => {
              setAnalysisResult(analysis);
              if (analysis.description) setProjectDescription(analysis.description);
            })
            .catch(() => { /* AI analysis is optional, ignore errors */ })
            .finally(() => setAnalyzing(false));
        }
      })
      .catch((err) => setScanError(err.message || "Failed to scan project"))
      .finally(() => setScanLoading(false));
  }, []);

  const handleAnalyze = useCallback(async () => {
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const data = await api.post("/scan/analyze", { provider: selectedProvider || "claude" });
      setAnalysisResult(data);
      if (data.description) setProjectDescription(data.description);
    } catch (err) {
      setAnalyzeError(err.message || "Analysis failed");
    } finally {
      setAnalyzing(false);
    }
  }, [selectedProvider, setAnalyzing, setAnalysisResult, setProjectDescription]);

  const scanFiles = scanResult?.files || {};
  const foundFiles = Object.entries(scanFiles).map(([key, exists]) => ({
    path: FILE_LABELS[key] || key,
    exists: Boolean(exists),
  }));
  const existingAgents = (scanResult?.existingAgents || []).map((a) => typeof a === "string" ? { name: a } : a);
  const existingSkills = (scanResult?.existingSkills || []).map((s) => typeof s === "string" ? { name: s } : s);
  const detectedStack = analysisResult?.stack || [];

  return (
    <div className="flex flex-col gap-6 stagger-children">
      <div className="text-center">
        <FolderSearch className="size-10 text-primary mx-auto mb-3" />
        <h2 className="text-2xl font-bold">Scan Project</h2>
        <p className="text-base-content/60 mt-1">We'll analyze your workspace to suggest the best setup</p>
      </div>

      {scanLoading && (
        <div className="flex flex-col items-center gap-3 py-6">
          <Loader2 className="size-8 text-primary animate-spin" />
          <p className="text-sm text-base-content/50">Scanning project files...</p>
        </div>
      )}

      {scanError && (
        <div className="alert alert-warning text-sm">{scanError}</div>
      )}

      {scanResult && !scanLoading && (
        <div className="card bg-base-200">
          <div className="card-body p-4 gap-3">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <FileText className="size-4 opacity-50" />
              Project Files
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {foundFiles.map((f) => (
                <div key={f.path} className="flex items-center gap-2 text-sm">
                  {f.exists ? (
                    <CircleCheck className="size-4 text-success shrink-0" />
                  ) : (
                    <CircleX className="size-4 text-base-content/30 shrink-0" />
                  )}
                  <span className={`font-mono text-xs truncate ${f.exists ? "" : "text-base-content/40"}`}>
                    {f.path}
                  </span>
                </div>
              ))}
            </div>

            {(existingAgents.length > 0 || existingSkills.length > 0) && (
              <>
                <div className="divider my-0" />
                <div className="flex flex-wrap gap-2">
                  {existingAgents.length > 0 && (
                    <span className="badge badge-sm badge-info gap-1">
                      <Bot className="size-3" />
                      {existingAgents.length} agent{existingAgents.length !== 1 ? "s" : ""} found
                    </span>
                  )}
                  {existingSkills.length > 0 && (
                    <span className="badge badge-sm badge-secondary gap-1">
                      <Boxes className="size-3" />
                      {existingSkills.length} skill{existingSkills.length !== 1 ? "s" : ""} found
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {!analyzing && !analysisResult && (
        <button
          className="btn btn-primary btn-lg gap-2 mx-auto"
          onClick={handleAnalyze}
          disabled={scanLoading}
        >
          <Sparkles className="size-5" />
          Analyze with AI
        </button>
      )}

      {analyzing && (
        <div className="flex flex-col items-center gap-3 py-4">
          <Loader2 className="size-8 text-primary animate-spin" />
          <p className="text-sm text-base-content/50">AI is analyzing your project...</p>
        </div>
      )}

      {analyzeError && (
        <div className="alert alert-warning text-sm">
          Analysis failed. You can describe your project manually below.
        </div>
      )}

      {detectedStack.length > 0 && (
        <div className="flex flex-wrap gap-2 justify-center">
          {detectedStack.map((tech) => (
            <span key={tech} className="badge badge-sm badge-soft badge-primary">{tech}</span>
          ))}
        </div>
      )}

      {(scanResult || analysisResult || analyzeError) && !scanLoading && !analyzing && (
        <div>
          <label className="label text-sm font-medium">Project Description</label>
          <textarea
            className="textarea textarea-bordered w-full h-24 text-sm"
            placeholder="Describe your project so we can suggest the right agents and domains..."
            value={projectDescription}
            onChange={(e) => setProjectDescription(e.target.value)}
          />
        </div>
      )}

      {/* Discovery opt-in toggle */}
      <div className="w-full max-w-lg">
        <label className="flex items-center gap-3 cursor-pointer p-3 rounded-lg bg-base-200/50 border border-base-300/50 hover:border-primary/30 transition-colors">
          <input
            type="checkbox"
            className="toggle toggle-primary toggle-sm"
            checked={wantsDiscovery}
            onChange={(e) => setWantsDiscovery(e.target.checked)}
          />
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <Eye className="size-4 text-primary" />
              <span className="text-sm font-medium">Discover existing issues</span>
            </div>
            <p className="text-xs text-base-content/50 mt-0.5">
              Scan for TODOs, FIXMEs, and GitHub issues to import
            </p>
          </div>
        </label>
      </div>
    </div>
  );
}

export default ScanProjectStep;
