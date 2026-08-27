import { spawnSync } from "node:child_process";

const vault = process.argv[2] ?? "dev-test";
const openResult = spawnSync(
  "obsidian",
  [`vault=${vault}`, "command", "id=project-manager-insights:open-assignee-workload-insights"],
  { encoding: "utf8" }
);
if (openResult.error) throw openResult.error;

const evaluation = `(async () => {
  const waitFor = async (read, attempts = 100) => {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const result = read();
      if (result) return result;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return null;
  };
  let editor = document.querySelector(".modal.pmi-project-gates-modal");
  let openedByCheck = false;
  if (!editor) {
    const gateButton = await waitFor(() =>
      document.querySelector(".pmi-project-scope-gates")
    );
    if (!(gateButton instanceof HTMLButtonElement)) {
      return JSON.stringify({ setup: false, reason: "gate button unavailable" });
    }
    activeWindow = document.defaultView;
    activeDocument = document;
    gateButton.click();
    editor = await waitFor(() =>
      document.querySelector(".modal.pmi-project-gates-modal")
    );
    openedByCheck = true;
  }
  const footer = editor?.querySelector(
    ".modal.pmi-project-gates-modal .pmi-gate-editor-footer"
  ) ?? editor?.querySelector(".pmi-gate-editor-footer");
  const cancel = footer?.querySelector("button:not(.pmi-gate-editor-save)");
  const save = footer?.querySelector("button.pmi-gate-editor-save");
  if (!(cancel instanceof HTMLButtonElement) || !(save instanceof HTMLButtonElement)) {
    if (openedByCheck) editor?.querySelector(".modal-close-button, .modal-header-button")?.click();
    return JSON.stringify({ setup: false, reason: "gate footer unavailable" });
  }

  const snapshot = (button) => {
    const style = getComputedStyle(button);
    return {
      disabled: button.disabled,
      boxShadow: style.boxShadow,
      transform: style.transform,
      opacity: style.opacity
    };
  };
  const originalDisabled = save.disabled;
  save.disabled = true;
  await new Promise((resolve) => setTimeout(resolve, 250));
  const cancelStyle = snapshot(cancel);
  const saveStyle = snapshot(save);
  const report = {
    setup: true,
    cancel: cancelStyle,
    save: saveStyle,
    elevated: saveStyle.boxShadow !== "none"
      && saveStyle.boxShadow === cancelStyle.boxShadow
  };
  save.disabled = originalDisabled;
  if (openedByCheck) editor?.querySelector(".modal-close-button, .modal-header-button")?.click();
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
if (!report.setup || !report.elevated) {
  console.error(`Gate save button elevation failed: ${JSON.stringify(report)}`);
  process.exitCode = 1;
} else {
  console.log(`Gate footer elevation matches: ${JSON.stringify(report)}`);
}
