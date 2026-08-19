import { readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const readmePaths = ["README.md", "README.zh-CN.md"];
const expectedTitle = `<h1>${manifest.name}</h1>`;
const failures = [];

for (const path of readmePaths) {
  const readme = readFileSync(path, "utf8");
  if (!readme.includes(expectedTitle)) {
    failures.push(`${path}: title must exactly match manifest name (${manifest.name})`);
  }
}

const styles = readFileSync("styles.css", "utf8");
if (/!important\b/u.test(styles)) {
  failures.push("styles.css: avoid !important in plugin styles");
}

const view = readFileSync("src/view.ts", "utf8");
if (/\.values\(\)\.next\(\)\.value\s+as\s+string\s*\|\s*undefined/u.test(view)) {
  failures.push("src/view.ts: remove the unnecessary iterator value assertion");
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Official review regression checks passed.");
}
