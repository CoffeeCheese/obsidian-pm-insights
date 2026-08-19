import { spawnSync } from "node:child_process";

const vault = process.argv[2] ?? "dev-test";
const openResult = spawnSync(
  "obsidian",
  [`vault=${vault}`, "command", "id=project-manager-insights:open-assignee-workload-insights"],
  { encoding: "utf8" }
);
if (openResult.error) throw openResult.error;

const evaluation = `(async () => {
  for (let attempt = 0; attempt < 30 && !document.querySelector(".pmi-member-ratios"); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  const ledger = document.querySelector(".pmi-member-ratios");
  const filterBar = document.querySelector(".pmi-task-filter-bar");
  if (!(ledger instanceof HTMLElement) || !(filterBar instanceof HTMLElement)) {
    return JSON.stringify({ setup: false });
  }

  const ledgerRect = ledger.getBoundingClientRect();
  const filterRect = filterBar.getBoundingClientRect();
  const groups = [...ledger.querySelectorAll(".pmi-ratio-group")];
  const metrics = [...ledger.querySelectorAll(".pmi-ratio-metric")].map((metric) => {
    const rect = metric.getBoundingClientRect();
    return {
      label: metric.querySelector(".pmi-ratio-name")?.textContent?.trim() ?? "",
      percentage: metric.querySelector("strong")?.textContent?.trim() ?? "",
      sample: metric.querySelector(".pmi-ratio-sample")?.textContent?.trim() ?? "",
      title: metric.getAttribute("title") ?? "",
      ariaLabel: metric.getAttribute("aria-label") ?? "",
      contained: rect.left >= ledgerRect.left - 1 && rect.right <= ledgerRect.right + 1
    };
  });

  return JSON.stringify({
    setup: true,
    groupCount: groups.length,
    metricCount: metrics.length,
    metrics,
    compactHeight: Math.round(ledgerRect.height * 100) / 100,
    doesNotOverlapFilters: ledgerRect.bottom <= filterRect.top
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
const invalidMetrics = report.metrics?.filter(
  (metric) =>
    !metric.label ||
    !metric.percentage ||
    !metric.sample ||
    !metric.title ||
    !metric.ariaLabel ||
    !metric.contained
);
if (
  !report.setup ||
  report.groupCount !== 3 ||
  report.metricCount !== 6 ||
  invalidMetrics?.length > 0 ||
  report.compactHeight > 160 ||
  !report.doesNotOverlapFilters
) {
  console.error(`Member ratio ledger failed: ${JSON.stringify({ ...report, invalidMetrics })}`);
  process.exitCode = 1;
} else {
  console.log(
    `Member ratio ledger rendered 3 compact groups and 6 accessible metrics in ${report.compactHeight}px.`
  );
}
