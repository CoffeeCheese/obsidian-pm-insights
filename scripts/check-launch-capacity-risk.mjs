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
  const date = (offset) => {
    const value = new Date();
    value.setHours(12, 0, 0, 0);
    value.setDate(value.getDate() + offset);
    return [
      value.getFullYear(),
      String(value.getMonth() + 1).padStart(2, "0"),
      String(value.getDate()).padStart(2, "0")
    ].join("-");
  };

  const plugin = app.plugins.plugins["project-manager-insights"];
  if (!plugin) return JSON.stringify({ setup: false, reason: "plugin unavailable" });
  const insightsLeaf = app.workspace.getLeavesOfType("project-manager-insights-view")[0];
  if (insightsLeaf && insightsLeaf.view?.host !== plugin) {
    await insightsLeaf.setViewState({ type: "empty" });
    await insightsLeaf.setViewState({ type: "project-manager-insights-view", active: true });
    await app.workspace.revealLeaf(insightsLeaf);
  }
  const originalProjectIds = [...plugin.settings.selectedProjectIds];
  const originalSchedules = structuredClone(plugin.settings.gateSchedules ?? {});
  const originalDelays = structuredClone(plugin.settings.gateDelays ?? {});
  const originalActuals = structuredClone(plugin.settings.gateActuals ?? {});
  const originalGateRisk = structuredClone(plugin.settings.gateRisk);
  let report;
  try {
    for (const modal of document.querySelectorAll(".pmi-gate-risk-modal")) {
      modal.closest(".modal-container")
        ?.querySelector(".modal-close-button, .modal-header-button")?.click();
    }
    const snapshot = await plugin.readProjectManager();
    const parentIds = new Set(snapshot.tasks.map((task) => task.parentId).filter(Boolean));
    const project = snapshot.projects.find((candidate) =>
      snapshot.tasks.some((task) =>
        task.projectId === candidate.id &&
        task.hierarchy !== "root" &&
        !parentIds.has(task.id) &&
        !task.completed &&
        !task.archived &&
        task.assignees.length > 0 &&
        task.estimate > task.logged
      )
    );
    if (!project) return JSON.stringify({ setup: false, reason: "estimated open task unavailable" });

    plugin.settings.selectedProjectIds = [project.id];
    plugin.settings.gateRisk.calendarDayHours = 0.25;
    const stageGates = Object.fromEntries(
      plugin.settings.deliveryProgress.stages.map((stage) => [stage.id, date(1)])
    );
    plugin.settings.gateSchedules[project.id] = {
      startDate: date(0),
      stageGates,
      acceptanceGate: date(1),
      launchDate: date(1),
      includeWeekends: true
    };
    delete plugin.settings.gateDelays[project.id];
    delete plugin.settings.gateActuals[project.id];
    await plugin.saveSettings();
    await plugin.refreshInsights();

    const summary = await waitFor(() => document.querySelector(".pmi-gate-risk-summary.is-high"));
    if (!(summary instanceof HTMLButtonElement)) {
      const renderedSummary = document.querySelector(".pmi-gate-risk-summary");
      return JSON.stringify({
        setup: false,
        reason: "high-risk summary unavailable",
        summaryClass: renderedSummary?.className ?? null,
        summaryText: renderedSummary?.textContent ?? null
      });
    }
    activeWindow = document.defaultView;
    activeDocument = document;
    summary.click();
    const capacity = await waitFor(() => [
      ...document.querySelectorAll('[data-gate-id="launch"] .pmi-risk-capacity.is-high')
    ].at(-1) ?? null);
    const metrics = capacity?.querySelectorAll(".pmi-risk-capacity-metric") ?? [];
    const lanes = capacity?.querySelector(".pmi-risk-capacity-lanes");
    const ownerLane = capacity?.querySelector(".pmi-risk-capacity-lane");
    const launchGate = capacity?.closest('[data-gate-id="launch"]');
    const riskModal = capacity?.closest(".pmi-gate-risk-modal");
    let narrowCapacityContained = false;
    if (capacity instanceof HTMLElement && riskModal instanceof HTMLElement) {
      const originalWidth = riskModal.style.width;
      riskModal.style.width = "360px";
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      narrowCapacityContained = capacity.scrollWidth <= capacity.clientWidth + 1;
      riskModal.style.width = originalWidth;
    }

    plugin.openSettings();
    const settingsInputs = await waitFor(() => {
      const settingsDocument = app.setting?.win?.document ?? document;
      const inputs = settingsDocument.querySelectorAll(".pmi-gate-hours-input");
      return inputs.length === 2 ? [...inputs] : null;
    });
    report = {
      setup: true,
      summaryEscalated: summary.classList.contains("is-high"),
      launchEscalated: launchGate?.classList.contains("is-high") ?? false,
      capacityVisible: capacity instanceof HTMLElement,
      capacityMetricsComplete: metrics.length === 4,
      bottleneckVisible: Boolean(capacity?.querySelector('[data-capacity-metric="owner"]')),
      shortfallVisible: Boolean(capacity?.querySelector('[data-capacity-metric="gap"]')),
      ownerLanesVisible: lanes instanceof HTMLElement,
      ownerLaneAccessible: Boolean(ownerLane?.getAttribute("aria-label")?.trim()),
      narrowCapacityContained,
      settingsAvailable: Boolean(settingsInputs),
      settingsConstrained: Boolean(settingsInputs?.every((input) =>
        input instanceof HTMLInputElement &&
        input.type === "number" &&
        input.min === "0.25" &&
        input.max === "24"
      ))
    };
  } finally {
    for (const modal of document.querySelectorAll(".pmi-gate-risk-modal")) {
      modal.closest(".modal-container")
        ?.querySelector(".modal-close-button, .modal-header-button")?.click();
    }
    if (app.setting?.close) app.setting.close();
    plugin.settings.selectedProjectIds = originalProjectIds;
    plugin.settings.gateSchedules = originalSchedules;
    plugin.settings.gateDelays = originalDelays;
    plugin.settings.gateActuals = originalActuals;
    plugin.settings.gateRisk = originalGateRisk;
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
  !report.summaryEscalated ||
  !report.launchEscalated ||
  !report.capacityVisible ||
  !report.capacityMetricsComplete ||
  !report.bottleneckVisible ||
  !report.shortfallVisible ||
  !report.ownerLanesVisible ||
  !report.ownerLaneAccessible ||
  !report.narrowCapacityContained ||
  !report.settingsAvailable ||
  !report.settingsConstrained
) {
  console.error(`Launch capacity risk failed: ${JSON.stringify(report)}`);
  process.exitCode = 1;
} else {
  console.log("Owner bottleneck capacity escalates risk and exposes accessible per-person settings.");
}
