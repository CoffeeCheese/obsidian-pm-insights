import { spawnSync } from "node:child_process";

const vault = process.argv[2] ?? "Obsd";
const openResult = spawnSync(
  "obsidian",
  [`vault=${vault}`, "command", "id=project-manager-insights:open-assignee-workload-insights"],
  { encoding: "utf8" }
);
if (openResult.error) throw openResult.error;

const evaluation = `(async () => {
  for (let attempt = 0; attempt < 30 && !document.querySelector(".pmi-delivery-progress-quality-action"); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  let modal = document.querySelector(".pmi-delivery-issues-modal");
  const modalWasOpen = modal instanceof HTMLElement;
  if (!modalWasOpen) {
    document.querySelector(".pmi-delivery-progress-quality-action")?.click();
    for (let attempt = 0; attempt < 20 && !document.querySelector(".pmi-delivery-issues-modal"); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    modal = document.querySelector(".pmi-delivery-issues-modal");
  }

  if (!(modal instanceof HTMLElement)) return JSON.stringify({ setup: false });
  const filters = modal.querySelector(".pmi-issue-filters");
  const allFilter = filters?.querySelector(".pmi-issue-filter");
  const groups = modal.querySelector(".pmi-issue-groups");
  if (!(filters instanceof HTMLElement) || !(allFilter instanceof HTMLElement) || !(groups instanceof HTMLElement)) {
    if (!modalWasOpen) modal.querySelector(".modal-header-button")?.click();
    return JSON.stringify({ setup: false });
  }

  const filtersRect = filters.getBoundingClientRect();
  const buttonRect = allFilter.getBoundingClientRect();
  const groupsRect = groups.getBoundingClientRect();
  const overlap = Math.max(0, Math.min(buttonRect.bottom, groupsRect.bottom) - Math.max(buttonRect.top, groupsRect.top));
  const hitY = Math.max(buttonRect.top, groupsRect.top) + Math.min(2, overlap / 2);
  const hitTarget = overlap > 0
    ? document.elementFromPoint(buttonRect.left + buttonRect.width / 2, hitY)
    : allFilter;
  const report = {
    setup: true,
    issueCount: modal.querySelectorAll(".pmi-issue-row").length,
    filterFits: filters.scrollHeight <= filters.clientHeight + 1,
    buttonContained: buttonRect.bottom <= filtersRect.bottom + 1,
    groupsSeparated: overlap <= 1,
    overlap: Math.round(overlap * 100) / 100,
    filterReceivesPointer: hitTarget === allFilter || allFilter.contains(hitTarget)
  };

  if (!modalWasOpen) modal.querySelector(".modal-header-button")?.click();
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
  report.issueCount < 1 ||
  !report.filterFits ||
  !report.buttonContained ||
  !report.groupsSeparated ||
  !report.filterReceivesPointer
) {
  console.error(`Delivery issue filters are occluded by the issue list: ${JSON.stringify(report)}`);
  process.exitCode = 1;
} else {
  console.log(`Delivery issue filters stay above the issue list with ${report.issueCount} rendered rows.`);
}
