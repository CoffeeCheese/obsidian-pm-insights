import { Modal, setIcon, type App } from "obsidian";
import type { DeliveryProgressIssue } from "./domain/delivery-progress";
import type { Translations } from "./i18n";
import type { DeliveryStageId, ProjectRecord } from "./model";

type DeliveryProgressIssueKind = DeliveryProgressIssue["kind"];
type IssueFilter = "all" | DeliveryProgressIssueKind;

const ISSUE_KIND_ORDER: DeliveryProgressIssueKind[] = [
  "missing-prerequisite",
  "premature-completion",
  "conflicting",
  "unclassified",
  "unlinked"
];

let nextModalLabelId = 0;

interface DeliveryIssuesModalOptions {
  issues: DeliveryProgressIssue[];
  projects: ProjectRecord[];
  translations: Translations;
  openTask(taskId: string, projectPath: string): Promise<void> | void;
}

export class DeliveryIssuesModal extends Modal {
  private filter: IssueFilter = "all";
  private readonly labelId = ++nextModalLabelId;
  private readonly filterLabelId = `pmi-issue-filter-label-${this.labelId}`;
  private readonly titleLabelId = `pmi-issue-title-label-${this.labelId}`;

  constructor(app: App, private readonly options: DeliveryIssuesModalOptions) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("pmi-delivery-issues-modal");
    this.modalEl.setAttribute("aria-labelledby", this.titleLabelId);
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private render(): void {
    const { issues, translations: t } = this.options;
    this.contentEl.empty();

    const lead = this.contentEl.createDiv("pmi-issue-lead");
    const signal = lead.createSpan("pmi-issue-lead-signal");
    setIcon(signal, "circle-alert");
    const copy = lead.createDiv("pmi-issue-lead-copy");
    const heading = copy.createDiv("pmi-issue-lead-heading");
    heading.createEl("h2", {
      text: t.deliveryIssuesTitle,
      attr: { id: this.titleLabelId }
    });
    heading.createSpan({ text: t.deliveryIssuesCount(issues.length) });
    copy.createEl("p", { text: t.deliveryIssuesSubtitle });

    const filters = this.contentEl.createDiv({
      cls: "pmi-issue-filters",
      attr: { role: "group", "aria-labelledby": this.filterLabelId }
    });
    filters.createSpan({
      cls: "pmi-sr-only",
      text: t.deliveryIssuesFilter,
      attr: { id: this.filterLabelId }
    });
    this.renderFilter(filters, "all", t.deliveryIssuesAll, issues.length);
    for (const kind of ISSUE_KIND_ORDER) {
      const count = issues.filter((issue) => issue.kind === kind).length;
      if (count > 0) this.renderFilter(filters, kind, this.issueLabel(kind, t), count);
    }

    const groups = this.filter === "all" ? ISSUE_KIND_ORDER : [this.filter];
    const list = this.contentEl.createDiv("pmi-issue-groups");
    for (const kind of groups) {
      const groupIssues = issues.filter((issue) => issue.kind === kind);
      if (groupIssues.length === 0) continue;
      this.renderGroup(list, kind, groupIssues, t);
    }

    const hint = this.contentEl.createDiv("pmi-issue-hint");
    setIcon(hint.createSpan(), "square-mouse-pointer");
    hint.createSpan({ text: t.deliveryIssuesOpenHint });
  }

  private renderFilter(
    root: HTMLElement,
    filter: IssueFilter,
    label: string,
    count: number
  ): void {
    const button = root.createEl("button", {
      cls: `pmi-issue-filter${this.filter === filter ? " is-active" : ""}`,
      attr: {
        type: "button",
        "aria-pressed": String(this.filter === filter)
      }
    });
    button.createSpan({ text: label });
    button.createSpan({ cls: "pmi-issue-filter-count", text: String(count) });
    button.addEventListener("click", (event) => {
      if (this.filter === filter) return;
      const restoreKeyboardFocus = event.detail === 0;
      this.filter = filter;
      this.render();
      if (restoreKeyboardFocus) {
        this.contentEl.querySelector<HTMLButtonElement>(
          `.pmi-issue-filter[aria-pressed="true"]`
        )?.focus();
      }
    });
  }

  private renderGroup(
    root: HTMLElement,
    kind: DeliveryProgressIssueKind,
    issues: DeliveryProgressIssue[],
    t: Translations
  ): void {
    const section = root.createDiv({
      cls: `pmi-issue-group pmi-issue-group--${kind}`,
      attr: { "data-issue-kind": kind }
    });
    const heading = section.createDiv("pmi-issue-group-heading");
    heading.createEl("h3", { text: this.issueLabel(kind, t) });
    heading.createSpan({ text: String(issues.length) });

    const projects = new Map(this.options.projects.map((project) => [project.id, project]));
    const rows = section.createDiv("pmi-issue-list");
    for (const issue of issues) {
      const project = projects.get(issue.task.projectId);
      const row = rows.createEl("button", {
        cls: "pmi-issue-row",
        attr: {
          type: "button",
          "data-task-id": issue.task.id,
          "aria-label": `${t.openTask}: ${issue.task.title}`
        }
      });
      row.createSpan({ cls: "pmi-issue-trace", attr: { "aria-hidden": "true" } });
      const body = row.createDiv("pmi-issue-row-body");
      const title = body.createDiv("pmi-issue-row-title");
      title.createEl("strong", { text: issue.task.title });
      title.createSpan({
        text: issue.task.hierarchy === "root"
          ? t.deliveryIssueRootTask
          : t.deliveryIssueSubtask
      });
      body.createDiv({
        cls: "pmi-issue-row-reason",
        text: this.issueReason(issue, t)
      });
      const meta = body.createDiv("pmi-issue-row-meta");
      meta.createSpan({ text: project ? `${project.icon} ${project.title}` : issue.task.projectId });
      meta.createSpan({ text: issue.task.path });
      const arrow = row.createSpan("pmi-issue-row-arrow");
      setIcon(arrow, "arrow-up-right");
      row.addEventListener("click", () => {
        if (!project) return;
        void this.options.openTask(issue.task.id, project.path);
      });
    }
  }

  private issueLabel(kind: DeliveryProgressIssueKind, t: Translations): string {
    switch (kind) {
      case "unclassified": return t.deliveryIssueUnclassified;
      case "conflicting": return t.deliveryIssueConflicting;
      case "unlinked": return t.deliveryIssueUnlinked;
      case "missing-prerequisite": return t.deliveryIssueMissingPrerequisite;
      case "premature-completion": return t.deliveryIssuePrematureCompletion;
    }
  }

  private issueReason(issue: DeliveryProgressIssue, t: Translations): string {
    switch (issue.kind) {
      case "unclassified": return t.deliveryIssueUnclassifiedReason;
      case "conflicting": return t.deliveryIssueConflictingReason;
      case "unlinked": return t.deliveryIssueUnlinkedReason;
      case "premature-completion": return t.deliveryIssuePrematureCompletionReason;
      case "missing-prerequisite":
        return t.deliveryIssueMissingPrerequisiteReason(this.stageLabel(issue.stageId, t));
    }
  }

  private stageLabel(stageId: DeliveryStageId, t: Translations): string {
    switch (stageId) {
      case "design": return t.designProgress;
      case "development": return t.developmentProgress;
      case "testing": return t.testingProgress;
    }
  }
}
