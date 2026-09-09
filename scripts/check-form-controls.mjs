import { spawnSync } from "node:child_process";

const vault = process.argv[2] ?? "dev-test";
if (vault !== "dev-test") throw new Error("Run form control verification only in dev-test.");
const evaluation = `(async () => {
  const active = document.activeElement;
  const protectedBefore = localStorage.getItem("EmulateMobile");
  const theme = app.customCss?.styleEl?.sheet;
  const disabledBefore = theme?.disabled;
  const host = document.createElement("div");
  // Visible, transient DOM fixtures exercise the installed CSS without editing vault data.
  (document.querySelector(".modal-container:last-of-type .modal") ?? document.body).append(host);
  const failures = [];
  let checked = 0;
  const read = e => {
    const s = getComputedStyle(e);
    return {border: parseFloat(s.borderTopWidth), shadow:s.boxShadow, outline:parseFloat(s.outlineWidth)};
  };
  const outside = document.createElement("input");
  outside.type = "text";
  document.body.append(outside);
  const outsideBefore = read(outside);
  let outsideAfter;
  try {
    for (const defaultTheme of [false, true]) {
      if (theme) theme.disabled = defaultTheme;
      for (const scope of [
        "modal pmi-project-gates-modal", "modal pmi-launch-confirm-modal",
        "modal pmi-delay-clear-modal", "modal pmi-project-tag-modal",
        "pmi-root", "vertical-tab-content"
      ]) {
        const wrapper = document.createElement("div");
        if (scope === "vertical-tab-content") wrapper.className = "mod-settings";
        host.append(wrapper);
        const root = document.createElement("div");
        root.className = scope + " pmi-form-scope";
        wrapper.append(root);
        const control = document.createElement("div");
        control.className = "setting-item-control";
        root.append(control);
        for (const type of ["date", "datetime-local", "text", "search", "number", "email", "password", "textarea", "select"]) {
          const e = document.createElement(type === "textarea" || type === "select" ? type : "input");
          if (e.tagName === "INPUT") e.type = type;
          if (type === "select") {e.className = "dropdown"; e.add(new Option("One", "one"));}
          control.append(e);
          for (const state of ["idle", "focus", "disabled"]) {
            e.disabled = state === "disabled";
            if (state === "focus") e.focus(); else e.blur();
            await new Promise(r => requestAnimationFrame(r));
            const s = read(e);
            checked++;
            if (s.border !== 1 || s.shadow !== "none" || s.outline > 2 ||
                (state === "focus" && (!e.matches(":focus-within") || s.outline === 0))) {
              failures.push({defaultTheme,scope,type,state,...s});
            }
          }
          e.remove();
        }

        for (const [fieldClass, inputClass] of [
          ["pmi-delay-days-control", "pmi-delay-days-input"],
          ["pmi-progress-tag-field", "pmi-progress-tags-input"]
        ]) {
          const field = document.createElement("div");
          field.className = fieldClass;
          const input = document.createElement("input");
          input.type = "text";
          input.className = inputClass;
          field.append(input);
          control.append(field);
          input.focus();
          await new Promise(r => requestAnimationFrame(r));
          checked++;
          if (read(input).border !== 0 || read(input).shadow !== "none" ||
              read(input).outline !== 0 || read(field).border !== 1 ||
              read(field).outline !== 2 || read(field).shadow !== "none") {
            failures.push({defaultTheme,scope,fieldClass,input:read(input),field:read(field)});
          }
          field.remove();
        }
        wrapper.remove();
      }
    }
  } finally {
    if (theme) theme.disabled = disabledBefore;
    outsideAfter = read(outside);
    outside.remove();
    host.remove();
    active?.focus();
  }
  return JSON.stringify({checked,failures,
    protectedUnchanged:localStorage.getItem("EmulateMobile") === protectedBefore,
    outsideUnchanged:JSON.stringify(outsideBefore) === JSON.stringify(outsideAfter)});
})()`;
const result = spawnSync("obsidian", [`vault=${vault}`, "eval", `code=${evaluation}`], { encoding:"utf8", timeout:60000 });
if (result.error) throw result.error;
const payload = result.stdout.match(/=>\s*(\{.*\})/u)?.[1];
if (!payload) throw new Error(result.stdout + result.stderr);
const report = JSON.parse(payload);
console.log(JSON.stringify({...report, failures:report.failures.slice(0,12)}, null, 2));
if (report.failures.length || !report.protectedUnchanged || !report.outsideUnchanged) process.exitCode = 1;
