import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  getCapabilitiesSnapshot,
  inferCapabilityDomains,
  resolveCapabilities,
} from "../src/agents/capability-resolver.ts";

function writeAgent(workspace: string, name: string, description: string, whenToUse: string): void {
  const agentsDir = join(workspace, ".codex", "agents");
  mkdirSync(agentsDir, { recursive: true });
  writeFileSync(join(agentsDir, `${name}.md`), `---\ndescription: ${description}\nwhen_to_use: ${whenToUse}\n---\n# ${name}\n`, "utf8");
}

function writeSkill(workspace: string, name: string, description: string, whenToUse: string): void {
  const skillDir = join(workspace, ".codex", "skills", name);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), `---\ndescription: ${description}\nwhen_to_use: ${whenToUse}\n---\n# ${name}\n`, "utf8");
}

function writeCommand(workspace: string, name: string, description: string): void {
  const commandsDir = join(workspace, ".codex", "commands");
  mkdirSync(commandsDir, { recursive: true });
  writeFileSync(join(commandsDir, `${name}.md`), `# ${description}\n`, "utf8");
}

describe("capability resolver", () => {
  it("infers frontend/testing domains from issue text and paths", () => {
    const domains = inferCapabilityDomains({
      title: "Fix React button spacing and add a regression test",
      description: "The dashboard UI is broken in the component.",
      paths: ["app/src/components/Button.jsx", "app/src/components/Button.test.jsx"],
    });

    assert.ok(domains.includes("frontend"));
    assert.ok(domains.includes("testing"));
  });

  it("resolves matching installed agents, skills, and commands", () => {
    const workspace = mkdtempSync(join(tmpdir(), "fifony-capabilities-"));
    writeAgent(workspace, "zz-triplewidget-frontend-expert", "Frontend UI specialist for triplewidget dashboards", "Use when React components or triplewidget styling need work");
    writeAgent(workspace, "zz-security-reviewer", "Security reviewer", "Use when auth or permission flows change");
    writeSkill(workspace, "zz-triplewidget-ui-polish", "UI polish workflow for triplewidget layouts", "Use when interface layout or triplewidget spacing needs improvement");
    writeCommand(workspace, "zz-triplewidget-review-ui", "Review triplewidget UI polish and spacing");

    const snapshot = getCapabilitiesSnapshot(workspace);
    assert.ok(snapshot.available.agents >= 2);
    assert.ok(snapshot.available.skills >= 1);
    assert.ok(snapshot.available.commands >= 1);

    const result = resolveCapabilities(workspace, {
      title: "Fix triplewidget dashboard button spacing",
      description: "React UI layout regressed on the triplewidget analytics page.",
      paths: ["app/src/components/TriplewidgetButton.jsx", "app/src/routes/analytics.lazy.jsx"],
    });

    assert.ok(result.detectedDomains.includes("frontend"));
    assert.equal(result.suggestedAgents[0]?.name, "zz-triplewidget-frontend-expert");
    assert.equal(result.suggestedSkills[0]?.name, "zz-triplewidget-ui-polish");
    assert.equal(result.suggestedCommands[0]?.name, "zz-triplewidget-review-ui");
    assert.match(result.suggestedAgents[0]?.why || "", /frontend|keywords/i);
  });
});
