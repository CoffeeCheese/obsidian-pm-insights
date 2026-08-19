import { spawnSync } from "node:child_process";

const vault = process.argv[2] ?? "dev-test";
const openResult = spawnSync(
  "obsidian",
  [`vault=${vault}`, "command", "id=project-manager-insights:open-assignee-workload-insights"],
  { encoding: "utf8" }
);
if (openResult.error) throw openResult.error;

const evaluation = `(async () => {
  for (let attempt = 0; attempt < 20 && !document.querySelector(".pmi-project-picker"); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  const picker = document.querySelector(".pmi-project-picker");
  const summary = picker?.querySelector(":scope > summary");
  const search = picker?.querySelector(".pmi-project-search");
  const outside = document.querySelector(".pmi-header");
  if (!(picker instanceof HTMLDetailsElement) || !(summary instanceof HTMLElement) ||
      !(search instanceof HTMLElement) || !(outside instanceof HTMLElement)) {
    return JSON.stringify({ setup: false });
  }

  picker.open = true;
  search.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true }));
  const stayedOpenInside = picker.open;

  outside.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true }));
  const closedOutside = !picker.open;

  picker.open = true;
  search.focus();
  search.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  const closedWithEscape = !picker.open;
  const focusReturned = document.activeElement === summary;

  return JSON.stringify({ setup: true, stayedOpenInside, closedOutside, closedWithEscape, focusReturned });
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
  !report.stayedOpenInside ||
  !report.closedOutside ||
  !report.closedWithEscape ||
  !report.focusReturned
) {
  console.error(`Project picker interaction failed: ${JSON.stringify(report)}`);
  process.exitCode = 1;
} else {
  console.log("Project picker stays open for internal actions and closes on outside click or Escape.");
}
