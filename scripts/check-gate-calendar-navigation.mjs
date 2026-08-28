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
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return null;
  };
  const nextMonth = (value) => {
    const [year, month, day] = value.split("-").map(Number);
    const candidate = new Date(year, month, 1, 12);
    const lastDay = new Date(candidate.getFullYear(), candidate.getMonth() + 1, 0, 12).getDate();
    candidate.setDate(Math.min(day, lastDay));
    return [
      candidate.getFullYear(),
      String(candidate.getMonth() + 1).padStart(2, "0"),
      String(candidate.getDate()).padStart(2, "0")
    ].join("-");
  };
  const closeEditor = async () => {
    const editor = document.querySelector(".pmi-project-gates-modal");
    editor?.querySelector(".modal-close-button, .modal-header-button")?.click();
    const discard = await waitFor(() =>
      document.querySelector(".pmi-confirm-action-modal .pmi-confirm-action-confirm")
    , 10);
    discard?.click();
  };

  const plugin = app.plugins.plugins["project-manager-insights"];
  if (!plugin) return JSON.stringify({ setup: false, reason: "plugin unavailable" });
  for (const modal of [...document.querySelectorAll(".pmi-project-gates-modal")]) {
    modal.querySelector(".modal-close-button, .modal-header-button")?.click();
  }
  const staleDiscard = await waitFor(() =>
    document.querySelector(".pmi-confirm-action-modal .pmi-confirm-action-confirm")
  , 10);
  staleDiscard?.click();

  const originalProjectIds = [...plugin.settings.selectedProjectIds];
  const originalSchedules = structuredClone(plugin.settings.gateSchedules ?? {});
  const originalDelays = structuredClone(plugin.settings.gateDelays ?? {});
  let report;
  try {
    const snapshot = await plugin.readProjectManager();
    const project = snapshot.projects.find((candidate) =>
      plugin.settings.gateSchedules[candidate.id] && !plugin.settings.gateDelays[candidate.id]
    ) ?? snapshot.projects[0];
    if (!project) return JSON.stringify({ setup: false, reason: "project unavailable" });

    if (!plugin.settings.gateSchedules[project.id]) {
      const dates = ["2026-01-05", "2026-01-12", "2026-01-19", "2026-01-26"];
      plugin.settings.gateSchedules[project.id] = {
        startDate: dates[0],
        stageGates: Object.fromEntries(
          plugin.settings.deliveryProgress.stages.map((stage, index) => [
            stage.id,
            dates[Math.min(index + 1, dates.length - 2)]
          ])
        ),
        acceptanceGate: dates.at(-2),
        launchDate: dates.at(-1),
        includeWeekends: true
      };
    }
    delete plugin.settings.gateDelays[project.id];
    plugin.settings.selectedProjectIds = [project.id];
    await plugin.saveSettings();
    await plugin.refreshInsights();

    const gateButton = await waitFor(() => document.querySelector(".pmi-project-scope-gates"));
    gateButton?.click();
    const input = await waitFor(() =>
      document.querySelector('.pmi-project-gates-modal input[type="date"]:not(:disabled)')
    );
    if (!(input instanceof HTMLInputElement)) {
      return JSON.stringify({ setup: false, reason: "editable date unavailable" });
    }

    const beforeValue = input.value;
    const provisionalValue = nextMonth(beforeValue);
    input.value = provisionalValue;
    input.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      inputType: "insertReplacementText"
    }));
    const currentInput = document.querySelector(
      '.pmi-project-gates-modal input[type="date"]:not(:disabled)'
    );
    const provisionalInputStayedConnected = input.isConnected && currentInput === input;
    let confirmedValue = null;
    let dateConfirmationCommitted = false;
    if (currentInput instanceof HTMLInputElement) {
      confirmedValue = nextMonth(currentInput.value);
      currentInput.value = confirmedValue;
      currentInput.dispatchEvent(new Event("change", { bubbles: true }));
      const confirmedInput = document.querySelector(
        '.pmi-project-gates-modal input[type="date"]:not(:disabled)'
      );
      dateConfirmationCommitted = !currentInput.isConnected &&
        confirmedInput?.value === confirmedValue;
    }

    report = {
      setup: true,
      beforeValue,
      provisionalValue,
      confirmedValue,
      calendarStayedOpen: provisionalInputStayedConnected,
      provisionalInputDidNotCommit: provisionalInputStayedConnected,
      dateConfirmationCommitted,
      replacementRendered: currentInput !== input,
      replacementValue: currentInput?.value ?? null
    };
  } finally {
    await closeEditor();
    plugin.settings.selectedProjectIds = originalProjectIds;
    plugin.settings.gateSchedules = originalSchedules;
    plugin.settings.gateDelays = originalDelays;
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
  !report.calendarStayedOpen ||
  !report.provisionalInputDidNotCommit ||
  !report.dateConfirmationCommitted
) {
  console.error(`Gate calendar navigation failed: ${JSON.stringify(report)}`);
  process.exitCode = 1;
} else {
  console.log("Gate calendar month navigation stays open until a date is confirmed.");
}
