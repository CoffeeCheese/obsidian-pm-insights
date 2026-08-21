import { spawnSync } from "node:child_process";

const vault = process.argv[2] ?? "dev-test";
const evaluation = `(async () => {
  app.setting.open();
  app.setting.openTabById("project-manager-insights");
  await new Promise((resolve) => setTimeout(resolve, 200));

  const container = app.setting.activeTab?.containerEl;
  const group = container?.querySelector(".pmi-alias-group");
  const guide = group?.querySelector(".pmi-alias-guide");
  const equation = guide?.querySelector(".pmi-alias-equation");
  const add = group?.querySelector(
    ":scope > .setting-item-heading .extra-setting-button[aria-label]"
  );
  const canonicalInputs = [...(group?.querySelectorAll(".pmi-alias-canonical-input") ?? [])];
  const aliasInputs = [...(group?.querySelectorAll(".pmi-alias-names-input") ?? [])];

  return JSON.stringify({
    setup: Boolean(group && guide && equation),
    title: guide?.querySelector(".setting-item-name")?.textContent ?? "",
    description: guide?.querySelector(".setting-item-description")?.textContent ?? "",
    canonicalExample: guide?.querySelector(".pmi-alias-example--canonical code")?.textContent ?? "",
    aliasExampleCount: guide?.querySelectorAll(".pmi-alias-example--source code").length ?? 0,
    result: guide?.querySelector(".pmi-alias-guide-result")?.textContent ?? "",
    equationLabel: equation?.getAttribute("aria-label") ?? "",
    addLabel: add?.getAttribute("aria-label") ?? "",
    inputsLabelled: [...canonicalInputs, ...aliasInputs].every(
      (input) => Boolean(input.getAttribute("aria-label"))
    ),
    guideFits: (guide?.scrollWidth ?? 1) <= (guide?.clientWidth ?? 0) + 1,
    equationFits: (equation?.scrollWidth ?? 1) <= (equation?.clientWidth ?? 0) + 1
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
  !report.title ||
  !report.description.includes("+") ||
  !report.canonicalExample ||
  report.aliasExampleCount < 2 ||
  !report.result ||
  !report.equationLabel ||
  !report.addLabel ||
  !report.inputsLabelled ||
  !report.guideFits ||
  !report.equationFits
) {
  console.error(`Member alias guide failed: ${JSON.stringify(report)}`);
  process.exitCode = 1;
} else {
  console.log("Member alias guide explains the mapping and fits the settings panel.");
}
