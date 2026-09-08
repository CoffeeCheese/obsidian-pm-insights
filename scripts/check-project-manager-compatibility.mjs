import { spawnSync } from "node:child_process";

// Run only in a test vault. The editor preference is changed in memory, never saved,
// and restored in finally; only the editors opened by this check are closed.
async function verifyCompatibility() {
  const pm = app.plugins.getPlugin("project-manager");
  const insights = app.plugins.getPlugin("project-manager-insights");
  if (!pm?.index?.ready || !insights) throw new Error("Enable both plugins in a ready test vault");
  const waitFor = async (read) => {
    for (let i = 0; i < 150; i += 1) {
      const result = read();
      if (result) return result;
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    throw new Error("Timed out waiting for the native task editor");
  };
  const snapshot = await insights.reconcileProjectManager();
  const projects = new Map(pm.index.projectRefs().map((project) => [project.path, project]));
  const tasks = new Map(snapshot.tasks.map((task) => [task.path, task]));
  const owned = pm.index.allTaskRefs().filter((task) => projects.has(task.projectPath));
  let linkedParents = 0;
  for (const ref of owned) {
    const task = tasks.get(ref.path);
    if (!task || task.projectId !== projects.get(ref.projectPath).id) {
      throw new Error("A native task is missing from its Insights project");
    }
    const parent = app.metadataCache.getCache(ref.path)?.frontmatter?.parentId;
    if (typeof parent === "string" && parent.startsWith("[[")) {
      const link = parent.slice(2, -2).split("|")[0];
      const file = app.metadataCache.getFirstLinkpathDest(link, ref.path);
      const id = file && app.metadataCache.getFileCache(file)?.frontmatter?.id;
      if (id && task.parentId !== id) throw new Error("A linked parent was not resolved");
      if (id) linkedParents += 1;
    }
  }
  const ref = owned.find((task) => {
    const fm = app.metadataCache.getCache(task.path)?.frontmatter;
    return !task.archived && String(fm?.parentId ?? "").startsWith("[[");
  }) ?? owned.find((task) => !task.archived);
  if (!ref) throw new Error("Create at least one task in the test vault");
  const file = app.vault.getAbstractFileByPath(ref.path);
  const originalContent = await app.vault.read(file);
  const originalSurface = pm.settings.taskEditorSurface;
  const originalSaveOnClose = pm.settings.saveTaskOnClose;
  const originalLeaf = app.workspace.getMostRecentLeaf();
  const modalsBefore = new Set(document.querySelectorAll(".modal-container"));
  const leavesBefore = new Set(app.workspace.getLeavesOfType("pm-task"));
  const hostsBefore = new Set(document.querySelectorAll(".pmi-detached-project-host"));
  const report = { version: pm.manifest.version, tasks: owned.length, linkedParents };
  let opening;
  const closeNewModals = () => {
    for (const modal of document.querySelectorAll(".modal-container")) {
      if (!modalsBefore.has(modal)) {
        modal.querySelector(".modal-close-button, .modal-header-button, [aria-label='Close']")?.click();
      }
    }
  };
  try {
    pm.settings.saveTaskOnClose = false;
    pm.settings.taskEditorSurface = "modal";
    opening = insights.openTask(ref.id, ref.projectPath);
    const modal = await waitFor(() => [...document.querySelectorAll(".modal-container")]
      .find((el) => !modalsBefore.has(el) && el.querySelector(".pm-te-title")));
    report.modalCorrectTask = modal.querySelector(".pm-te-crumb-id")?.textContent === ref.id;
    closeNewModals();
    await opening;
    report.modalCleaned = !modal.isConnected;

    pm.settings.taskEditorSurface = "tab";
    await insights.openTask(ref.id, ref.projectPath);
    const leaf = await waitFor(() => app.workspace.getLeavesOfType("pm-task")
      .find((candidate) => !leavesBefore.has(candidate)));
    report.tabCorrectTask = leaf.getViewState().state?.filePath === ref.path
      && leaf.view.containerEl.querySelector(".pm-te-crumb-id")?.textContent === ref.id;
    report.tabWithoutModal = [...document.querySelectorAll(".modal-container")]
      .every((el) => modalsBefore.has(el));
    leaf.detach();
    report.hostsCleaned = [...document.querySelectorAll(".pmi-detached-project-host")]
      .every((el) => hostsBefore.has(el));
    report.taskUnchanged = originalContent === await app.vault.read(file);
    if (!report.modalCorrectTask || !report.modalCleaned || !report.tabCorrectTask
      || !report.tabWithoutModal || !report.hostsCleaned || !report.taskUnchanged) {
      throw new Error(`Compatibility assertions failed: ${JSON.stringify(report)}`);
    }
    return JSON.stringify(report);
  } finally {
    closeNewModals();
    for (const leaf of app.workspace.getLeavesOfType("pm-task")) {
      if (!leavesBefore.has(leaf)) leaf.detach();
    }
    pm.settings.taskEditorSurface = originalSurface;
    pm.settings.saveTaskOnClose = originalSaveOnClose;
    if (originalLeaf) app.workspace.setActiveLeaf(originalLeaf, { focus: false });
  }
}

const result = spawnSync("obsidian", [
  `vault=${process.argv[2] ?? "dev-test"}`,
  "eval",
  `code=(${verifyCompatibility.toString()})()`
], { encoding: "utf8", timeout: 30_000 });
if (result.error) throw result.error;
const output = `${result.stdout}${result.stderr}`;
const payload = output.match(/=>\s*(\{.*\})/u)?.[1];
if (!payload) throw new Error(`Compatibility check failed:\n${output}`);
console.log(JSON.stringify(JSON.parse(payload), null, 2));
