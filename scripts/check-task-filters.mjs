import { spawnSync } from "node:child_process";

const vault = process.argv[2] ?? "dev-test";
const openResult = spawnSync(
  "obsidian",
  [`vault=${vault}`, "command", "id=project-manager-insights:open-assignee-workload-insights"],
  { encoding: "utf8" }
);
if (openResult.error) throw openResult.error;

const evaluation = `(async () => {
  for (let attempt = 0; attempt < 30 && !document.querySelector(".pmi-task-filter-bar"); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  const filterBar = document.querySelector(".pmi-task-filter-bar");
  const initialOutside = document.querySelector(".pmi-detail-header");
  if (!(filterBar instanceof HTMLElement) || !(initialOutside instanceof HTMLElement)) {
    return JSON.stringify({ setup: false });
  }

  const menus = [...filterBar.querySelectorAll(".pmi-task-filter-menu")];
  const projectMenu = menus[0];
  const statusMenu = menus[1];
  if (!(projectMenu instanceof HTMLDetailsElement) || !(statusMenu instanceof HTMLDetailsElement)) {
    return JSON.stringify({ setup: false });
  }

  const optionReport = (menu) => [...menu.querySelectorAll(".pmi-task-filter-option")].map((row) => ({
    label: row.querySelector(".pmi-task-filter-option-name")?.textContent?.trim() ?? "",
    count: Number(row.querySelector(".pmi-task-filter-option-count")?.textContent ?? 0)
  }));
  const initialProjects = [...new Set([...document.querySelectorAll(".pmi-task-project span:last-child")]
    .map((node) => node.textContent?.trim() ?? ""))].sort();
  const initialStatuses = [...new Set([...document.querySelectorAll(".pmi-task-status")]
    .map((node) => node.textContent?.trim() ?? ""))].sort();
  const projectOptions = optionReport(projectMenu);
  const statusOptions = optionReport(statusMenu);
  const projectOptionsMatchRows = JSON.stringify(projectOptions.map(({ label }) => label).sort()) ===
    JSON.stringify(initialProjects);
  const statusOptionsMatchRows = JSON.stringify(statusOptions.map(({ label }) => label).sort()) ===
    JSON.stringify(initialStatuses);

  const countIntrudingColumnResizers = (menu) => {
    menu.open = true;
    const panel = menu.querySelector(".pmi-task-filter-panel");
    if (!(panel instanceof HTMLElement)) return -1;
    const panelRect = panel.getBoundingClientRect();
    const count = [...document.querySelectorAll(".pmi-task-column-resizer")]
      .filter((resizer) => {
        const rect = resizer.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        if (
          x < panelRect.left ||
          x > panelRect.right ||
          y < panelRect.top ||
          y > panelRect.bottom
        ) return false;
        const topElement = document.elementFromPoint(x, y);
        return topElement === resizer || resizer.contains(topElement);
      }).length;
    menu.open = false;
    return count;
  };
  const projectIntrudingColumnResizers = countIntrudingColumnResizers(projectMenu);
  const statusIntrudingColumnResizers = countIntrudingColumnResizers(statusMenu);

  const statusClear = statusMenu.querySelector(".pmi-task-filter-actions button:last-child");
  statusClear?.click();
  const clearedStatusRows = document.querySelectorAll(".pmi-task-row").length;
  const statusCheckboxes = [...statusMenu.querySelectorAll('input[type="checkbox"]')];
  const chosenStatuses = statusCheckboxes.slice(0, Math.min(2, statusCheckboxes.length));
  for (const checkbox of chosenStatuses) {
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change", { bubbles: true }));
  }
  const expectedStatusRows = statusOptions.slice(0, chosenStatuses.length)
    .reduce((total, option) => total + option.count, 0);
  const visibleStatusRows = document.querySelectorAll(".pmi-task-row").length;

  filterBar.querySelector(".pmi-task-filter-reset")?.click();
  const refreshedBar = document.querySelector(".pmi-task-filter-bar");
  const refreshedProjectMenu = refreshedBar?.querySelector(".pmi-task-filter-menu");
  const projectClear = refreshedProjectMenu?.querySelector(".pmi-task-filter-actions button:last-child");
  projectClear?.click();
  const clearedProjectRows = document.querySelectorAll(".pmi-task-row").length;
  const firstProject = refreshedProjectMenu?.querySelector('input[type="checkbox"]');
  const firstProjectCount = Number(
    firstProject?.closest(".pmi-task-filter-option")?.querySelector(".pmi-task-filter-option-count")?.textContent ?? 0
  );
  if (firstProject instanceof HTMLInputElement) {
    firstProject.checked = true;
    firstProject.dispatchEvent(new Event("change", { bubbles: true }));
  }
  const visibleProjectRows = document.querySelectorAll(".pmi-task-row").length;

  if (!(refreshedProjectMenu instanceof HTMLDetailsElement)) {
    return JSON.stringify({ setup: false });
  }
  const outside = document.querySelector(".pmi-detail-header");
  if (!(outside instanceof HTMLElement)) {
    return JSON.stringify({ setup: false });
  }
  refreshedProjectMenu.open = true;
  outside.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true }));
  const closedOutside = !refreshedProjectMenu.open;
  refreshedProjectMenu.open = true;
  const projectSummary = refreshedProjectMenu.querySelector(":scope > summary");
  const projectCheckbox = refreshedProjectMenu.querySelector('input[type="checkbox"]');
  projectCheckbox?.focus();
  projectCheckbox?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  const closedWithEscape = !refreshedProjectMenu.open;
  const focusReturned = document.activeElement === projectSummary;

  return JSON.stringify({
    setup: true,
    projectOptionsMatchRows,
    statusOptionsMatchRows,
    projectIntrudingColumnResizers,
    statusIntrudingColumnResizers,
    projectOptionCount: projectOptions.length,
    statusOptionCount: statusOptions.length,
    clearedStatusRows,
    expectedStatusRows,
    visibleStatusRows,
    clearedProjectRows,
    firstProjectCount,
    visibleProjectRows,
    closedOutside,
    closedWithEscape,
    focusReturned
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
if (
  !report.setup ||
  !report.projectOptionsMatchRows ||
  !report.statusOptionsMatchRows ||
  report.projectIntrudingColumnResizers !== 0 ||
  report.statusIntrudingColumnResizers !== 0 ||
  report.projectOptionCount < 1 ||
  report.statusOptionCount < 1 ||
  report.clearedStatusRows !== 0 ||
  report.visibleStatusRows !== report.expectedStatusRows ||
  report.clearedProjectRows !== 0 ||
  report.visibleProjectRows !== report.firstProjectCount ||
  !report.closedOutside ||
  !report.closedWithEscape ||
  !report.focusReturned
) {
  console.error(`Task filter interaction failed: ${JSON.stringify(report)}`);
  process.exitCode = 1;
} else {
  console.log(
    `Task filters use ${report.projectOptionCount} current projects and ${report.statusOptionCount} current statuses; both panels stay above column resizers, and multi-select and dismissal passed.`
  );
}
