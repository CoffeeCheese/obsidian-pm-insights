import { spawnSync } from "node:child_process";

const vault = process.argv[2] ?? "Obsd";
const evaluation = `(async () => {
  const plugin = app.plugins.plugins["project-manager-insights"];
  if (!plugin) return JSON.stringify({ setup: false, reason: "plugin-missing" });

  const snapshot = await plugin.reconcileProjectManager();
  const selectedProjectIds = new Set(plugin.settings.selectedProjectIds);
  const reviewRoots = snapshot.tasks.filter((task) =>
    selectedProjectIds.has(task.projectId)
      && task.hierarchy === "root"
      && task.status === "review"
      && !task.archived
  );
  const reviewRootsWithoutCompletion = reviewRoots.filter((task) => {
    const file = app.vault.getAbstractFileByPath(task.path);
    const completed = file ? app.metadataCache.getFileCache(file)?.frontmatter?.completed : null;
    return typeof completed !== "string" || completed.trim().length === 0;
  });
  const incorrectlyCompleted = reviewRootsWithoutCompletion.filter((task) => task.completed);

  return JSON.stringify({
    setup: true,
    selectedProjectCount: selectedProjectIds.size,
    reviewCount: reviewRoots.length,
    reviewWithoutCompletionCount: reviewRootsWithoutCompletion.length,
    incorrectlyCompletedCount: incorrectlyCompleted.length,
    incorrectlyCompleted: incorrectlyCompleted.map((task) => ({
      id: task.id,
      title: task.title,
      path: task.path,
      progress: task.progress
    }))
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
if (!report.setup || report.reviewWithoutCompletionCount < 1 || report.incorrectlyCompletedCount > 0) {
  console.error(`Review roots are treated as accepted: ${JSON.stringify(report)}`);
  process.exitCode = 1;
} else {
  console.log(`${report.reviewWithoutCompletionCount} unfinished review roots remain pending acceptance.`);
}
