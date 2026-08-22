import { spawnSync } from "node:child_process";

const vault = process.argv[2] ?? "Obsd";
const openResult = spawnSync(
  "obsidian",
  [`vault=${vault}`, "command", "id=project-manager-insights:open-assignee-workload-insights"],
  { encoding: "utf8" }
);
if (openResult.error) throw openResult.error;

function evaluate(code) {
  const result = spawnSync("obsidian", [`vault=${vault}`, "eval", `code=${code}`], {
    encoding: "utf8"
  });
  if (result.error) throw result.error;
  const output = `${result.stdout}${result.stderr}`;
  const payload = output.match(/=>\s*(\{.*\})/u)?.[1];
  if (!payload) throw new Error(`Could not read Obsidian evaluation result:\n${output}`);
  return JSON.parse(payload);
}

const setup = evaluate(`(async () => {
  const waitFor = async (read, attempts = 100) => {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const result = read();
      if (result) return result;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return null;
  };

  const trigger = await waitFor(() =>
    document.querySelector(".pmi-delivery-progress-quality")
  );
  if (!(trigger instanceof HTMLButtonElement)) {
    return JSON.stringify({ setup: false, reason: "delivery issue trigger unavailable" });
  }

  document.querySelector(".pmi-delivery-issues-modal")
    ?.querySelector(".modal-close-button, .modal-header-button")?.click();
  const rect = trigger.getBoundingClientRect();

  return JSON.stringify({
    setup: true,
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2
  });
})()`);

if (!setup.setup || !Number.isFinite(setup.x) || !Number.isFinite(setup.y)) {
  console.error(`Could not locate the delivery issue trigger: ${JSON.stringify(setup)}`);
  process.exit(1);
}

for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
  const params = {
    type,
    x: setup.x,
    y: setup.y,
    button: type === "mouseMoved" ? "none" : "left",
    clickCount: type === "mouseMoved" ? 0 : 1
  };
  const result = spawnSync("obsidian", [
    `vault=${vault}`,
    "dev:cdp",
    "method=Input.dispatchMouseEvent",
    `params=${JSON.stringify(params)}`
  ], {
    encoding: "utf8"
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${result.stdout}${result.stderr}`);
}

const opened = evaluate(`(async () => {
  for (let attempt = 0; attempt < 40 && !document.querySelector(".pmi-delivery-issues-modal"); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return JSON.stringify({
    setup: true,
    modalOpen: Boolean(document.querySelector(".pmi-delivery-issues-modal"))
  });
})()`);
if (!opened.modalOpen) {
  console.error(`Could not open the delivery issue modal: ${JSON.stringify(opened)}`);
  process.exit(1);
}

for (const type of ["keyDown", "keyUp"]) {
  const result = spawnSync("obsidian", [
    `vault=${vault}`,
    "dev:cdp",
    "method=Input.dispatchKeyEvent",
    `params=${JSON.stringify({ type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 })}`
  ], {
    encoding: "utf8"
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${result.stdout}${result.stderr}`);
}

const report = evaluate(`(async () => {
  for (let attempt = 0; attempt < 40 && document.querySelector(".pmi-delivery-issues-modal"); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const trigger = document.querySelector(".pmi-delivery-progress-quality");
  if (!(trigger instanceof HTMLButtonElement)) {
    return JSON.stringify({ setup: false, reason: "delivery issue trigger disappeared" });
  }
  const style = getComputedStyle(trigger);
  return JSON.stringify({
    setup: true,
    modalClosed: !document.querySelector(".pmi-delivery-issues-modal"),
    triggerFocused: document.activeElement === trigger,
    focusVisible: trigger.matches(":focus-visible"),
    outlineStyle: style.outlineStyle,
    outlineWidth: Number.parseFloat(style.outlineWidth) || 0,
    outlineColor: style.outlineColor,
    tooltipVisible: Boolean(document.querySelector(".tooltip"))
  });
})()`);

if (!report.modalClosed) {
  evaluate(`(() => {
    document.querySelector(".pmi-delivery-issues-modal")
      ?.querySelector(".modal-close-button, .modal-header-button")?.click();
    return JSON.stringify({ setup: true });
  })()`);
}

const thickFocusOutline = report.focusVisible && report.outlineWidth >= 2 && report.outlineStyle !== "none";
if (
  !report.setup ||
  !report.modalClosed ||
  !report.triggerFocused ||
  !report.focusVisible ||
  thickFocusOutline
) {
  console.error(`Delivery issue trigger retains a strong focus treatment after Escape: ${JSON.stringify(report)}`);
  process.exit(1);
}

console.log("Delivery issue trigger returns from Escape without a lingering strong focus treatment.");
