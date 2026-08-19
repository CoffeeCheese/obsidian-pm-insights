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

  const taskButton = await waitFor(() => [...document.querySelectorAll(".pmi-task-open")].at(-1));
  const projectButton = taskButton?.closest(".pmi-task-row")?.querySelector(".pmi-project-open");
  const row = taskButton?.closest(".pmi-task-row");
  const insightsLeaf = app.workspace.getLeavesOfType("project-manager-insights-view")[0];
  if (
    !(taskButton instanceof HTMLElement) ||
    !(projectButton instanceof HTMLElement) ||
    !(row instanceof HTMLElement) ||
    !insightsLeaf
  ) return JSON.stringify({ setup: false });

  const appearance = (element) => {
    const style = getComputedStyle(element);
    return { border: style.borderTopWidth, shadow: style.boxShadow };
  };
  const appearanceBeforeTheme = {
    task: appearance(taskButton),
    project: appearance(projectButton)
  };
  const hostileTheme = document.head.createEl("style");
  hostileTheme.textContent = ".pmi-task-row button { border: 4px solid rgb(1, 2, 3) !important; box-shadow: 0 5px 0 rgb(4, 5, 6) !important; }";
  const appearanceAfterTheme = {
    task: appearance(taskButton),
    project: appearance(projectButton)
  };
  const textCellAppearanceUnchanged =
    JSON.stringify(appearanceBeforeTheme) === JSON.stringify(appearanceAfterTheme);
  hostileTheme.remove();

  const originalProjectLeaves = new Set(app.workspace.getLeavesOfType("pm-project"));
  const originalDetachedHosts = new Set(document.querySelectorAll(".pmi-detached-project-host"));
  const originalModals = new Set(document.querySelectorAll(".modal-container"));
  let taskSawTemporaryProjectTab = false;
  const inspectTaskLeaves = () => {
    if (app.workspace.getLeavesOfType("pm-project").some((leaf) => !originalProjectLeaves.has(leaf))) {
      taskSawTemporaryProjectTab = true;
    }
  };
  const layoutRef = app.workspace.on("layout-change", inspectTaskLeaves);
  const activeLeafRef = app.workspace.on("active-leaf-change", inspectTaskLeaves);
  const leafPoll = window.setInterval(inspectTaskLeaves, 5);
  taskButton.click();
  const taskModal = await waitFor(() =>
    [...document.querySelectorAll(".modal-container")].find((modal) => !originalModals.has(modal))
  );
  const taskUsedDetachedHost = [...document.querySelectorAll(".pmi-detached-project-host")].some(
    (host) => !originalDetachedHosts.has(host)
  );
  window.clearInterval(leafPoll);
  app.workspace.offref(layoutRef);
  app.workspace.offref(activeLeafRef);
  await waitFor(() => app.workspace.getLeavesOfType("pm-project").every((leaf) => originalProjectLeaves.has(leaf)));

  const taskStayedOnInsights = app.workspace.getLeaf(false) === insightsLeaf;
  const taskLeftNoProjectTab = app.workspace
    .getLeavesOfType("pm-project")
    .every((leaf) => originalProjectLeaves.has(leaf));
  const taskId = taskButton.dataset.taskId ?? "";
  taskModal?.querySelector(".modal-header-button")?.click();
  await waitFor(() => !taskModal?.isConnected);
  await waitFor(() =>
    [...document.querySelectorAll(".pmi-detached-project-host")].every((host) =>
      originalDetachedHosts.has(host)
    )
  );
  const taskModalClosed = !taskModal?.isConnected;
  const taskDetachedHostCleaned = [...document.querySelectorAll(".pmi-detached-project-host")].every(
    (host) => originalDetachedHosts.has(host)
  );

  const projectPath = projectButton.dataset.projectPath ?? "";
  projectButton.click();
  const projectLeaf = await waitFor(() =>
    app.workspace
      .getLeavesOfType("pm-project")
      .find((leaf) => !originalProjectLeaves.has(leaf) && leaf.getViewState().state?.filePath === projectPath)
  );
  const projectOpenedNewTab = Boolean(projectLeaf);
  const projectInitialized = Boolean(
    await waitFor(() => projectLeaf?.view?.project?.filePath === projectPath)
  );
  projectLeaf?.detach();
  app.workspace.setActiveLeaf(insightsLeaf, { focus: false });

  return JSON.stringify({
    setup: true,
    rowTag: row.tagName,
    taskButtonTag: taskButton.tagName,
    projectButtonTag: projectButton.tagName,
    taskRole: taskButton.getAttribute("role"),
    projectRole: projectButton.getAttribute("role"),
    taskTabIndex: taskButton.tabIndex,
    projectTabIndex: projectButton.tabIndex,
    appearanceBeforeTheme,
    appearanceAfterTheme,
    textCellAppearanceUnchanged,
    taskId,
    projectPath,
    taskModalOpened: Boolean(taskModal),
    taskModalClosed,
    taskStayedOnInsights,
    taskSawTemporaryProjectTab,
    taskUsedDetachedHost,
    taskDetachedHostCleaned,
    taskLeftNoProjectTab,
    projectOpenedNewTab,
    projectInitialized
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
if (
  !report.setup ||
  report.rowTag !== "DIV" ||
  report.taskButtonTag !== "DIV" ||
  report.projectButtonTag !== "DIV" ||
  report.taskRole !== "button" ||
  report.projectRole !== "button" ||
  report.taskTabIndex !== 0 ||
  report.projectTabIndex !== 0 ||
  report.appearanceBeforeTheme?.task?.border !== "0px" ||
  report.appearanceBeforeTheme?.project?.border !== "0px" ||
  !report.textCellAppearanceUnchanged ||
  !report.taskId ||
  !report.projectPath ||
  !report.taskModalOpened ||
  !report.taskModalClosed ||
  !report.taskStayedOnInsights ||
  report.taskSawTemporaryProjectTab ||
  !report.taskUsedDetachedHost ||
  !report.taskDetachedHostCleaned ||
  !report.taskLeftNoProjectTab ||
  !report.projectOpenedNewTab ||
  !report.projectInitialized
) {
  console.error(`Task navigation failed: ${JSON.stringify(report)}`);
  process.exitCode = 1;
} else {
  console.log(
    "Task clicks open the native Project Manager editor over Insights; project clicks open a new Project Manager tab."
  );
}
