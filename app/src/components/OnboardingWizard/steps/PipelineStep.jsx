import { useEffect } from "react";
import { Rocket, ChevronRight, Loader2, CircleCheck, CircleX } from "lucide-react";
import { PIPELINE_ROLES, getEffortOptionsForRole } from "../constants";

// Map pipeline role to model key
const ROLE_MODEL_KEY = {
  planner: "plan",
  executor: "execute",
  reviewer: "review",
};

function PipelineStep({
  providers, providersLoading, pipeline, setPipeline,
  efforts, setEfforts, models, setModels, modelsByProvider,
}) {
  const providerList = Array.isArray(providers) ? providers : [];
  const availableProviders = providerList.filter((p) => p.available !== false);

  // Auto-clamp effort if user changed pipeline and current effort is unsupported
  useEffect(() => {
    for (const role of ["planner", "executor", "reviewer"]) {
      const options = getEffortOptionsForRole(role, pipeline);
      const currentValue = efforts[role];
      if (currentValue && !options.some((o) => o.value === currentValue)) {
        setEfforts((prev) => ({ ...prev, [role]: "high" }));
      }
    }
  }, [pipeline, efforts, setEfforts]);

  return (
    <div className="flex flex-col gap-6 stagger-children">
      <div className="text-center">
        <Rocket className="size-10 text-primary mx-auto mb-3" />
        <h2 className="text-2xl font-bold">Agent Pipeline</h2>
        <p className="text-base-content/60 mt-1">Choose which CLI runs each stage and set the reasoning depth</p>
      </div>

      {providersLoading ? (
        <div className="flex flex-col items-center gap-3 py-8">
          <Loader2 className="size-8 text-primary animate-spin" />
          <p className="text-sm text-base-content/50">Detecting available CLIs...</p>
        </div>
      ) : availableProviders.length === 0 ? (
        <div className="alert alert-warning text-sm">
          No providers detected. Make sure claude or codex CLI is installed.
        </div>
      ) : (
        <>
          {/* Provider status */}
          <div className="flex flex-wrap gap-2 justify-center">
            {providerList.map((prov) => {
              const name = prov.id || prov.name || prov;
              const available = prov.available !== false;
              return (
                <span key={name} className={`badge badge-lg gap-2 ${available ? "badge-success" : "badge-ghost opacity-50"}`}>
                  {available ? <CircleCheck className="size-3.5" /> : <CircleX className="size-3.5" />}
                  {name}
                  {prov.path && (
                    <span className="font-mono text-[10px] opacity-60 hidden sm:inline">{prov.path}</span>
                  )}
                </span>
              );
            })}
          </div>

          {/* Pipeline role cards */}
          <div className="flex flex-col items-center gap-2">
            {PIPELINE_ROLES.map((r, i) => {
              const Icon = r.icon;
              const selected = pipeline[r.role] || availableProviders[0]?.id || availableProviders[0]?.name || "";
              const modelKey = ROLE_MODEL_KEY[r.role];
              const currentModel = models?.[modelKey] || "";
              const availableModels = modelsByProvider?.[selected] || [];

              const effortOptions = getEffortOptionsForRole(r.role, pipeline);
              const currentEffortValue = efforts?.[r.role] || "high";
              const effortIndex = Math.max(0, effortOptions.findIndex((o) => o.value === currentEffortValue));
              const currentEffort = effortOptions[effortIndex] || effortOptions[0];
              const EffortIcon = currentEffort.icon;

              return (
                <div key={r.role} className="w-full">
                  {i > 0 && (
                    <div className="flex justify-center py-1">
                      <ChevronRight className="size-5 rotate-90 opacity-30" />
                    </div>
                  )}
                  <div className="card bg-base-200">
                    <div className="card-body p-4 gap-4">
                      {/* Header row: icon + label + provider select */}
                      <div className="flex items-center gap-3">
                        <div className={`size-10 rounded-full flex items-center justify-center bg-base-300 ${r.color}`}>
                          <Icon className="size-5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold">{r.label}</div>
                          <p className="text-xs text-base-content/50">{r.description}</p>
                        </div>
                        <select
                          className="select select-bordered select-sm w-28"
                          value={selected}
                          onChange={(e) => setPipeline((prev) => ({ ...prev, [r.role]: e.target.value }))}
                        >
                          {availableProviders.map((p) => {
                            const name = p.id || p.name || p;
                            return <option key={name} value={name}>{name}</option>;
                          })}
                        </select>
                      </div>

                      {/* Effort slider */}
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-base-content/50">Effort</span>
                          <span className={`text-xs font-semibold flex items-center gap-1 ${currentEffort.color}`}>
                            <EffortIcon className="size-3" /> {currentEffort.label}
                          </span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={effortOptions.length - 1}
                          value={effortIndex}
                          onChange={(e) => setEfforts((prev) => ({ ...prev, [r.role]: effortOptions[Number(e.target.value)].value }))}
                          className="range range-primary range-xs"
                          step={1}
                        />
                        <div className="flex justify-between px-2.5 mt-1 text-[10px]">
                          {effortOptions.map((opt) => (
                            <span
                              key={opt.value}
                              className={opt.value === currentEffort.value ? currentEffort.color + " font-semibold" : "text-base-content/30"}
                            >
                              {opt.label}
                            </span>
                          ))}
                        </div>
                      </div>

                      {/* Model select */}
                      {availableModels.length > 0 && (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-base-content/50 shrink-0">Model</span>
                          <select
                            className="select select-xs select-bordered flex-1"
                            value={currentModel}
                            onChange={(e) => setModels((prev) => ({ ...prev, [modelKey]: e.target.value }))}
                          >
                            {availableModels.map((m) => (
                              <option key={m.id} value={m.id}>{m.label || m.id}</option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <p className="text-xs text-base-content/40 text-center max-w-md mx-auto">
            Each stage can use a different CLI and reasoning depth. The pipeline flows top to bottom: plan, then execute, then review.
          </p>
        </>
      )}
    </div>
  );
}

export default PipelineStep;
