import { spawnSync } from "node:child_process";

const vault = process.argv[2] ?? "dev-test";
const openResult = spawnSync(
  "obsidian",
  [`vault=${vault}`, "command", "id=project-manager-insights:open-assignee-workload-insights"],
  { encoding: "utf8" }
);
if (openResult.error) throw openResult.error;

const evaluation = `(async () => {
  const waitFor = async (read, attempts = 100) => {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const result = read();
      if (result) return result;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return null;
  };
  const plugin = app.plugins.plugins["project-manager-insights"];
  if (!plugin) return JSON.stringify({ setup: false, reason: "plugin unavailable" });
  const originalProjectIds = [...plugin.settings.selectedProjectIds];
  const originalSchedules = structuredClone(plugin.settings.gateSchedules ?? {});
  let report;
  try {
    const snapshot = await plugin.readProjectManager();
    const project = snapshot.projects[0];
    if (!project) return JSON.stringify({ setup: false, reason: "project unavailable" });
    plugin.settings.selectedProjectIds = [project.id];
    delete plugin.settings.gateSchedules[project.id];
    await plugin.saveSettings();
    await plugin.refreshInsights();

    const summary = await waitFor(() => document.querySelector(".pmi-gate-risk-summary"));
    if (!(summary instanceof HTMLButtonElement)) {
      return JSON.stringify({ setup: false, reason: "summary unavailable" });
    }
    activeWindow = document.defaultView;
    activeDocument = document;
    summary.click();
    const modal = await waitFor(() => document.querySelector(".pmi-gate-risk-modal"));
    const emptyState = modal?.querySelector(".pmi-risk-unconfigured");
    const configureButton = emptyState?.querySelector(".pmi-risk-configure");
    if (!(emptyState instanceof HTMLElement) || !(configureButton instanceof HTMLButtonElement)) {
      return JSON.stringify({ setup: false, reason: "unconfigured state unavailable" });
    }
    const emptyRect = emptyState.getBoundingClientRect();
    const buttonRect = configureButton.getBoundingClientRect();
    const textRange = document.createRange();
    textRange.selectNodeContents(configureButton);
    const textRect = textRange.getBoundingClientRect();
    const tolerance = 1;
    const contains = (outer, inner) =>
      inner.left >= outer.left - tolerance &&
      inner.right <= outer.right + tolerance &&
      inner.top >= outer.top - tolerance &&
      inner.bottom <= outer.bottom + tolerance;
    const originalWidth = modal.style.width;
    modal.style.width = "360px";
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const narrowEmptyRect = emptyState.getBoundingClientRect();
    const narrowButtonRect = configureButton.getBoundingClientRect();
    const narrowTextRect = textRange.getBoundingClientRect();
    modal.style.width = originalWidth;
    report = {
      setup: true,
      buttonContainsText: contains(buttonRect, textRect),
      emptyStateContainsButton: contains(emptyRect, buttonRect),
      narrowButtonContainsText: contains(narrowButtonRect, narrowTextRect),
      narrowEmptyStateContainsButton: contains(narrowEmptyRect, narrowButtonRect),
      buttonWidth: buttonRect.width,
      textWidth: textRect.width
    };
  } finally {
    document.querySelector(".pmi-gate-risk-modal")?.closest(".modal-container")
      ?.querySelector(".modal-close-button, .modal-header-button")?.click();
    plugin.settings.selectedProjectIds = originalProjectIds;
    plugin.settings.gateSchedules = originalSchedules;
    await plugin.saveSettings();
    await plugin.refreshInsights();
  }
  return JSON.stringify(report);
})()`;

const result = spawnSync("obsidian", [`vault=${vault}`, "eval", `code=${evaluation}`], {
  encoding: "utf8"
});
if (result.error) throw result.error;

const output = `${result.stdout}${result.stderr}`;
const payload = output.match(/=>\s*(\{.*\})/u)?.[1];
if (!payload) throw new Error(`Could not read Obsidian evaluation result:\n${output}`);

const report = JSON.parse(payload);
if (
  !report.setup ||
  !report.buttonContainsText ||
  !report.emptyStateContainsButton ||
  !report.narrowButtonContainsText ||
  !report.narrowEmptyStateContainsButton
) {
  console.error(`Unconfigured gate layout failed: ${JSON.stringify(report)}`);
  process.exitCode = 1;
} else {
  console.log("Unconfigured gate action stays within its button and empty-state panel.");
}
