import { spawnSync } from "node:child_process";

const vault = process.argv[2] ?? "dev-test";
const openResult = spawnSync(
  "obsidian",
  [`vault=${vault}`, "command", "id=project-manager-insights:open-assignee-workload-insights"],
  { encoding: "utf8" }
);
if (openResult.error) throw openResult.error;

const evaluation = `(async () => {
  for (let attempt = 0; attempt < 30 && !document.querySelector(".pmi-root"); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  const root = document.querySelector(".pmi-root");
  if (!(root instanceof HTMLElement)) return JSON.stringify({ setup: false });

  const themeStyle = app.customCss?.styleEl;
  const themeWasDisabled = Boolean(themeStyle?.disabled);
  if (themeStyle) themeStyle.disabled = true;

  try {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const rootStyle = getComputedStyle(root);
    const rootRect = root.getBoundingClientRect();
    const patternedSurfaces = [root, ...root.querySelectorAll("*")]
      .filter((element) => element instanceof HTMLElement)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          className: element.className,
          width: rect.width,
          backgroundImage: style.backgroundImage,
          backgroundSize: style.backgroundSize
        };
      })
      .filter(
        (surface) =>
          surface.width >= rootRect.width * 0.72 &&
          surface.backgroundImage !== "none" &&
          /(?:^|, )100% 32px(?:,|$)/u.test(surface.backgroundSize)
      );

    return JSON.stringify({
      setup: true,
      themeLayerHandled: !themeStyle || themeStyle.disabled,
      rootBackgroundImage: rootStyle.backgroundImage,
      rootBackgroundColor: rootStyle.backgroundColor,
      patternedSurfaces
    });
  } finally {
    if (themeStyle) themeStyle.disabled = themeWasDisabled;
  }
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
  !report.themeLayerHandled ||
  report.rootBackgroundImage !== "none" ||
  report.rootBackgroundColor === "rgba(0, 0, 0, 0)" ||
  report.patternedSurfaces?.length > 0
) {
  console.error(`Theme-independent plugin surface failed: ${JSON.stringify(report)}`);
  process.exitCode = 1;
} else {
  console.log("Plugin canvas stayed solid with the community theme layer disabled.");
}
