import { spawnSync } from "node:child_process";

const vault = process.argv[2] ?? "dev-test";
const evaluation = `(async () => {
  const plugin = app.plugins.plugins["project-manager-insights"];
  if (!plugin?.settings?.deliveryProgress) {
    return JSON.stringify({ setup: false, reason: "plugin-settings-unavailable" });
  }

  const originalProgress = structuredClone(plugin.settings.deliveryProgress);
  const developmentStage = plugin.settings.deliveryProgress.stages.find(
    (stage) => stage.id === "development"
  ) ?? plugin.settings.deliveryProgress.stages[1];
  if (!developmentStage) {
    return JSON.stringify({ setup: false, reason: "development-stage-unavailable" });
  }
  let report;
  try {
  developmentStage.skipWhenEmpty = false;
  await plugin.saveSettings();
  await plugin.refreshInsights();

  app.setting.close();
  await new Promise((resolve) => setTimeout(resolve, 100));
  app.setting.open();
  app.setting.openTabById("project-manager-insights");
  await new Promise((resolve) => setTimeout(resolve, 500));

  const container = app.setting.activeTab?.containerEl;
  const stageIndex = plugin.settings.deliveryProgress.stages.findIndex(
    (stage) => stage.id === developmentStage.id
  );
  const stageCheckboxes = [...(container?.querySelectorAll(
    ".pmi-progress-checkbox input[type=checkbox]"
  ) ?? [])];
  const skipCheckbox = stageCheckboxes[(stageIndex * 2) + 1];
  if (!(skipCheckbox instanceof HTMLInputElement)) {
    return JSON.stringify({
      setup: false,
      reason: "development-skip-checkbox-unavailable",
      stageIndex,
      checkboxCount: stageCheckboxes.length,
      activeTab: app.setting.activeTab?.id ?? ""
    });
  }

  skipCheckbox.checked = false;
  skipCheckbox.dispatchEvent(new Event("change", { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 100));

  skipCheckbox.checked = true;
  skipCheckbox.dispatchEvent(new Event("change", { bubbles: true }));
  const saveButton = container?.querySelector(".pmi-progress-save button");
  if (!(saveButton instanceof HTMLButtonElement)) {
    return JSON.stringify({ setup: false, reason: "progress-save-unavailable" });
  }
  saveButton.click();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const rowText = document.querySelector(
      '.pmi-progress-row[data-stage-id="' + CSS.escape(developmentStage.id) + '"]'
    )?.innerText ?? "";
    if (
      plugin.settings.deliveryProgress.stages.find((stage) => stage.id === developmentStage.id)
        ?.skipWhenEmpty === true &&
      rowText.trim().length > 0
    ) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  const savedAfterToggle =
    plugin.settings.deliveryProgress.stages.find((stage) => stage.id === developmentStage.id)
      ?.skipWhenEmpty;
  const rowText = document.querySelector(
    '.pmi-progress-row[data-stage-id="' + CSS.escape(developmentStage.id) + '"]'
  )?.innerText ?? "";

  report = {
    setup: true,
    savedAfterToggle,
    dashboardRefreshed: rowText.trim().length > 0,
    rowText
  };
  } finally {
    plugin.settings.deliveryProgress = originalProgress;
    await plugin.saveSettings();
    await plugin.refreshInsights();
    app.setting.close();
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
if (!report.setup || !report.savedAfterToggle || !report.dashboardRefreshed) {
  console.error(`Progress skip checkbox did not save with the stage configuration: ${JSON.stringify(report)}`);
  process.exitCode = 1;
} else {
  console.log("Progress skip checkbox saves with the stage configuration and refreshes the dashboard.");
}
