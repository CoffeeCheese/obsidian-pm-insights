import { spawnSync } from "node:child_process";

const vault = process.argv[2] ?? "dev-test";
const evaluation = `(async () => {
  const plugin = app.plugins.plugins["project-manager-insights"];
  if (!plugin?.settings?.deliveryProgress) {
    return JSON.stringify({ setup: false, reason: "plugin-settings-unavailable" });
  }

  app.setting.open();
  app.setting.openTabById("project-manager-insights");
  await new Promise((resolve) => setTimeout(resolve, 200));

  const container = app.setting.activeTab?.containerEl;
  const stageSettings = [...(container?.querySelectorAll(".pmi-progress-setting") ?? [])]
    .filter((setting) => setting.querySelector(".pmi-progress-tags-input"));
  const development = stageSettings[1];
  const skipCheckbox = development?.querySelectorAll(
    ".pmi-progress-checkbox input[type=checkbox]"
  )[1];
  if (!(skipCheckbox instanceof HTMLInputElement)) {
    return JSON.stringify({ setup: false, reason: "development-skip-checkbox-unavailable" });
  }

  const original = plugin.settings.deliveryProgress.stages.development.skipWhenEmpty;
  plugin.settings.deliveryProgress.stages.development.skipWhenEmpty = false;
  await plugin.saveSettings();
  await plugin.refreshInsights();

  skipCheckbox.checked = false;
  skipCheckbox.dispatchEvent(new Event("change", { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 100));

  skipCheckbox.checked = true;
  skipCheckbox.dispatchEvent(new Event("change", { bubbles: true }));
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const rowText = document.querySelector(".pmi-progress-row--development")?.innerText ?? "";
    const rowShowsSkipped = rowText.includes("已跳过统计") || rowText.includes("Skipped");
    if (
      plugin.settings.deliveryProgress.stages.development.skipWhenEmpty === true &&
      rowShowsSkipped
    ) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  const savedAfterToggle =
    plugin.settings.deliveryProgress.stages.development.skipWhenEmpty;
  const rowText = document.querySelector(".pmi-progress-row--development")?.innerText ?? "";

  skipCheckbox.checked = original;
  skipCheckbox.dispatchEvent(new Event("change", { bubbles: true }));
  plugin.settings.deliveryProgress.stages.development.skipWhenEmpty = original;
  await plugin.saveSettings();
  await plugin.refreshInsights();

  return JSON.stringify({
    setup: true,
    savedAfterToggle,
    rowShowsSkipped: rowText.includes("已跳过统计") || rowText.includes("Skipped"),
    rowText
  });
})()`;

const result = spawnSync("obsidian", [`vault=${vault}`, "eval", `code=${evaluation}`], {
  encoding: "utf8"
});
if (result.error) throw result.error;

const output = `${result.stdout}${result.stderr}`;
const payload = output.match(/=>\s*(\{.*\})/u)?.[1];
if (!payload) throw new Error(`Could not read Obsidian evaluation result:\n${output}`);

const report = JSON.parse(payload);
if (!report.setup || !report.savedAfterToggle || !report.rowShowsSkipped) {
  console.error(`Progress skip checkbox did not save immediately: ${JSON.stringify(report)}`);
  process.exitCode = 1;
} else {
  console.log("Progress skip checkbox saves immediately and refreshes the dashboard.");
}
