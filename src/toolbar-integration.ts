import { App, setIcon } from "obsidian";

export interface ToolbarIntegrationHost {
  openProjectInsights(projectPath: string): Promise<void>;
  tooltip(): string;
}

export class ProjectManagerToolbarIntegration {
  private observer: MutationObserver | null = null;
  private frame: number | null = null;

  constructor(
    private readonly app: App,
    private readonly host: ToolbarIntegrationHost
  ) {}

  start(): void {
    if (this.observer) return;
    this.observer = new MutationObserver((records) => {
      if (records.some((record) => this.affectsProjectToolbar(record))) this.scheduleSync();
    });
    this.observer.observe(document.body, { childList: true, subtree: true });
    this.sync();
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
    if (this.frame !== null) window.cancelAnimationFrame(this.frame);
    this.frame = null;
    document.querySelectorAll(".pmi-open-insights-btn").forEach((element) => element.remove());
  }

  sync(): void {
    const switchers = document.querySelectorAll<HTMLElement>(
      ".workspace-leaf-content.pm-view .pm-view-switcher"
    );
    for (const switcher of switchers) {
      if (switcher.querySelector(".pmi-open-insights-btn")) continue;
      const projectPath = this.projectPathFor(switcher);
      if (!projectPath) continue;

      const button = switcher.createEl("button", {
        cls: "clickable-icon pm-view-btn pmi-open-insights-btn",
        attr: {
          type: "button",
          "aria-label": this.host.tooltip(),
          "data-tooltip-position": "top"
        }
      });
      setIcon(button, "chart-no-axes-combined");
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        void this.host.openProjectInsights(projectPath);
      });
    }
  }

  private scheduleSync(): void {
    if (this.frame !== null) return;
    this.frame = window.requestAnimationFrame(() => {
      this.frame = null;
      this.sync();
    });
  }

  private affectsProjectToolbar(record: MutationRecord): boolean {
    if (record.target.instanceOf(Element) && record.target.closest(".pm-view-switcher")) return true;
    return [...record.addedNodes].some(
      (node) =>
        node.instanceOf(Element) &&
        (node.matches(".pm-view-switcher, .workspace-leaf-content.pm-view") ||
          Boolean(node.querySelector(".pm-view-switcher")))
    );
  }

  private projectPathFor(element: HTMLElement): string | null {
    let projectPath: string | null = null;
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (projectPath || !leaf.view.containerEl.contains(element)) return;
      const state = leaf.getViewState();
      if (state.type !== "pm-project") return;
      const filePath = (state.state as { filePath?: unknown } | undefined)?.filePath;
      if (typeof filePath === "string") projectPath = filePath;
    });
    return projectPath;
  }
}
