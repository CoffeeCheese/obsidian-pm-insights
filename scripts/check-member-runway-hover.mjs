import { spawnSync } from "node:child_process";

const vault = process.argv[2] ?? "dev-test";

const runObsidian = (args) => {
  const result = spawnSync("obsidian", [`vault=${vault}`, ...args], {
    encoding: "utf8"
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${result.stdout}${result.stderr}`);
  }
  return `${result.stdout}${result.stderr}`;
};

runObsidian([
  "command",
  "id=project-manager-insights:open-assignee-workload-insights"
]);

const readJson = (expression) => {
  const output = runObsidian(["eval", `code=${expression}`]);
  const payload = output.match(/=>\s*(\{.*\})/u)?.[1];
  if (!payload) throw new Error(`Could not read Obsidian evaluation result:\n${output}`);
  return JSON.parse(payload);
};

const checkpoint = readJson(`(async () => {
  let openedByCheck = false;
  let button = null;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    button = document.querySelector(".pmi-runway-checkpoint");
    if (button instanceof HTMLButtonElement) break;
    if (!openedByCheck && !document.querySelector(".pmi-member-dashboard")) {
      const toggle = document.querySelector(".pmi-member-dashboard-toggle");
      if (toggle instanceof HTMLButtonElement) {
        activeWindow = document.defaultView;
        activeDocument = document;
        toggle.click();
        openedByCheck = true;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!(button instanceof HTMLButtonElement)) {
    return JSON.stringify({ setup: false, reason: "runway checkpoint unavailable" });
  }
  await new Promise((resolve) => setTimeout(resolve, 300));
  const rect = button.getBoundingClientRect();
  return JSON.stringify({
    setup: true,
    openedByCheck,
    center: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  });
})()`);

if (!checkpoint.setup) {
  console.error(`Runway hover setup failed: ${JSON.stringify(checkpoint)}`);
  process.exit(1);
}

const snapshotExpression = `(() => {
  const button = document.querySelector(".pmi-runway-checkpoint");
  const dot = button?.querySelector(".pmi-runway-checkpoint-dot");
  if (!(button instanceof HTMLButtonElement) || !(dot instanceof HTMLElement)) {
    return JSON.stringify({ setup: false, reason: "runway checkpoint unavailable" });
  }
  const buttonStyle = getComputedStyle(button);
  const dotStyle = getComputedStyle(dot);
  const rect = button.getBoundingClientRect();
  return JSON.stringify({
    setup: true,
    hovered: button.matches(":hover"),
    rect: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height
    },
    button: {
      backgroundColor: buttonStyle.backgroundColor,
      backgroundImage: buttonStyle.backgroundImage,
      borderColor: buttonStyle.borderColor,
      borderStyle: buttonStyle.borderStyle,
      boxShadow: buttonStyle.boxShadow,
      transform: buttonStyle.transform
    },
    dot: {
      boxShadow: dotStyle.boxShadow,
      transform: dotStyle.transform
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
  `params=${JSON.stringify({
    type: "mouseMoved",
    x: checkpoint.center.x,
    y: checkpoint.center.y
  })}`
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

if (checkpoint.openedByCheck) {
  runObsidian([
    "eval",
    `code=(() => {
      const dashboard = document.querySelector(".pmi-member-dashboard");
      dashboard?.closest(".modal-container")
        ?.querySelector(".modal-close-button, .modal-header-button")?.click();
      return true;
    })()`
  ]);
}

const isTransparent = (value) =>
  value === "transparent" || /rgba\([^)]*,\s*0(?:\.0+)?\)$/u.test(value);

const withinHalfPixel = (left, right) => Math.abs(left - right) <= 0.5;

const surfaceIsQuiet =
  hovered.setup &&
  hovered.hovered &&
  isTransparent(hovered.button.backgroundColor) &&
  hovered.button.backgroundImage === "none" &&
  hovered.button.borderStyle === "none" &&
  hovered.button.boxShadow === "none" &&
  hovered.button.transform === resting.button.transform &&
  withinHalfPixel(hovered.rect.x, resting.rect.x) &&
  withinHalfPixel(hovered.rect.y, resting.rect.y) &&
  withinHalfPixel(hovered.rect.width, resting.rect.width) &&
  withinHalfPixel(hovered.rect.height, resting.rect.height);

const nodeCarriesFeedback =
  hovered.setup &&
  (hovered.dot.boxShadow !== resting.dot.boxShadow ||
    hovered.dot.transform !== resting.dot.transform);

if (!surfaceIsQuiet || !nodeCarriesFeedback) {
  console.error(
    `Runway hover surface is visually noisy: ${JSON.stringify({ resting, hovered })}`
  );
  process.exitCode = 1;
} else {
  console.log(`Runway hover feedback stays on the checkpoint node: ${JSON.stringify(hovered)}`);
}
