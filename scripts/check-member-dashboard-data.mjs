import { spawnSync } from "node:child_process";

const vault = process.argv[2] ?? "dev-test";
const runObsidian = (args) => {
  const result = spawnSync("obsidian", [`vault=${vault}`, ...args], { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${result.stdout}${result.stderr}`);
  return `${result.stdout}${result.stderr}`;
};

runObsidian(["command", "id=project-manager-insights:open-assignee-workload-insights"]);

const evaluation = `(async () => {
  const waitFor = async (selector) => {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const element = document.querySelector(selector);
      if (element) return element;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return null;
  };
  const root = await waitFor(".pmi-root");
  if (!(root instanceof HTMLElement)) return JSON.stringify({ setup: false, reason: "missing-root" });
  let toggle = root.querySelector(".pmi-member-dashboard-toggle");
  if (!(toggle instanceof HTMLButtonElement)) {
    const member = [...root.querySelectorAll(".pmi-member")].find((item) =>
      /[1-9]\\d*\\s*(?:个任务|tasks?)/iu.test(item.textContent ?? "")
    );
    member?.click();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    toggle = root.querySelector(".pmi-member-dashboard-toggle");
  }
  if (!(toggle instanceof HTMLButtonElement)) {
    return JSON.stringify({ setup: false, reason: "missing-dashboard-toggle" });
  }
  toggle.click();
  const drawer = await waitFor(".pmi-personal-delivery-dashboard");
  if (!(drawer instanceof HTMLElement)) {
    return JSON.stringify({ setup: false, reason: "missing-personal-delivery-dashboard" });
  }
  const windows = [...drawer.querySelectorAll(".pmi-personal-window")].map((window) => ({
    label: window.getAttribute("aria-label") ?? "",
    commitments: window.querySelectorAll(".pmi-personal-window-commitment").length,
    progress: Number(window.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")),
    hasRemaining: Boolean(window.querySelector(".pmi-personal-window-facts strong"))
  }));
  const summaryCards = drawer.querySelectorAll(".pmi-personal-summary-card").length;
  const empty = Boolean(drawer.querySelector(".pmi-personal-windows-empty"));
  const legacyPanels = drawer.querySelectorAll(
    ".pmi-member-comparison, .pmi-member-project-mix, .pmi-member-ledger-section"
  ).length;
  drawer.closest(".modal-container")
    ?.querySelector(".modal-close-button, .modal-header-button")?.click();
  return JSON.stringify({ setup: true, windows, summaryCards, empty, legacyPanels });
})()`;

const output = runObsidian(["eval", `code=${evaluation}`]);
const payload = output.match(/=>\s*(\{.*\})/u)?.[1];
if (!payload) throw new Error(`Could not read Obsidian evaluation result:\n${output}`);

const report = JSON.parse(payload);
const windowsValid = report.empty || (
  report.windows?.length > 0 && report.windows.every((window) =>
    window.label && window.commitments > 0 && Number.isFinite(window.progress)
      && window.progress >= 0 && window.progress <= 100 && window.hasRemaining
  )
);
if (!report.setup || !windowsValid || report.summaryCards !== 2 || report.legacyPanels !== 0) {
  console.error(`Personal delivery dashboard mismatch: ${JSON.stringify(report)}`);
  process.exitCode = 1;
} else {
  console.log(`Personal delivery dashboard exposes ${report.windows.length} delivery windows and two focused summaries.`);
}
