import { spawnSync } from "node:child_process";

const vault = process.argv[2] ?? "dev-test";
const openResult = spawnSync(
  "obsidian",
  [`vault=${vault}`, "command", "id=project-manager-insights:open-assignee-workload-insights"],
  { encoding: "utf8" }
);
if (openResult.error) throw openResult.error;

const evaluation = `(async () => {
  const waitFor = async (selector) => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const element = document.querySelector(selector);
      if (element) return element;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return null;
  };

  const root = await waitFor(".pmi-root");
  if (!(root instanceof HTMLElement)) return JSON.stringify({ setup: false, reason: "missing-root" });

  root.querySelector(".pmi-task-filter-reset")?.click();
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  let rows = [...root.querySelectorAll(".pmi-task-row")];
  if (rows.length === 0) {
    const memberWithTasks = [...root.querySelectorAll(".pmi-member")].find((member) =>
      /[1-9]\\d*\\s*个任务/u.test(member.textContent ?? "")
    );
    memberWithTasks?.click();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    rows = [...root.querySelectorAll(".pmi-task-row")];
  }

  const parseHours = (value) => {
    const match = value?.match(/-?\\d+(?:\\.\\d+)?/u);
    return match ? Number(match[0]) : 0;
  };
  const tasks = rows.map((row) => {
    const hours = [...row.querySelectorAll(".pmi-task-hours")].map((cell) => parseHours(cell.textContent));
    return {
      status: row.querySelector(".pmi-task-status")?.textContent?.trim().toLowerCase() ?? "",
      planned: hours[0] ?? 0,
      tracked: hours[1] ?? 0
    };
  });
  if (tasks.length === 0) return JSON.stringify({ setup: false, reason: "missing-task-fixture" });

  const isCancelled = (task) => ["cancelled", "canceled", "已取消"].includes(task.status);
  const isDone = (task) => ["done", "completed", "已完成"].includes(task.status);
  const active = tasks.filter((task) => !isCancelled(task));
  const estimated = active.filter((task) => task.planned > 0);
  const completed = active.filter(isDone);
  const completedEstimated = completed.filter((task) => task.planned > 0);
  const startedEstimated = estimated.filter((task) => task.tracked > 0 || isDone(task));
  const withinEstimate = completedEstimated.filter((task) =>
    task.tracked >= task.planned * 0.8 && task.tracked <= task.planned * 1.2
  );

  const expected = [
    [completed.length, active.length],
    [completedEstimated.reduce((sum, task) => sum + task.planned, 0), estimated.reduce((sum, task) => sum + task.planned, 0)],
    [estimated.reduce((sum, task) => sum + task.tracked, 0), estimated.reduce((sum, task) => sum + task.planned, 0)],
    [startedEstimated.filter((task) => task.tracked > task.planned).length, startedEstimated.length],
    [withinEstimate.length, completedEstimated.length],
    [estimated.length, active.length]
  ];

  const existingDrawer = document.querySelector(".pmi-member-dashboard-modal");
  const openedByCheck = !existingDrawer;
  if (!existingDrawer) root.querySelector(".pmi-member-dashboard-toggle")?.click();
  const drawer = await waitFor(".pmi-member-dashboard-modal");
  if (!(drawer instanceof HTMLElement)) return JSON.stringify({ setup: false, reason: "missing-drawer" });

  const metrics = [...drawer.querySelectorAll(".pmi-ratio-metric")].map((metric) => {
    const label = metric.querySelector(".pmi-ratio-name")?.textContent?.trim() ?? "";
    const ariaLabel = metric.getAttribute("aria-label") ?? "";
    const match = ariaLabel.match(/;\\s*(-?\\d+(?:\\.\\d+)?)h?\\s*\\/\\s*(-?\\d+(?:\\.\\d+)?)h?/u);
    const benchmark = metric.querySelector(".pmi-ratio-benchmark")?.textContent?.trim() ?? "";
    return {
      label,
      actual: match ? [Number(match[1]), Number(match[2])] : null,
      benchmark,
      ariaLabel
    };
  });

  if (openedByCheck) drawer.querySelector(".modal-close-button, .modal-header-button")?.click();
  return JSON.stringify({ setup: true, member: root.querySelector(".pmi-detail h2, .pmi-detail h3")?.textContent?.trim(), tasks, expected, metrics });
})()`;

const result = spawnSync("obsidian", [`vault=${vault}`, "eval", `code=${evaluation}`], {
  encoding: "utf8"
});
if (result.error) throw result.error;

const output = `${result.stdout}${result.stderr}`;
const payload = output.match(/=>\s*(\{.*\})/u)?.[1];
if (!payload) throw new Error(`Could not read Obsidian evaluation result:\n${output}`);

const report = JSON.parse(payload);
const valuesMatch = report.metrics?.length === report.expected?.length && report.metrics.every(
  (metric, index) => metric.actual?.length === 2 && metric.actual.every(
    (value, valueIndex) => Math.abs(value - report.expected[index][valueIndex]) < 0.001
  )
);
const benchmarksMatch = report.metrics?.every((metric) =>
  (metric.actual?.[1] ?? 0) <= 0 || (metric.benchmark && !metric.benchmark.includes("—"))
);

if (!report.setup || !valuesMatch || !benchmarksMatch) {
  console.error(`Member dashboard data mismatch: ${JSON.stringify(report)}`);
  process.exitCode = 1;
} else {
  console.log(`Member dashboard ledger matches ${report.tasks.length} visible tasks for ${report.member ?? "the selected member"}.`);
}
