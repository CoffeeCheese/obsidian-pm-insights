import { spawnSync } from "node:child_process";

const vault = process.argv[2] ?? "dev-test";
const openResult = spawnSync(
  "obsidian",
  [`vault=${vault}`, "command", "id=project-manager-insights:open-assignee-workload-insights"],
  { encoding: "utf8" }
);
if (openResult.error) throw openResult.error;

const evaluation = `(async () => {
  const waitFor = async (read, attempts = 60) => {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const result = read();
      if (result) return result;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return null;
  };

  const root = await waitFor(() => document.querySelector(".pmi-root"));
  if (!(root instanceof HTMLElement)) {
    return JSON.stringify({ setup: false, reason: "insights view unavailable" });
  }

  const leftSplit = app.workspace.leftSplit;
  const rightSplit = app.workspace.rightSplit;
  const originalState = {
    leftCollapsed: leftSplit.collapsed,
    leftSize: leftSplit.size,
    rightCollapsed: rightSplit.collapsed,
    rightSize: rightSplit.size
  };

  let report;
  try {
    leftSplit.expand();
    rightSplit.expand();
    leftSplit.setSize(380);
    rightSplit.setSize(380);
    await new Promise((resolve) => setTimeout(resolve, 400));

    const panel = document.querySelector(".pmi-delivery-progress");
    const totalRow = panel?.querySelector(".pmi-progress-row--total");
    const totalTrack = totalRow?.querySelector(".pmi-progress-track--total");
    if (
      !(panel instanceof HTMLElement) ||
      !(totalRow instanceof HTMLElement) ||
      !(totalTrack instanceof HTMLElement)
    ) {
      report = { setup: false, reason: "delivery progress elements unavailable" };
    } else {
      const panelRect = panel.getBoundingClientRect();
      const rowRect = totalRow.getBoundingClientRect();
      const trackRect = totalTrack.getBoundingClientRect();
      report = {
        setup: true,
        viewportWidth: window.innerWidth,
        leftSidebarWidth: leftSplit.size,
        rightSidebarWidth: rightSplit.size,
        rootWidth: root.getBoundingClientRect().width,
        panel: {
          left: panelRect.left,
          right: panelRect.right,
          width: panelRect.width
        },
        totalRow: {
          left: rowRect.left,
          right: rowRect.right,
          width: rowRect.width
        },
        totalTrack: {
          left: trackRect.left,
          right: trackRect.right,
          width: trackRect.width
        },
        overflowRight: Math.max(0, trackRect.right - panelRect.right)
      };
    }
  } finally {
    leftSplit.setSize(originalState.leftSize);
    rightSplit.setSize(originalState.rightSize);
    if (originalState.leftCollapsed) leftSplit.collapse();
    if (originalState.rightCollapsed) rightSplit.collapse();
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
const tolerance = 1;
const bothSidebarsExpanded =
  report.setup && report.leftSidebarWidth > 0 && report.rightSidebarWidth > 0;
const totalRowContained =
  report.setup &&
  report.totalRow.left >= report.panel.left - tolerance &&
  report.totalRow.right <= report.panel.right + tolerance;
const totalTrackContained =
  report.setup &&
  report.totalTrack.left >= report.panel.left - tolerance &&
  report.totalTrack.right <= report.panel.right + tolerance;

if (!report.setup || !bothSidebarsExpanded || !totalRowContained || !totalTrackContained) {
  console.error(`Delivery progress overflows with both sidebars expanded: ${JSON.stringify(report)}`);
  process.exitCode = 1;
} else {
  console.log(
    `Delivery progress stays within its ${report.panel.width}px panel with both sidebars expanded.`
  );
}
