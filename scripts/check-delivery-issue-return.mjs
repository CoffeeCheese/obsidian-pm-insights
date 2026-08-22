import { spawnSync } from "node:child_process";

const vault = process.argv[2] ?? "Obsd";
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
  const snapshot = await plugin.readProjectManager();
  let report;
  try {
    plugin.settings.selectedProjectIds = snapshot.projects.map((project) => project.id);
    await plugin.saveSettings();
    await plugin.refreshInsights();

    const qualityButton = await waitFor(() =>
      document.querySelector(".pmi-delivery-progress-quality")
    );
    if (!(qualityButton instanceof HTMLButtonElement)) {
      return JSON.stringify({ setup: false, reason: "delivery issue trigger unavailable" });
    }

    const originalModals = new Set(document.querySelectorAll(".modal-container"));
    const originalDetachedHosts = new Set(document.querySelectorAll(".pmi-detached-project-host"));
    const originalNotices = new Set(document.querySelectorAll(".notice"));
    const navigableTaskIds = new Set(
      [...document.querySelectorAll(".pmi-task-open")].map((button) => button.dataset.taskId)
    );
    activeWindow = document.defaultView;
    activeDocument = document;
    qualityButton.click();
  const issueModal = await waitFor(() =>
    [...document.querySelectorAll(".pmi-delivery-issues-modal")].find(
      (modal) => !originalModals.has(modal.closest(".modal-container"))
    )
  );
  const issueModalContainer = issueModal?.closest(".modal-container");
  const activeFilter = issueModal?.querySelector(".pmi-issue-filter.is-active")?.textContent ?? "";
  const issueRow = [...(issueModal?.querySelectorAll(".pmi-issue-row") ?? [])].find(
    (row) => navigableTaskIds.has(row.dataset.taskId)
  ) ?? issueModal?.querySelector(".pmi-issue-row");
  if (!(issueModal instanceof HTMLElement) ||
      !(issueModalContainer instanceof HTMLElement) ||
      !(issueRow instanceof HTMLButtonElement)) {
    return JSON.stringify({ setup: false, reason: "delivery issue modal unavailable" });
  }

  const selectedTaskId = issueRow.dataset.taskId ?? "";
  issueRow.click();
  const detachedHost = await waitFor(() =>
    [...document.querySelectorAll(".pmi-detached-project-host")].find(
      (host) => !originalDetachedHosts.has(host)
    )
  );
  const taskModal = await waitFor(() =>
    [...document.querySelectorAll(".modal-container")].find(
      (modal) => modal !== issueModalContainer && !originalModals.has(modal)
    )
  );
  if (!(taskModal instanceof HTMLElement)) {
    issueModal.querySelector(".modal-close-button, .modal-header-button")?.click();
    return JSON.stringify({
      setup: false,
      reason: "native task editor unavailable",
      selectedTaskId
    });
  }

  await new Promise((resolve) => setTimeout(resolve, 100));
  taskModal.querySelector(".modal-close-button, .modal-header-button")?.click();
  await waitFor(() => !taskModal.isConnected);
  await waitFor(() =>
    [...document.querySelectorAll(".pmi-detached-project-host")].every(
      (host) => originalDetachedHosts.has(host)
    )
  );

  const issueModalReturned = issueModal.isConnected;
  const issueListUsable = Boolean(issueModal.querySelector(".pmi-issue-row"));
  const activeFilterPreserved =
    issueModal.querySelector(".pmi-issue-filter.is-active")?.textContent === activeFilter;
  const issueModalIsTop = [...document.querySelectorAll(".modal-container")].at(-1) ===
    issueModalContainer;
  const detachedHostCleaned = !detachedHost?.isConnected;
  const taskFailureNotice = [...document.querySelectorAll(".notice")].some(
    (notice) =>
      !originalNotices.has(notice) &&
      (notice.textContent?.includes("无法在 Project Manager 中打开此任务") ||
        notice.textContent?.includes("Could not open this task in Project Manager"))
  );
  if (issueModalReturned) {
    issueModal.querySelector(".modal-close-button, .modal-header-button")?.click();
  }

    report = {
      setup: true,
      selectedTaskId,
      taskModalClosed: !taskModal.isConnected,
      issueModalReturned,
      issueListUsable,
      activeFilterPreserved,
      issueModalIsTop,
      detachedHostCleaned,
      taskFailureNotice
    };
  } finally {
    plugin.settings.selectedProjectIds = originalProjectIds;
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
  !report.selectedTaskId ||
  !report.taskModalClosed ||
  !report.issueModalReturned ||
  !report.issueListUsable ||
  !report.activeFilterPreserved ||
  !report.issueModalIsTop ||
  !report.detachedHostCleaned ||
  report.taskFailureNotice
) {
  console.error(`Delivery issue return failed: ${JSON.stringify(report)}`);
  process.exit(1);
} else {
  console.log("Closing a task editor returns to the delivery issue modal.");
}
