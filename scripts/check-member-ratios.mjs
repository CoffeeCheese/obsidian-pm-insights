import { spawnSync } from "node:child_process";

const vault = process.argv[2] ?? "dev-test";
const openResult = spawnSync(
  "obsidian",
  [`vault=${vault}`, "command", "id=project-manager-insights:open-assignee-workload-insights"],
  { encoding: "utf8" }
);
if (openResult.error) throw openResult.error;

const evaluation = `(async () => {
  const leftSplit = app.workspace.leftSplit;
  const leftSidebarWasCollapsed = Boolean(leftSplit?.collapsed);
  if (leftSidebarWasCollapsed) {
    leftSplit.expand();
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  for (let attempt = 0; attempt < 30 && !document.querySelector(".pmi-member-dashboard-toggle"); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  const toggle = document.querySelector(".pmi-member-dashboard-toggle");
  if (!(toggle instanceof HTMLButtonElement)) {
    if (leftSidebarWasCollapsed) leftSplit.collapse();
    return JSON.stringify({ setup: false });
  }
  const initiallyCollapsed = toggle.getAttribute("aria-expanded") === "false";
  const detailBefore = document.querySelector(".pmi-detail")?.getBoundingClientRect();
  const filterBefore = document.querySelector(".pmi-task-filter-bar")?.getBoundingClientRect();
  toggle.click();
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  const expandedToggle = document.querySelector(".pmi-member-dashboard-toggle");
  const drawer = document.querySelector(".pmi-member-dashboard-modal");
  const ledger = document.querySelector(".pmi-member-ratios");
  const dashboard = document.querySelector(".pmi-member-dashboard");
  const drawerContent = drawer?.querySelector(".pmi-member-dashboard-drawer-content");
  const runway = document.querySelector(".pmi-member-runway");
  const detail = document.querySelector(".pmi-detail");
  const filterBar = document.querySelector(".pmi-task-filter-bar");
  if (
    !(drawer instanceof HTMLElement) ||
    !(ledger instanceof HTMLElement) ||
    !(dashboard instanceof HTMLElement) ||
    !(drawerContent instanceof HTMLElement) ||
    !(runway instanceof HTMLElement) ||
    !(detail instanceof HTMLElement) ||
    !(filterBar instanceof HTMLElement) ||
    !(expandedToggle instanceof HTMLButtonElement) ||
    !detailBefore ||
    !filterBefore
  ) {
    if (leftSidebarWasCollapsed) leftSplit.collapse();
    return JSON.stringify({ setup: false });
  }

  const ledgerRect = ledger.getBoundingClientRect();
  const dashboardRect = dashboard.getBoundingClientRect();
  const drawerRect = drawer.getBoundingClientRect();
  const runwayRect = runway.getBoundingClientRect();
  const detailRect = detail.getBoundingClientRect();
  const filterRect = filterBar.getBoundingClientRect();
  const groups = [...ledger.querySelectorAll(".pmi-ratio-group")];
  const metrics = [...ledger.querySelectorAll(".pmi-ratio-metric")].map((metric) => {
    const rect = metric.getBoundingClientRect();
    return {
      label: metric.querySelector(".pmi-ratio-name")?.textContent?.trim() ?? "",
      percentage: metric.querySelector("strong")?.textContent?.trim() ?? "",
      title: metric.getAttribute("title") ?? "",
      ariaLabel: metric.getAttribute("aria-label") ?? "",
      labelFits:
        metric.querySelector(".pmi-ratio-name")?.scrollWidth <=
        metric.querySelector(".pmi-ratio-name")?.clientWidth,
      contained: rect.left >= ledgerRect.left - 1 && rect.right <= ledgerRect.right + 1
    };
  });

  const originalWidth = drawer.style.width;
  const originalMaxWidth = drawer.style.maxWidth;
  drawer.style.width = "580px";
  drawer.style.maxWidth = "580px";
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const narrowLedgerRect = ledger.getBoundingClientRect();
  const narrowState = {
    stacked: [...ledger.querySelectorAll(".pmi-ratio-group")].every(
      (group, index, groups) => index === 0 || group.getBoundingClientRect().top >= groups[index - 1].getBoundingClientRect().bottom - 1
    ),
    containedByDrawer:
      narrowLedgerRect.left >= drawer.getBoundingClientRect().left - 1 &&
      narrowLedgerRect.right <= drawer.getBoundingClientRect().right + 1,
    drawerHasNoHorizontalOverflow: drawer.scrollWidth <= drawer.clientWidth + 1,
    labelsFit: [...ledger.querySelectorAll(".pmi-ratio-name")].every(
      (label) => label.scrollWidth <= label.clientWidth
    )
  };
  drawer.style.width = originalWidth;
  drawer.style.maxWidth = originalMaxWidth;
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  const report = {
    setup: true,
    initiallyCollapsed,
    expanded: expandedToggle.getAttribute("aria-expanded") === "true",
    leftSidebarExpanded: !leftSplit.collapsed,
    groupCount: groups.length,
    metricCount: metrics.length,
    metrics,
    compactHeight: Math.round(ledgerRect.height * 100) / 100,
    insideDrawer:
      drawer.contains(dashboard) &&
      dashboard.contains(ledger) &&
      ledgerRect.top >= dashboardRect.top - 1 &&
      ledgerRect.bottom <= dashboardRect.bottom + 1,
    detachedFromDetail: !detail.contains(dashboard),
    drawerAnchoredRight: window.innerWidth - drawerRect.right <= 16,
    drawerHasPlainSurface: getComputedStyle(drawerContent).backgroundImage === "none",
    runwayIsInset:
      runwayRect.left >= drawerRect.left + 12 && runwayRect.right <= drawerRect.right - 12,
    drawerHasNoHorizontalOverflow: drawer.scrollWidth <= drawer.clientWidth + 1,
    detailHasNoHorizontalOverflow: detail.scrollWidth <= detail.clientWidth + 1,
    detailHeightStable: Math.abs(detailRect.height - detailBefore.height) <= 1,
    filterPositionStable:
      Math.abs(filterRect.top - filterBefore.top) <= 1 &&
      Math.abs(filterRect.left - filterBefore.left) <= 1,
    narrowState,
    drawerHeight: Math.round(drawerRect.height)
  };
  drawer.querySelector(".modal-close-button, .modal-header-button")?.click();
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  report.closed = !document.querySelector(".pmi-member-dashboard-modal") &&
    document.querySelector(".pmi-member-dashboard-toggle")?.getAttribute("aria-expanded") === "false";
  if (leftSidebarWasCollapsed) leftSplit.collapse();
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
const invalidMetrics = report.metrics?.filter(
  (metric) =>
    !metric.label ||
    !metric.percentage ||
    !metric.title ||
    !metric.ariaLabel.includes("/") ||
    !metric.labelFits ||
    !metric.contained
);
if (
  !report.setup ||
  !report.initiallyCollapsed ||
  !report.expanded ||
  report.groupCount !== 3 ||
  report.metricCount !== 6 ||
  invalidMetrics?.length > 0 ||
  !report.leftSidebarExpanded ||
  !report.insideDrawer ||
  !report.detachedFromDetail ||
  !report.drawerAnchoredRight ||
  !report.drawerHasPlainSurface ||
  !report.runwayIsInset ||
  !report.drawerHasNoHorizontalOverflow ||
  !report.detailHasNoHorizontalOverflow ||
  !report.detailHeightStable ||
  !report.filterPositionStable ||
  !report.narrowState?.stacked ||
  !report.narrowState?.containedByDrawer ||
  !report.narrowState?.drawerHasNoHorizontalOverflow ||
  !report.narrowState?.labelsFit ||
  !report.closed
) {
  console.error(`Member ratio ledger failed: ${JSON.stringify({ ...report, invalidMetrics })}`);
  process.exitCode = 1;
} else {
  console.log(
    `Member dashboard opened as a ${report.drawerHeight}px right drawer with 3 groups and 6 accessible metrics; task detail stayed stable.`
  );
}
