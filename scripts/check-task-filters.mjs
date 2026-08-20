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
  const priorityMenu = menus[2];
  if (
    !(projectMenu instanceof HTMLDetailsElement) ||
    !(statusMenu instanceof HTMLDetailsElement) ||
    !(priorityMenu instanceof HTMLDetailsElement)
  ) {
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
  const initialPriorities = [...new Set([...document.querySelectorAll(".pmi-task-priority-label")]
    .map((node) => node.textContent?.trim() ?? ""))].sort();
  const projectOptions = optionReport(projectMenu);
  const statusOptions = optionReport(statusMenu);
  const priorityOptions = optionReport(priorityMenu);
  const projectOptionsMatchRows = JSON.stringify(projectOptions.map(({ label }) => label).sort()) ===
    JSON.stringify(initialProjects);
  const statusOptionsMatchRows = JSON.stringify(statusOptions.map(({ label }) => label).sort()) ===
    JSON.stringify(initialStatuses);
  const priorityOptionsMatchRows = JSON.stringify(priorityOptions.map(({ label }) => label).sort()) ===
    JSON.stringify(initialPriorities);

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
  const priorityIntrudingColumnResizers = countIntrudingColumnResizers(priorityMenu);

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
  const refreshedMenus = [...(refreshedBar?.querySelectorAll(".pmi-task-filter-menu") ?? [])];
  const refreshedPriorityMenu = refreshedMenus[2];
  if (!(refreshedPriorityMenu instanceof HTMLDetailsElement)) {
    return JSON.stringify({ setup: false });
  }
  const priorityClear = refreshedPriorityMenu.querySelector(".pmi-task-filter-actions button:last-child");
  priorityClear?.click();
  const clearedPriorityRows = document.querySelectorAll(".pmi-task-row").length;
  const firstPriority = refreshedPriorityMenu.querySelector('input[type="checkbox"]');
  const firstPriorityCount = Number(
    firstPriority?.closest(".pmi-task-filter-option")?.querySelector(".pmi-task-filter-option-count")?.textContent ?? 0
  );
  if (firstPriority instanceof HTMLInputElement) {
    firstPriority.checked = true;
    firstPriority.dispatchEvent(new Event("change", { bubbles: true }));
  }
  const visiblePriorityRows = document.querySelectorAll(".pmi-task-row").length;

  refreshedBar?.querySelector(".pmi-task-filter-reset")?.click();
  const projectBar = document.querySelector(".pmi-task-filter-bar");
  const refreshedProjectMenu = projectBar?.querySelector(".pmi-task-filter-menu");
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

  projectBar?.querySelector(".pmi-task-filter-reset")?.click();
  const priorityRank = new Map(priorityOptions.map(({ label }, index) => [label, index]));
  const prioritySequence = () => [...document.querySelectorAll(".pmi-task-priority-label:not(.is-empty)")]
    .map((node) => priorityRank.get(node.textContent?.trim() ?? "") ?? Number.MAX_SAFE_INTEGER);
  const isOrdered = (values, direction) => values.every((value, index) =>
    index === 0 || (direction === "high-to-low" ? values[index - 1] <= value : values[index - 1] >= value)
  );
  const initialSort = document.querySelector(".pmi-task-sort");
  initialSort?.click();
  const highToLowButton = document.querySelector(".pmi-task-sort");
  const highToLowSorted = isOrdered(prioritySequence(), "high-to-low");
  const highToLowAria = highToLowButton?.closest("[role=columnheader]")?.getAttribute("aria-sort");
  highToLowButton?.click();
  const lowToHighButton = document.querySelector(".pmi-task-sort");
  const lowToHighSorted = isOrdered(prioritySequence(), "low-to-high");
  const lowToHighAria = lowToHighButton?.closest("[role=columnheader]")?.getAttribute("aria-sort");
  lowToHighButton?.click();
  const sortResetAria = document.querySelector(".pmi-task-sort")
    ?.closest("[role=columnheader]")?.getAttribute("aria-sort");

  const dismissalProjectMenu = document.querySelector(".pmi-task-filter-menu");
  if (!(dismissalProjectMenu instanceof HTMLDetailsElement)) {
    return JSON.stringify({ setup: false });
  }
  const outside = document.querySelector(".pmi-detail-header");
  if (!(outside instanceof HTMLElement)) {
    return JSON.stringify({ setup: false });
  }
  dismissalProjectMenu.open = true;
  outside.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true }));
  const closedOutside = !dismissalProjectMenu.open;
  dismissalProjectMenu.open = true;
  const projectSummary = dismissalProjectMenu.querySelector(":scope > summary");
  const projectCheckbox = dismissalProjectMenu.querySelector('input[type="checkbox"]');
  projectCheckbox?.focus();
  projectCheckbox?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  const closedWithEscape = !dismissalProjectMenu.open;
  const focusReturned = document.activeElement === projectSummary;

  return JSON.stringify({
    setup: true,
    projectOptionsMatchRows,
    statusOptionsMatchRows,
    priorityOptionsMatchRows,
    projectIntrudingColumnResizers,
    statusIntrudingColumnResizers,
    priorityIntrudingColumnResizers,
    projectOptionCount: projectOptions.length,
    statusOptionCount: statusOptions.length,
    priorityOptionCount: priorityOptions.length,
    clearedStatusRows,
    expectedStatusRows,
    visibleStatusRows,
    clearedPriorityRows,
    firstPriorityCount,
    visiblePriorityRows,
    clearedProjectRows,
    firstProjectCount,
    visibleProjectRows,
    highToLowSorted,
    highToLowAria,
    lowToHighSorted,
    lowToHighAria,
    sortResetAria,
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
  !report.priorityOptionsMatchRows ||
  report.projectIntrudingColumnResizers !== 0 ||
  report.statusIntrudingColumnResizers !== 0 ||
  report.priorityIntrudingColumnResizers !== 0 ||
  report.projectOptionCount < 1 ||
  report.statusOptionCount < 1 ||
  report.priorityOptionCount < 1 ||
  report.clearedStatusRows !== 0 ||
  report.visibleStatusRows !== report.expectedStatusRows ||
  report.clearedPriorityRows !== 0 ||
  report.visiblePriorityRows !== report.firstPriorityCount ||
  report.clearedProjectRows !== 0 ||
  report.visibleProjectRows !== report.firstProjectCount ||
  !report.highToLowSorted ||
  report.highToLowAria !== "descending" ||
  !report.lowToHighSorted ||
  report.lowToHighAria !== "ascending" ||
  report.sortResetAria !== "none" ||
  !report.closedOutside ||
  !report.closedWithEscape ||
  !report.focusReturned
) {
  console.error(`Task filter interaction failed: ${JSON.stringify(report)}`);
  process.exitCode = 1;
} else {
  console.log(
    `Task filters use ${report.projectOptionCount} projects, ${report.statusOptionCount} statuses, and ${report.priorityOptionCount} priorities; priority sorting, multi-select, layering, and dismissal passed.`
  );
}
