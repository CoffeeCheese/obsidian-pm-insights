import { spawnSync } from "node:child_process";

const vault = process.argv[2] ?? "dev-test";
const openResult = spawnSync(
  "obsidian",
  [`vault=${vault}`, "command", "id=project-manager-insights:open-assignee-workload-insights"],
  { encoding: "utf8" }
);
if (openResult.error) throw openResult.error;

const evaluation = `(async () => {
  for (let attempt = 0; attempt < 30 && !document.querySelector(".pmi-project-scope"); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  const plugin = app.plugins.plugins["project-manager-insights"];
  const scope = document.querySelector(".pmi-project-scope");
  const picker = document.querySelector(".pmi-project-picker");
  const checkboxes = [...(picker?.querySelectorAll('.pmi-project-option input[type="checkbox"]') ?? [])];
  if (!plugin || !(scope instanceof HTMLElement) || !(picker instanceof HTMLDetailsElement) || checkboxes.length < 1) {
    return JSON.stringify({ setup: false });
  }

  const originalProjectIds = [...plugin.settings.selectedProjectIds];
  const snapshot = await plugin.readProjectManager();
  const originalProjectNames = snapshot.projects
    .filter((project) => originalProjectIds.includes(project.id))
    .map((project) => project.title)
    .sort();

  const selectedNames = () => checkboxes
    .filter((checkbox) => checkbox.checked)
    .map((checkbox) => checkbox.closest(".pmi-project-option")?.querySelector("span:last-child")?.textContent?.trim() ?? "")
    .filter(Boolean);
  const scopeNames = () => [...scope.querySelectorAll(".pmi-project-scope-project-name")]
    .map((node) => node.textContent?.trim() ?? "")
    .filter(Boolean);
  const sameNames = () => JSON.stringify(scopeNames().sort()) === JSON.stringify(selectedNames().sort());

  let report;
  try {
    const initialNamesMatch = sameNames();
    const candidate = checkboxes.find((checkbox) => !checkbox.checked) ?? checkboxes[0];
    candidate.click();
    await new Promise((resolve) => setTimeout(resolve, 180));
    const namesMatchAfterChange = sameNames();
    const liveRegionUpdated = scopeNames().length === selectedNames().length;

    const lead = scope.querySelector(".pmi-project-scope-lead");
    const track = scope.querySelector(".pmi-project-scope-track");
    const label = scope.querySelector(".pmi-project-scope-label");
    const summary = scope.querySelector(".pmi-project-scope-summary");
    const scopeRect = scope.getBoundingClientRect();
    const leadRect = lead?.getBoundingClientRect();
    const trackRect = track?.getBoundingClientRect();
    const originalWidth = scope.style.width;
    scope.style.width = "340px";
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const narrowScopeRect = scope.getBoundingClientRect();
    const narrowLeadRect = lead?.getBoundingClientRect();
    const narrowTrackRect = track?.getBoundingClientRect();
    const narrowLayoutContained = Boolean(
      narrowLeadRect &&
      narrowTrackRect &&
      narrowLeadRect.left >= narrowScopeRect.left &&
      narrowLeadRect.right <= narrowScopeRect.right &&
      narrowTrackRect.left >= narrowScopeRect.left &&
      narrowTrackRect.right <= narrowScopeRect.right &&
      narrowTrackRect.width >= 100
    );
    scope.style.width = originalWidth;

    const removeButton = scope.querySelector(".pmi-project-scope-remove");
    const removeToken = removeButton?.closest(".pmi-project-scope-token");
    const removedProjectId = removeToken?.getAttribute("data-project-id") ?? "";
    const selectedCountBeforeRemove = plugin.settings.selectedProjectIds.length;
    removeButton?.click();
    const removalFeedbackStarted = removeToken?.classList.contains("is-removing") === true;
    const removeButtonRect = removeButton?.getBoundingClientRect();
    const removeTokenRect = removeToken?.getBoundingClientRect();
    await new Promise((resolve) => setTimeout(resolve, 260));
    const removedCheckbox = checkboxes.find((checkbox) => checkbox.dataset.projectId === removedProjectId);
    const persistedSettings = await plugin.loadData();

    report = {
      setup: true,
      initialNamesMatch,
      namesMatchAfterChange,
      liveRegionUpdated,
      atomicLiveRegion:
        scope.getAttribute("aria-live") === "polite" && scope.getAttribute("aria-atomic") === "true",
      hasLabel: Boolean(label?.textContent?.trim()),
      hasSummary: Boolean(summary?.textContent?.trim()),
      compactHeight: Math.round(scopeRect.height * 100) / 100,
      leadContained: Boolean(leadRect && leadRect.left >= scopeRect.left && leadRect.right <= scopeRect.right),
      trackContained: Boolean(trackRect && trackRect.left >= scopeRect.left && trackRect.right <= scopeRect.right),
      narrowLayoutContained,
      hasRemoveButton: removeButton instanceof HTMLButtonElement,
      removeButtonAccessible: Boolean(removeButton?.getAttribute("aria-label")?.trim()),
      removeButtonContained: Boolean(
        removeButtonRect &&
        removeTokenRect &&
        removeButtonRect.left >= removeTokenRect.left &&
        removeButtonRect.right <= removeTokenRect.right &&
        removeButtonRect.top >= removeTokenRect.top &&
        removeButtonRect.bottom <= removeTokenRect.bottom
      ),
      removalFeedbackStarted,
      selectionRemoved:
        Boolean(removedProjectId) &&
        plugin.settings.selectedProjectIds.length === selectedCountBeforeRemove - 1 &&
        !plugin.settings.selectedProjectIds.includes(removedProjectId),
      removalPersisted:
        Boolean(removedProjectId) &&
        !persistedSettings?.selectedProjectIds?.includes(removedProjectId),
      pickerSynchronized: removedCheckbox?.checked === false,
      scopeSynchronizedAfterRemove:
        !scope.querySelector('[data-project-id="' + CSS.escape(removedProjectId) + '"]') && sameNames(),
      pageHasNoHorizontalOverflow: scope.closest(".pmi-root")?.scrollWidth <= scope.closest(".pmi-root")?.clientWidth + 1
    };
  } finally {
    plugin.settings.selectedProjectIds = originalProjectIds;
    await plugin.saveSettings();
    await plugin.refreshInsights();
    await new Promise((resolve) => setTimeout(resolve, 180));
  }

  const restoredScopeNames = [...document.querySelectorAll(".pmi-project-scope-project-name")]
    .map((node) => node.textContent?.trim() ?? "")
    .filter(Boolean)
    .sort();
  report.selectionRestored =
    JSON.stringify([...plugin.settings.selectedProjectIds].sort()) === JSON.stringify(originalProjectIds.sort()) &&
    JSON.stringify(restoredScopeNames) === JSON.stringify(originalProjectNames);
  return JSON.stringify(report);
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
  !report.initialNamesMatch ||
  !report.namesMatchAfterChange ||
  !report.liveRegionUpdated ||
  !report.selectionRestored ||
  !report.atomicLiveRegion ||
  !report.hasLabel ||
  !report.hasSummary ||
  report.compactHeight > 64 ||
  !report.leadContained ||
  !report.trackContained ||
  !report.narrowLayoutContained ||
  !report.hasRemoveButton ||
  !report.removeButtonAccessible ||
  !report.removeButtonContained ||
  !report.removalFeedbackStarted ||
  !report.selectionRemoved ||
  !report.removalPersisted ||
  !report.pickerSynchronized ||
  !report.scopeSynchronizedAfterRemove ||
  !report.pageHasNoHorizontalOverflow
) {
  console.error(`Project scope rail failed: ${JSON.stringify(report)}`);
  process.exitCode = 1;
} else {
  console.log(`Project scope stayed synchronized with the picker in a ${report.compactHeight}px rail.`);
}
