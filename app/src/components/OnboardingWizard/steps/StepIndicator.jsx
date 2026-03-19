import { getStepperLabels } from "../constants";

function StepIndicator({ current, wantsDiscovery }) {
  const labels = getStepperLabels(wantsDiscovery);
  // current is 1-based from the wizard because the welcome screen is hidden from the stepper
  const stepperIndex = current - 1;
  return (
    <ul className="steps steps-horizontal w-full max-w-2xl text-xs">
      {labels.map((label, i) => {
        const done = i < stepperIndex;
        const active = i === stepperIndex;
        return (
          <li
            key={label}
            data-content={done ? "✓" : i + 1}
            className={`step ${done || active ? "step-primary" : ""}`}
            style={{ transition: "color 0.3s ease" }}
          >
            {label}
          </li>
        );
      })}
    </ul>
  );
}

export default StepIndicator;
