import { Users, Palette } from "lucide-react";
import { THEMES } from "../constants";

function WorkersThemeStep({ concurrency, setConcurrency, selectedTheme, setSelectedTheme }) {
  return (
    <div className="flex flex-col gap-6 stagger-children">
      {/* Concurrency */}
      <div>
        <div className="text-center mb-4">
          <Users className="size-10 text-primary mx-auto mb-3" />
          <h2 className="text-2xl font-bold">Workers & Theme</h2>
          <p className="text-base-content/60 mt-1">Configure parallel workers and visual theme</p>
        </div>

        <div className="card bg-base-200">
          <div className="card-body p-5 gap-3">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <Users className="size-4 opacity-50" />
              Worker Concurrency
            </h3>
            <p className="text-xs text-base-content/60">
              How many agents can work in parallel ({concurrency} worker{concurrency !== 1 ? "s" : ""})
            </p>
            <input
              type="range"
              min={1}
              max={16}
              value={concurrency}
              onChange={(e) => setConcurrency(Number(e.target.value))}
              className="range range-primary range-sm"
            />
            <div className="flex justify-between text-xs text-base-content/40 px-1">
              <span>1</span>
              <span>4</span>
              <span>8</span>
              <span>12</span>
              <span>16</span>
            </div>
          </div>
        </div>
      </div>

      {/* Theme */}
      <div className="card bg-base-200">
        <div className="card-body p-5 gap-3">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <Palette className="size-4 opacity-50" />
            Theme
          </h3>
          <div className="flex flex-wrap gap-2">
            {THEMES.map((t) => (
              <button
                key={t.value}
                className={`btn btn-sm ${selectedTheme === t.value ? "btn-primary" : "btn-soft"}`}
                onClick={() => setSelectedTheme(t.value)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default WorkersThemeStep;
