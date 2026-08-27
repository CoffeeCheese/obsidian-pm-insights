import { readFileSync } from "node:fs";

const failures = [];

const styles = readFileSync("styles.css", "utf8");
if (/!important\b/u.test(styles)) {
  failures.push("styles.css: avoid !important in plugin styles");
}

const flattenedGateFooterButton =
  /button[^{]*(?:pmi-gate-editor-cancel|pmi-gate-editor-save)[^{]*\{[^}]*(?:box-shadow|transform):\s*none/u;
if (flattenedGateFooterButton.test(styles)) {
  failures.push("styles.css: preserve the native elevation of the gate footer buttons");
}

const view = readFileSync("src/view.ts", "utf8");
if (/\.values\(\)\.next\(\)\.value\s+as\s+string\s*\|\s*undefined/u.test(view)) {
  failures.push("src/view.ts: remove the unnecessary iterator value assertion");
}

const projectManagerSource = readFileSync("src/adapters/project-manager-source.ts", "utf8");
if (/vault\.(?:getFiles|getMarkdownFiles)\s*\(/u.test(projectManagerSource)) {
  failures.push("Project Manager discovery must stay scoped to its configured folder");
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Official review regression checks passed.");
}
