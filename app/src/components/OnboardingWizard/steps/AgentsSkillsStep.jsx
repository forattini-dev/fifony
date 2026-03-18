import { useState, useEffect, useCallback, useRef } from "react";
import { Bot, Boxes, Loader2, Check } from "lucide-react";
import { api } from "../../../api";

function AgentsSkillsStep({
  selectedDomains, selectedAgents, setSelectedAgents,
  selectedSkills, setSelectedSkills, existingAgents, existingSkills,
}) {
  const [catalogAgents, setCatalogAgents] = useState([]);
  const [catalogSkills, setCatalogSkills] = useState([]);
  const [loading, setLoading] = useState(false);
  const didFetch = useRef(false);

  useEffect(() => {
    if (didFetch.current) return;
    didFetch.current = true;
    setLoading(true);

    const domainQuery = selectedDomains.length > 0 ? `?domains=${selectedDomains.join(",")}` : "";
    Promise.all([
      api.get(`/catalog/agents${domainQuery}`).catch(() => ({ agents: [] })),
      api.get("/catalog/skills").catch(() => ({ skills: [] })),
    ]).then(([agentsData, skillsData]) => {
      const agents = agentsData?.agents || [];
      const skills = skillsData?.skills || [];
      setCatalogAgents(agents);
      setCatalogSkills(skills);

      const existingNames = new Set((existingAgents || []).map((a) => a.name));
      const autoAgents = agents.filter((a) => !existingNames.has(a.name)).map((a) => a.name);
      if (autoAgents.length > 0 && selectedAgents.length === 0) {
        setSelectedAgents(autoAgents);
      }

      const existingSkillNames = new Set((existingSkills || []).map((s) => s.name));
      const autoSkills = skills.filter((s) => !existingSkillNames.has(s.name)).map((s) => s.name);
      if (autoSkills.length > 0 && selectedSkills.length === 0) {
        setSelectedSkills(autoSkills);
      }
    }).finally(() => setLoading(false));
  }, []);

  const existingAgentNames = new Set((existingAgents || []).map((a) => a.name));
  const existingSkillNames = new Set((existingSkills || []).map((s) => s.name));

  const toggleAgent = useCallback((name) => {
    setSelectedAgents((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]
    );
  }, [setSelectedAgents]);

  const toggleSkill = useCallback((name) => {
    setSelectedSkills((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]
    );
  }, [setSelectedSkills]);

  const selectAllAgents = useCallback(() => {
    const names = catalogAgents.filter((a) => !existingAgentNames.has(a.name)).map((a) => a.name);
    setSelectedAgents(names);
  }, [catalogAgents, existingAgentNames, setSelectedAgents]);

  const selectNoneAgents = useCallback(() => setSelectedAgents([]), [setSelectedAgents]);

  const selectAllSkills = useCallback(() => {
    const names = catalogSkills.filter((s) => !existingSkillNames.has(s.name)).map((s) => s.name);
    setSelectedSkills(names);
  }, [catalogSkills, existingSkillNames, setSelectedSkills]);

  const selectNoneSkills = useCallback(() => setSelectedSkills([]), [setSelectedSkills]);

  if (loading) {
    return (
      <div className="flex flex-col items-center gap-3 py-12">
        <Loader2 className="size-8 text-primary animate-spin" />
        <p className="text-sm text-base-content/50">Loading catalog...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 stagger-children">
      <div className="text-center">
        <Bot className="size-10 text-primary mx-auto mb-3" />
        <h2 className="text-2xl font-bold">Agents & Skills</h2>
        <p className="text-base-content/60 mt-1">Choose which agents and skills to install</p>
      </div>

      {catalogAgents.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <Bot className="size-4 opacity-50" />
              Agents ({catalogAgents.length})
            </h3>
            <div className="flex gap-1">
              <button className="btn btn-xs btn-ghost" onClick={selectAllAgents}>Select All</button>
              <button className="btn btn-xs btn-ghost" onClick={selectNoneAgents}>None</button>
            </div>
          </div>
          <div className="grid gap-2">
            {catalogAgents.map((agent) => {
              const installed = existingAgentNames.has(agent.name);
              const isSelected = installed || selectedAgents.includes(agent.name);
              return (
                <button
                  key={agent.name}
                  className={`card bg-base-200 cursor-pointer transition-all text-left ${
                    isSelected ? "ring-2 ring-primary ring-offset-1 ring-offset-base-100" : ""
                  } ${installed ? "opacity-60" : ""}`}
                  onClick={() => !installed && toggleAgent(agent.name)}
                  disabled={installed}
                >
                  <div className="card-body p-3 flex-row items-center gap-3">
                    <div className="text-xl shrink-0">{agent.emoji || "\u{1F916}"}</div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm truncate">
                        {agent.displayName || agent.name}
                      </div>
                      {agent.description && (
                        <p className="text-xs text-base-content/50 truncate">{agent.description}</p>
                      )}
                    </div>
                    {installed ? (
                      <span className="badge badge-sm badge-success gap-1">
                        <Check className="size-3" /> Installed
                      </span>
                    ) : (
                      <input
                        type="checkbox"
                        className="checkbox checkbox-primary checkbox-sm"
                        checked={isSelected}
                        readOnly
                        tabIndex={-1}
                      />
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {catalogSkills.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <Boxes className="size-4 opacity-50" />
              Skills ({catalogSkills.length})
            </h3>
            <div className="flex gap-1">
              <button className="btn btn-xs btn-ghost" onClick={selectAllSkills}>Select All</button>
              <button className="btn btn-xs btn-ghost" onClick={selectNoneSkills}>None</button>
            </div>
          </div>
          <div className="grid gap-2">
            {catalogSkills.map((skill) => {
              const installed = existingSkillNames.has(skill.name);
              const isSelected = installed || selectedSkills.includes(skill.name);
              return (
                <button
                  key={skill.name}
                  className={`card bg-base-200 cursor-pointer transition-all text-left ${
                    isSelected ? "ring-2 ring-primary ring-offset-1 ring-offset-base-100" : ""
                  } ${installed ? "opacity-60" : ""}`}
                  onClick={() => !installed && toggleSkill(skill.name)}
                  disabled={installed}
                >
                  <div className="card-body p-3 flex-row items-center gap-3">
                    <div className="text-xl shrink-0">{skill.emoji || "\u{1F9E9}"}</div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm truncate">
                        {skill.displayName || skill.name}
                      </div>
                      {skill.description && (
                        <p className="text-xs text-base-content/50 truncate">{skill.description}</p>
                      )}
                    </div>
                    {installed ? (
                      <span className="badge badge-sm badge-success gap-1">
                        <Check className="size-3" /> Installed
                      </span>
                    ) : (
                      <input
                        type="checkbox"
                        className="checkbox checkbox-primary checkbox-sm"
                        checked={isSelected}
                        readOnly
                        tabIndex={-1}
                      />
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {catalogAgents.length === 0 && catalogSkills.length === 0 && (
        <div className="alert alert-info text-sm">
          No agents or skills found in the catalog. You can add them later from the settings page.
        </div>
      )}
    </div>
  );
}

export default AgentsSkillsStep;
