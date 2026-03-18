import { useEffect } from "react";
import { Gauge } from "lucide-react";
import { getEffortOptionsForRole } from "../constants";

function RoleEffortSelector({ role, title, description, providerName, value, onChange, options, model, onModelChange, availableModels }) {
  const currentIndex = Math.max(0, options.findIndex((o) => o.value === value));
  const current = options[currentIndex] || options[0];
  const Icon = current.icon;

  return (
    <div className="card bg-base-200">
      <div className="card-body p-5 gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold">{title}</h3>
            <p className="text-xs text-base-content/60 mt-0.5">{description}</p>
          </div>
          {providerName && (
            <span className="badge badge-sm badge-soft badge-primary capitalize">{providerName}</span>
          )}
        </div>

        {/* Model selector */}
        {availableModels && availableModels.length > 0 && (
          <div className="flex flex-col gap-1">
            <label className="text-xs text-base-content/50">Model</label>
            <select
              className="select select-sm select-bordered w-full"
              value={model || ""}
              onChange={(e) => onModelChange?.(e.target.value)}
            >
              {availableModels.map((m) => (
                <option key={m.id} value={m.id}>{m.label || m.id}</option>
              ))}
            </select>
          </div>
        )}

        {/* Current value display */}
        <div className="flex flex-col items-center gap-2 py-2">
          <div className={`flex items-center gap-2 text-lg font-bold ${current.color}`}>
            <Icon className="size-6" />
            {current.label}
          </div>
          <p className="text-xs text-base-content/50 text-center max-w-xs">{current.description}</p>
        </div>

        {/* Slider */}
        <div className="px-1">
          <input
            type="range"
            min={0}
            max={options.length - 1}
            value={currentIndex}
            onChange={(e) => onChange(options[Number(e.target.value)].value)}
            className="range range-primary range-sm w-full"
            step={1}
          />
          <div className="flex justify-between mt-1 px-0.5">
            {options.map((opt) => (
              <span
                key={`${role}-tick-${opt.value}`}
                className={`text-[10px] ${opt.value === current.value ? current.color + " font-semibold" : "text-base-content/30"}`}
              >
                {opt.label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function EffortStep({ efforts, setEfforts, pipeline, models, setModels, modelsByProvider }) {
  // Auto-clamp effort if user changed pipeline and current effort is unsupported
  useEffect(() => {
    for (const role of ["planner", "executor", "reviewer"]) {
      const options = getEffortOptionsForRole(role, pipeline);
      const currentValue = efforts[role];
      if (currentValue && !options.some((o) => o.value === currentValue)) {
        setEfforts((prev) => ({ ...prev, [role]: "high" })); // downgrade to max supported
      }
    }
  }, [pipeline, efforts, setEfforts]);

  const plannerModels = modelsByProvider?.[pipeline?.planner] || [];
  const executorModels = modelsByProvider?.[pipeline?.executor] || [];
  const reviewerModels = modelsByProvider?.[pipeline?.reviewer] || [];

  return (
    <div className="flex flex-col gap-6 stagger-children">
      <div className="text-center">
        <Gauge className="size-10 text-primary mx-auto mb-3" />
        <h2 className="text-2xl font-bold">Models & Reasoning Effort</h2>
        <p className="text-base-content/60 mt-1">Choose the model and reasoning depth for each pipeline stage.</p>
      </div>

      <RoleEffortSelector
        role="planner"
        title="Planning"
        description="Scopes the issue and decides the overall approach."
        providerName={pipeline?.planner}
        value={efforts.planner}
        onChange={(value) => setEfforts((current) => ({ ...current, planner: value }))}
        options={getEffortOptionsForRole("planner", pipeline)}
        model={models?.plan}
        onModelChange={(m) => setModels((prev) => ({ ...prev, plan: m }))}
        availableModels={plannerModels}
      />
      <RoleEffortSelector
        role="executor"
        title="Execution"
        description="Implements the plan — writes code, edits files."
        providerName={pipeline?.executor}
        value={efforts.executor}
        onChange={(value) => setEfforts((current) => ({ ...current, executor: value }))}
        options={getEffortOptionsForRole("executor", pipeline)}
        model={models?.execute}
        onModelChange={(m) => setModels((prev) => ({ ...prev, execute: m }))}
        availableModels={executorModels}
      />
      <RoleEffortSelector
        role="reviewer"
        title="Review"
        description="Validates the result before approving."
        providerName={pipeline?.reviewer}
        value={efforts.reviewer}
        onChange={(value) => setEfforts((current) => ({ ...current, reviewer: value }))}
        options={getEffortOptionsForRole("reviewer", pipeline)}
        model={models?.review}
        onModelChange={(m) => setModels((prev) => ({ ...prev, review: m }))}
        availableModels={reviewerModels}
      />
    </div>
  );
}

export default EffortStep;
