import { useState, useEffect, useCallback, useRef } from "react";
import { Globe } from "lucide-react";
import { DOMAIN_GROUPS } from "../constants";

function DomainsStep({ selectedDomains, setSelectedDomains, analysisResult }) {
  const didPreselect = useRef(false);

  useEffect(() => {
    if (didPreselect.current || !analysisResult?.domains?.length) return;
    if (selectedDomains.length > 0) return;
    didPreselect.current = true;
    setSelectedDomains(analysisResult.domains);
  }, [analysisResult]);

  const toggleDomain = useCallback((value) => {
    setSelectedDomains((prev) =>
      prev.includes(value) ? prev.filter((d) => d !== value) : [...prev, value]
    );
  }, [setSelectedDomains]);

  return (
    <div className="flex flex-col gap-6 stagger-children">
      <div className="text-center">
        <Globe className="size-10 text-primary mx-auto mb-3" />
        <h2 className="text-2xl font-bold">Domains</h2>
        <p className="text-base-content/60 mt-1">Select the domains relevant to your project</p>
      </div>

      {DOMAIN_GROUPS.map((group) => (
        <div key={group.label}>
          <div className="text-xs font-semibold uppercase tracking-wider text-base-content/40 mb-2">
            {group.label}
          </div>
          <div className="flex flex-wrap gap-2">
            {group.domains.map((d) => {
              const isSelected = selectedDomains.includes(d.value);
              return (
                <button
                  key={d.value}
                  className={`btn btn-sm gap-1.5 ${isSelected ? "btn-primary" : "btn-soft"}`}
                  onClick={() => toggleDomain(d.value)}
                >
                  <span>{d.emoji}</span>
                  {d.label}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export default DomainsStep;
