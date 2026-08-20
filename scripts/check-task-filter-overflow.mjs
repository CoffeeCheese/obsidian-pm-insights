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

  const rightSplit = app.workspace.rightSplit;
  const originalState = { collapsed: rightSplit.collapsed, size: rightSplit.size };

  rightSplit.expand();
  rightSplit.setSize(Math.min(470, Math.floor(window.innerWidth * 0.35)));
  await new Promise((resolve) => setTimeout(resolve, 500));

  const filterBar = document.querySelector(".pmi-task-filter-bar");
  const reset = filterBar?.querySelector(".pmi-task-filter-reset");
  const detail = filterBar?.closest(".pmi-detail");
  const rightSidebar = document.querySelector(".workspace-split.mod-right-split");

  const rect = (element) => {
    const bounds = element.getBoundingClientRect();
    return { left: bounds.left, right: bounds.right, width: bounds.width };
  };

  const report =
    filterBar instanceof HTMLElement &&
    reset instanceof HTMLElement &&
    detail instanceof HTMLElement &&
    rightSidebar instanceof HTMLElement
      ? {
          setup: true,
          viewportWidth: window.innerWidth,
          rightSidebar: rect(rightSidebar),
          detail: rect(detail),
          filterBar: {
            ...rect(filterBar),
            clientWidth: filterBar.clientWidth,
            scrollWidth: filterBar.scrollWidth
          },
          reset: rect(reset)
        }
      : { setup: false };

  rightSplit.setSize(originalState.size);
  if (originalState.collapsed) rightSplit.collapse();

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
const tolerance = 1;
const narrowScenario =
  report.setup && report.rightSidebar.width > 0 && report.detail.width <= 620 + tolerance;
const resetFits =
  report.setup &&
  report.reset.right <= report.filterBar.right + tolerance &&
  report.reset.right <= report.detail.right + tolerance;
const filterIsContained =
  report.setup &&
  report.filterBar.left >= report.detail.left - tolerance &&
  report.filterBar.right <= report.detail.right + tolerance;
const filterFits = report.setup && report.filterBar.scrollWidth <= report.filterBar.clientWidth + tolerance;

if (!report.setup || !narrowScenario || !resetFits || !filterIsContained || !filterFits) {
  console.error(`Task filter controls overflow the assignee detail panel: ${JSON.stringify(report)}`);
  process.exitCode = 1;
} else {
  console.log(
    `Task filter controls stay within the ${report.filterBar.width}px filter bar with a ${report.rightSidebar.width}px right sidebar.`
  );
}
