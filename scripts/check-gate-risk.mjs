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
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return year + "-" + month + "-" + day;
  };

  const plugin = app.plugins.plugins["project-manager-insights"];
  if (!plugin) return JSON.stringify({ setup: false, reason: "plugin unavailable" });
  for (const modal of [...document.querySelectorAll(".pmi-gate-risk-modal")]) {
    modal.querySelector(".modal-close-button, .modal-header-button")?.click();
  }
  const insightsLeaf = app.workspace.getLeavesOfType("project-manager-insights-view")[0];
  if (insightsLeaf && insightsLeaf.view?.host !== plugin) {
    await insightsLeaf.setViewState({ type: "empty" });
    await insightsLeaf.setViewState({ type: "project-manager-insights-view", active: true });
    await app.workspace.revealLeaf(insightsLeaf);
  }
  const originalProjectIds = [...plugin.settings.selectedProjectIds];
  const originalSchedules = structuredClone(plugin.settings.gateSchedules ?? {});
  const originalDueDateChecks = plugin.settings.gateRisk.checkTaskDueDates;
  const snapshot = await plugin.readProjectManager();
  const project = snapshot.projects.find((candidate) =>
    snapshot.tasks.some((task) =>
      task.projectId === candidate.id && task.hierarchy === "root" && !task.completed
    )
  ) ?? snapshot.projects.find((candidate) => originalProjectIds.includes(candidate.id))
    ?? snapshot.projects[0];
  if (!project) return JSON.stringify({ setup: false, reason: "project unavailable" });

  let report;
  try {
    plugin.settings.selectedProjectIds = [project.id];
    plugin.settings.gateRisk.checkTaskDueDates = true;
    const stageGates = Object.fromEntries(
      plugin.settings.deliveryProgress.stages.map((stage, index, stages) => [
        stage.id,
        date(index - stages.length)
      ])
    );
    plugin.settings.gateSchedules[project.id] = {
      startDate: date(-10),
      stageGates,
      acceptanceGate: date(0),
      launchDate: date(2)
    };
    await plugin.saveSettings();
    await plugin.refreshInsights();

    const summary = await waitFor(() => document.querySelector(".pmi-gate-risk-summary"));
    const scopeToken = document.querySelector('.pmi-project-scope-token[data-project-id="' + CSS.escape(project.id) + '"]');
    const gateButton = scopeToken?.querySelector(".pmi-project-scope-gates");
    if (!(summary instanceof HTMLButtonElement) || !(gateButton instanceof HTMLButtonElement)) {
      return JSON.stringify({ setup: false, reason: "gate controls unavailable" });
    }
    const summaryRect = summary.getBoundingClientRect();
    const picker = document.querySelector(".pmi-project-picker");
    if (picker instanceof HTMLDetailsElement) picker.open = false;
    const originalRootWidth = document.querySelector(".pmi-root")?.style.width ?? "";
    const page = document.querySelector(".pmi-root");
    if (page instanceof HTMLElement) page.style.width = "420px";
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const pageRect = page?.getBoundingClientRect();
    const narrowSummaryRect = summary.getBoundingClientRect();
    const narrowContained = Boolean(
      pageRect &&
      narrowSummaryRect.left >= pageRect.left &&
      narrowSummaryRect.right <= pageRect.right + 1
    );
    if (page instanceof HTMLElement) page.style.width = originalRootWidth;

    activeWindow = document.defaultView;
    activeDocument = document;
    summary.click();
    const riskModal = await waitFor(() => document.querySelector(".pmi-gate-risk-modal"));
    const dueDateRule = riskModal?.querySelector(".pmi-risk-rule");
    const dueDateToggle = dueDateRule?.querySelector(".pmi-risk-rule-toggle");
    const dueDateRuleAccessible = Boolean(
      dueDateToggle?.getAttribute("aria-label")?.trim()
    );
    dueDateToggle?.click();
    const disabledDueDateRule = await waitFor(() => {
      const current = document.querySelector(".pmi-gate-risk-modal .pmi-risk-rule.is-disabled");
      return plugin.settings.gateRisk.checkTaskDueDates === false ? current : null;
    });
    const dueDateRuleUpdates = Boolean(disabledDueDateRule);
    const disabledScheduleSignals = [
      ...document.querySelectorAll(
        '.pmi-gate-risk-modal [data-risk-kind="missing-due"], ' +
        '.pmi-gate-risk-modal [data-risk-kind="task-overdue"], ' +
        '.pmi-gate-risk-modal [data-risk-kind="task-after-gate"]'
      )
    ];
    const disabledQualityMentionsDueDate = [
      ...document.querySelectorAll(".pmi-gate-risk-modal .pmi-risk-quality")
    ].some((item) => (item.textContent ?? "").includes("未设截止日") ||
      (item.textContent ?? "").toLowerCase().includes("without due dates"));
    const dueDateSignalsSuppressed = disabledScheduleSignals.length === 0 &&
      !disabledQualityMentionsDueDate;
    disabledDueDateRule?.querySelector(".pmi-risk-rule-toggle")?.click();
    await waitFor(() => plugin.settings.gateRisk.checkTaskDueDates === true);
    const projectTab = riskModal?.querySelector('.pmi-risk-project-tab[aria-selected="true"]');
    const projectTabs = [...(riskModal?.querySelectorAll('.pmi-risk-project-tab[role="tab"]') ?? [])];
    const activePanel = riskModal?.querySelector('[role="tabpanel"]');
    const gates = [...(riskModal?.querySelectorAll(".pmi-risk-gate") ?? [])];
    const passedGates = gates.filter((gate) => gate.classList.contains("is-passed"));
    const passedGatesAvoidOverdueLabel = passedGates.length > 0 && passedGates.every((gate) => {
      const summaryText = gate.querySelector("summary")?.textContent ?? "";
      return !summaryText.includes("已逾期") && !summaryText.toLowerCase().includes("overdue");
    });
    const skippedGates = gates.filter((gate) => gate.classList.contains("is-skipped"));
    const skippedGatesUseSkipLanguage = skippedGates.length > 0 && skippedGates.every((gate) => {
      const summaryText = gate.querySelector("summary")?.textContent ?? "";
      const hasSkipLabel = summaryText.includes("已跳过") || summaryText.toLowerCase().includes("skipped");
      const hasCompletionTiming = ["提前通过", "按时通过", "逾期通过", "无法判断通过时间"]
        .some((label) => summaryText.includes(label));
      return hasSkipLabel && !hasCompletionTiming;
    });
    const nearestHighlighted = Boolean(
      riskModal?.querySelector(".pmi-risk-gate.is-nearest .pmi-risk-nearest")
    );
    const taskRows = [...(riskModal?.querySelectorAll(".pmi-risk-task") ?? [])]
      .filter((row) => row.getClientRects().length > 0);
    const taskEvidenceClearances = taskRows.map((row) => {
      const evidence = row.querySelector(".pmi-risk-task-evidence");
      if (!(evidence instanceof HTMLElement)) return -1;
      return row.getBoundingClientRect().bottom - evidence.getBoundingClientRect().bottom;
    });
    const taskEvidenceClearOfDivider = taskEvidenceClearances.length > 0 &&
      taskEvidenceClearances.every((clearance) => clearance >= 6);
    const launchGate = riskModal?.querySelector('[data-gate-id="launch"]');
    const launchUsesProjectSummary = Boolean(
      launchGate?.querySelector(".pmi-risk-launch-overview") &&
      launchGate.querySelectorAll(".pmi-risk-launch-stat").length === 4 &&
      !launchGate.querySelector(".pmi-risk-task-group")
    );
    const taskButton = riskModal?.querySelector(".pmi-risk-task");
    let taskReturnVerified = false;
    if (taskButton instanceof HTMLButtonElement) {
      const riskContainer = riskModal.closest(".modal-container");
      const originalContainers = new Set(document.querySelectorAll(".modal-container"));
      const originalDetachedHosts = new Set(document.querySelectorAll(".pmi-detached-project-host"));
      taskButton.click();
      const detachedHost = await waitFor(() => [...document.querySelectorAll(".pmi-detached-project-host")].find(
        (candidate) => !originalDetachedHosts.has(candidate)
      ));
      const taskModal = await waitFor(() => [...document.querySelectorAll(".modal-container")].find(
        (candidate) => candidate !== riskContainer && !originalContainers.has(candidate)
      ));
      taskModal?.querySelector(".modal-close-button, .modal-header-button")?.click();
      if (taskModal) await waitFor(() => !taskModal.isConnected);
      if (detachedHost) await waitFor(() => !detachedHost.isConnected);
      taskReturnVerified = Boolean(
        taskModal &&
        detachedHost &&
        riskModal.isConnected &&
        riskModal.querySelector(".pmi-risk-task") &&
        [...document.querySelectorAll(".modal-container")].at(-1) === riskContainer
      );
    }
    riskModal?.querySelector(".modal-close-button, .modal-header-button")?.click();

    activeWindow = document.defaultView;
    activeDocument = document;
    gateButton.click();
    const editor = await waitFor(() => document.querySelector(".pmi-project-gates-modal"));
    const dateInputs = [...(editor?.querySelectorAll('input[type="date"]') ?? [])];
    const saveButton = [...(editor?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent?.includes("保存门禁") || button.textContent?.includes("Save gates")
    );
    editor?.querySelector(".modal-close-button, .modal-header-button")?.click();

    report = {
      setup: true,
      gateButtonAccessible: Boolean(gateButton.getAttribute("aria-label")?.trim()),
      gateButtonConfigured: gateButton.classList.contains("is-configured"),
      compactSummary: summaryRect.height <= 70,
      summaryAccessible: Boolean(summary.getAttribute("aria-label")?.trim()),
      narrowContained,
      riskModalAvailable: riskModal instanceof HTMLElement,
      dueDateRuleAvailable: dueDateRule instanceof HTMLElement,
      dueDateRuleAccessible,
      dueDateRuleUpdates,
      dueDateSignalsSuppressed,
      activeProjectPreserved: projectTab?.textContent?.includes(project.title) === true,
      projectTabsAccessible: projectTabs.filter((tab) => tab.tabIndex === 0).length === 1 &&
        projectTabs.every((tab) => tab.getAttribute("aria-controls") === activePanel?.id) &&
        activePanel?.getAttribute("aria-labelledby") === projectTab?.id,
      gateCountMatches: gates.length === plugin.settings.deliveryProgress.stages.length + 2,
      hasStateLabels: gates.every((gate) => Boolean(gate.querySelector(".pmi-risk-state")?.textContent?.trim())),
      passedGatesAvoidOverdueLabel,
      skippedGatesUseSkipLanguage,
      nearestHighlighted,
      taskEvidenceClearOfDivider,
      visibleTaskRows: taskRows.length,
      minimumTaskEvidenceClearance: Math.min(...taskEvidenceClearances),
      launchUsesProjectSummary,
      taskReturnVerified,
      editorAvailable: editor instanceof HTMLElement,
      dateFieldCountMatches: dateInputs.length === plugin.settings.deliveryProgress.stages.length + 3,
      validScheduleSavable: saveButton instanceof HTMLButtonElement && !saveButton.disabled
    };
  } finally {
    for (const modal of [...document.querySelectorAll(".pmi-gate-risk-modal, .pmi-project-gates-modal")]) {
      modal.querySelector(".modal-close-button, .modal-header-button")?.click();
    }
    plugin.settings.selectedProjectIds = originalProjectIds;
    plugin.settings.gateSchedules = originalSchedules;
    plugin.settings.gateRisk.checkTaskDueDates = originalDueDateChecks;
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
  !report.gateButtonAccessible ||
  !report.gateButtonConfigured ||
  !report.compactSummary ||
  !report.summaryAccessible ||
  !report.narrowContained ||
  !report.riskModalAvailable ||
  !report.dueDateRuleAvailable ||
  !report.dueDateRuleAccessible ||
  !report.dueDateRuleUpdates ||
  !report.dueDateSignalsSuppressed ||
  !report.activeProjectPreserved ||
  !report.projectTabsAccessible ||
  !report.gateCountMatches ||
  !report.hasStateLabels ||
  !report.passedGatesAvoidOverdueLabel ||
  !report.skippedGatesUseSkipLanguage ||
  !report.nearestHighlighted ||
  !report.taskEvidenceClearOfDivider ||
  !report.launchUsesProjectSummary ||
  !report.taskReturnVerified ||
  !report.editorAvailable ||
  !report.dateFieldCountMatches ||
  !report.validScheduleSavable
) {
  console.error(`Gate risk interaction failed: ${JSON.stringify(report)}`);
  process.exitCode = 1;
} else {
  console.log("Gate schedules, compact risk summary, drill-down, and task return passed.");
}
