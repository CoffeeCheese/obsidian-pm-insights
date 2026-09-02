import { spawnSync } from "node:child_process";

const vault = process.argv[2] ?? "dev-test";
const runObsidian = (args) => {
  const result = spawnSync("obsidian", [`vault=${vault}`, ...args], { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${result.stdout}${result.stderr}`);
  return `${result.stdout}${result.stderr}`;
};
const readJson = (expression) => {
  const output = runObsidian(["eval", `code=${expression}`]);
  const payload = output.match(/=>\s*(\{.*\})/u)?.[1];
  if (!payload) throw new Error(`Could not read Obsidian evaluation result:\n${output}`);
  return JSON.parse(payload);
};

runObsidian(["command", "id=project-manager-insights:open-assignee-workload-insights"]);

const target = readJson(`(async () => {
  let openedByCheck = false;
  let row = null;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    row = document.querySelector(".pmi-personal-window");
    if (row instanceof HTMLButtonElement) break;
    if (!openedByCheck && !document.querySelector(".pmi-member-dashboard")) {
      const toggle = document.querySelector(".pmi-member-dashboard-toggle");
      if (toggle instanceof HTMLButtonElement) {
        toggle.click();
        openedByCheck = true;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!(row instanceof HTMLButtonElement)) {
    return JSON.stringify({ setup: false, reason: "delivery window unavailable" });
  }
  await new Promise((resolve) => setTimeout(resolve, 300));
  const rect = row.getBoundingClientRect();
  return JSON.stringify({
    setup: true,
    openedByCheck,
    center: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  });
})()`);
if (!target.setup) {
  console.error(`Delivery-window hover setup failed: ${JSON.stringify(target)}`);
  process.exit(1);
}

const snapshotExpression = `(() => {
  const row = document.querySelector(".pmi-personal-window");
  const list = row?.closest(".pmi-personal-window-list");
  if (!(row instanceof HTMLButtonElement) || !(list instanceof HTMLElement)) {
    return JSON.stringify({ setup: false, reason: "delivery window unavailable" });
  }
  const style = getComputedStyle(row);
  const listLineStyle = getComputedStyle(list, "::before");
  const rowLineStyle = getComputedStyle(row, "::before");
  const rect = row.getBoundingClientRect();
  return JSON.stringify({
    setup: true,
    hovered: row.matches(":hover"),
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    backgroundColor: style.backgroundColor,
    backgroundImage: style.backgroundImage,
    transform: style.transform,
    overflowX: style.overflowX,
    overflowY: style.overflowY,
    clipPath: style.clipPath,
    timeline: {
      listContent: listLineStyle.content,
      listDisplay: listLineStyle.display,
      listWidth: listLineStyle.width,
      listBackgroundColor: listLineStyle.backgroundColor,
      listZIndex: listLineStyle.zIndex,
      rowContent: rowLineStyle.content,
      rowDisplay: rowLineStyle.display,
      rowWidth: rowLineStyle.width,
      rowBackgroundColor: rowLineStyle.backgroundColor,
      rowZIndex: style.zIndex
    }
  });
})()`;
runObsidian([
  "dev:cdp",
  "method=Input.dispatchMouseEvent",
  `params=${JSON.stringify({ type: "mouseMoved", x: 1, y: 1 })}`
]);
const resting = readJson(snapshotExpression);
runObsidian([
  "dev:cdp",
  "method=Input.dispatchMouseEvent",
  `params=${JSON.stringify({ type: "mouseMoved", x: target.center.x, y: target.center.y })}`
]);
readJson(`(async () => {
  await new Promise((resolve) => setTimeout(resolve, 180));
  return JSON.stringify({ settled: true });
})()`);
const hovered = readJson(snapshotExpression);
runObsidian([
  "dev:cdp",
  "method=Input.dispatchMouseEvent",
  `params=${JSON.stringify({ type: "mouseMoved", x: 1, y: 1 })}`
]);
if (target.openedByCheck) {
  runObsidian([
    "eval",
    `code=(() => {
      document.querySelector(".pmi-personal-delivery-dashboard")?.closest(".modal-container")
        ?.querySelector(".modal-close-button, .modal-header-button")?.click();
      return true;
    })()`
  ]);
}

const withinHalfPixel = (left, right) => Math.abs(left - right) <= 0.5;
const isTransparent = (color) => color === "transparent" || /rgba\([^)]*,\s*0\)$/u.test(color);
const hasPaintedLine = (content, display, width, backgroundColor) =>
  content !== "none" && display !== "none" && Number.parseFloat(width) > 0
    && !isTransparent(backgroundColor);
const zIndex = (value) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const rowLinePainted = hasPaintedLine(
  hovered.timeline.rowContent,
  hovered.timeline.rowDisplay,
  hovered.timeline.rowWidth,
  hovered.timeline.rowBackgroundColor
);
const listLinePainted = hasPaintedLine(
  hovered.timeline.listContent,
  hovered.timeline.listDisplay,
  hovered.timeline.listWidth,
  hovered.timeline.listBackgroundColor
);
const timelineVisible = rowLinePainted || (
  listLinePainted && (
    isTransparent(hovered.backgroundColor)
      || zIndex(hovered.timeline.listZIndex) > zIndex(hovered.timeline.rowZIndex)
  )
);
const stable = hovered.setup && hovered.hovered
  && hovered.transform === resting.transform
  && hovered.backgroundImage === "none"
  && withinHalfPixel(hovered.rect.x, resting.rect.x)
  && withinHalfPixel(hovered.rect.y, resting.rect.y)
  && withinHalfPixel(hovered.rect.width, resting.rect.width)
  && withinHalfPixel(hovered.rect.height, resting.rect.height);
const feedback = hovered.backgroundColor !== resting.backgroundColor;
if (!stable || !feedback || !timelineVisible) {
  console.error(`Delivery-window hover obscures its timeline or is unstable: ${JSON.stringify({ resting, hovered, timelineVisible })}`);
  process.exitCode = 1;
} else {
  console.log("Delivery-window hover preserves the timeline without layout movement.");
}
