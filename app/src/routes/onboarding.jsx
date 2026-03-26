import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { lazy, Suspense, useEffect } from "react";
import { useSettings, getSettingsList } from "../hooks";
import { hasCompletedOnboarding } from "../onboarding-state.js";

const OnboardingWizard = lazy(() => import("../components/OnboardingWizard"));

function OnboardingPage() {
  const navigate = useNavigate();
  const settingsQuery = useSettings();
  const completed = hasCompletedOnboarding(getSettingsList(settingsQuery.data));

  useEffect(() => {
    if (completed) {
      navigate({ to: "/kanban", replace: true });
    }
  }, [completed, navigate]);

  if (completed) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <span className="loading loading-spinner loading-lg" />
      </div>
    );
  }

  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <span className="loading loading-spinner loading-lg" />
        </div>
      }
    >
      <OnboardingWizard
        onComplete={() => {
          navigate({ to: "/kanban", replace: true });
        }}
      />
    </Suspense>
  );
}

export const Route = createFileRoute("/onboarding")({
  component: OnboardingPage,
});
