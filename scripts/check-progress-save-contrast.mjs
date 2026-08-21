import { spawnSync } from "node:child_process";

const vault = process.argv[2] ?? "dev-test";
const evaluation = `(async () => {
  app.setting.open();
  app.setting.openTabById("project-manager-insights");
  await new Promise((resolve) => setTimeout(resolve, 200));

  const container = app.setting.activeTab?.containerEl;
  const button = [...(container?.querySelectorAll(".pmi-progress-save button") ?? [])]
    .find((candidate) => candidate.classList.contains("mod-cta"));
  if (!(button instanceof HTMLButtonElement)) {
    return JSON.stringify({ setup: false });
  }

  const style = button.ownerDocument.defaultView.getComputedStyle(button);
  const canvas = button.ownerDocument.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const toRgb = (color) => {
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = color;
    context.fillRect(0, 0, 1, 1);
    return [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)];
  };
  const luminance = (rgb) => rgb
    .map((channel) => channel / 255)
    .map((channel) => channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
  const foreground = toRgb(style.color);
  const background = toRgb(style.backgroundColor);
  const foregroundLuminance = luminance(foreground);
  const backgroundLuminance = luminance(background);
  const contrast = (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);

  return JSON.stringify({
    setup: true,
    disabled: button.disabled,
    foreground: style.color,
    background: style.backgroundColor,
    contrast: Math.round(contrast * 100) / 100
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
if (!report.setup || report.disabled || report.contrast < 4.5) {
  console.error(`Progress save button contrast failed: ${JSON.stringify(report)}`);
  process.exitCode = 1;
} else {
  console.log(`Progress save button contrast is ${report.contrast}:1.`);
}
