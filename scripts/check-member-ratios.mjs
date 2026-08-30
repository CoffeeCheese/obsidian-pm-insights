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
  toggle.click();
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  const expandedToggle = document.querySelector(".pmi-member-dashboard-toggle");
  const ledger = document.querySelector(".pmi-member-ratios");
  const dashboard = document.querySelector(".pmi-member-dashboard");
  const header = document.querySelector(".pmi-detail-header");
  const detail = document.querySelector(".pmi-detail");
  const identity = document.querySelector(".pmi-detail-identity");
  const identityName = identity?.querySelector("h2");
  const filterBar = document.querySelector(".pmi-task-filter-bar");
  const masterDetail = detail?.parentElement;
  if (
    !(ledger instanceof HTMLElement) ||
    !(dashboard instanceof HTMLElement) ||
    !(header instanceof HTMLElement) ||
    !(detail instanceof HTMLElement) ||
    !(identity instanceof HTMLElement) ||
    !(identityName instanceof HTMLElement) ||
    !(filterBar instanceof HTMLElement) ||
    !(expandedToggle instanceof HTMLButtonElement) ||
    !(masterDetail instanceof HTMLElement)
  ) {
    if (leftSidebarWasCollapsed) leftSplit.collapse();
    return JSON.stringify({ setup: false });
  }

  const ledgerRect = ledger.getBoundingClientRect();
  const dashboardRect = dashboard.getBoundingClientRect();
  const detailRect = detail.getBoundingClientRect();
  const identityRect = identity.getBoundingClientRect();
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

  const originalGridTemplate = masterDetail.style.gridTemplateColumns;
  masterDetail.style.gridTemplateColumns = "minmax(290px, 1fr) 580px";
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const narrowLedgerRect = ledger.getBoundingClientRect();
  const narrowDetailRect = detail.getBoundingClientRect();
  const narrowIdentityRect = identity.getBoundingClientRect();
  const narrowState = {
    stacked: narrowLedgerRect.top >= narrowIdentityRect.bottom - 1,
    containedByDetail:
      narrowLedgerRect.left >= narrowDetailRect.left - 1 &&
      narrowLedgerRect.right <= narrowDetailRect.right + 1,
    headerHasNoHorizontalOverflow: header.scrollWidth <= header.clientWidth + 1,
    labelsFit: [...ledger.querySelectorAll(".pmi-ratio-name")].every(
      (label) => label.scrollWidth <= label.clientWidth
    )
  };
  masterDetail.style.gridTemplateColumns = originalGridTemplate;
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
    insideDashboard:
      dashboard.contains(ledger) &&
      ledgerRect.top >= dashboardRect.top - 1 &&
      ledgerRect.bottom <= dashboardRect.bottom + 1,
    containedByDetail:
      ledgerRect.left >= detailRect.left - 1 && ledgerRect.right <= detailRect.right + 1,
    headerHasNoHorizontalOverflow: header.scrollWidth <= header.clientWidth + 1,
    detailHasNoHorizontalOverflow: detail.scrollWidth <= detail.clientWidth + 1,
    identityNameFits: identityName.scrollWidth <= identityName.clientWidth + 1,
    narrowState,
    placedAfterIdentity: dashboardRect.top >= identityRect.bottom - 1,
    doesNotOverlapFilters: ledgerRect.bottom <= filterRect.top
  };
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
  !report.insideDashboard ||
  !report.containedByDetail ||
  !report.headerHasNoHorizontalOverflow ||
  !report.detailHasNoHorizontalOverflow ||
  !report.identityNameFits ||
  !report.narrowState?.stacked ||
  !report.narrowState?.containedByDetail ||
  !report.narrowState?.headerHasNoHorizontalOverflow ||
  !report.narrowState?.labelsFit ||
  !report.placedAfterIdentity ||
  !report.doesNotOverlapFilters
) {
  console.error(`Member ratio ledger failed: ${JSON.stringify({ ...report, invalidMetrics })}`);
  process.exitCode = 1;
} else {
  console.log(
    `Member ratio ledger expanded inside the personal dashboard with 3 groups and 6 accessible metrics in ${report.compactHeight}px.`
  );
}
