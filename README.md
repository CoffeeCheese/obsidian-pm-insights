<div align="center">
  <p><code>OBSIDIAN · PROJECT MANAGER COMPANION</code></p>
  <h1>🫧 Project Manager Insights ✨</h1>
  <p><strong>A tiny workload observatory for busy Obsidian vaults.</strong></p>
  <p>See the team picture, follow the interesting bits, and leave every note exactly where it was.</p>
  <p>
    <a href="https://community.obsidian.md/plugins/project-manager-insights"><img alt="Obsidian Community Plugin" src="https://img.shields.io/badge/Obsidian-Community%20Plugin-7C3AED?style=for-the-badge&amp;logo=obsidian&amp;logoColor=white"></a>
    <a href="https://github.com/CoffeeCheese/obsidian-pm-insights/releases"><img alt="Latest release" src="https://img.shields.io/github/v/release/CoffeeCheese/obsidian-pm-insights?style=for-the-badge&amp;label=Release&amp;color=007ACC&amp;logo=github"></a>
    <a href="https://github.com/CoffeeCheese/obsidian-pm-insights/releases"><img alt="Total downloads" src="https://img.shields.io/github/downloads/CoffeeCheese/obsidian-pm-insights/total?style=for-the-badge&amp;color=2EA44F&amp;logo=github"></a>
    <img alt="Vault data is read only" src="https://img.shields.io/badge/Vault%20Data-Read%20Only-2F7D8C?style=for-the-badge&amp;logo=markdown&amp;logoColor=white">
  </p>
  <p>
    <a href="https://community.obsidian.md/plugins/project-manager-insights"><strong>Install from Obsidian</strong></a>
    ·
    <a href="https://github.com/CoffeeCheese/obsidian-pm-insights/releases">Releases</a>
    ·
    <a href="https://github.com/CoffeeCheese/obsidian-pm-insights/issues">Report an issue</a>
  </p>
  <p><strong>English</strong> · <a href="README.zh-CN.md">简体中文</a></p>
</div>

![Project Manager Insights dashboard showing cross-project workload, member ratios, data quality, and task filters with synthetic demo data](docs/assets/pm-insights-overview.png)

<p align="center"><sub>The v0.2 dashboard in one frame: cross-project totals, data-quality signals, a compact six-ratio ledger, and composable task filters. Captured with the Pixel theme and synthetic data; no real project information is shown.</sub></p>

## 🫧 One calm view for all those moving parts

Project Manager Insights gathers notes created by [Project Manager](https://github.com/stepankropachev/obsidian-pm) into one friendly, cross-project workload view. See how planned and logged hours are distributed, spot fuzzy data, then trace every number back to its task.

```text
PROJECTS  ──→  TEAM SNAPSHOT  ──→  ASSIGNEE  ──→  TASKS
   pick             scan               focus          trace
```

> [!NOTE]
> **A tiny plugin with a firm promise:** it reads Project Manager data, but never edits project or task notes.

## ✨ Take a 30-second tour

1. **Pick a few projects.** Mix and match any Project Manager projects in your vault.
2. **Scan the team signal.** Compare planned, logged, remaining, and overrun hours.
3. **Meet the workload.** Choose an assignee and keep personal work separate from shared work.
4. **Follow the clue.** Search by text, combine project and status filters, then open the source task without losing the dashboard.

| Inside the observatory | What you can see |
| --- | --- |
| 🛰️ **Team snapshot** | Combined planned, logged, remaining, and overrun hours for the selected projects. |
| 👤 **Assignee cards** | Each person's task count and workload rails, with personal and shared work kept separate. |
| 🧭 **Delivery ledger** | Six personal ratios grouped by delivery, time, and data foundation. |
| 🔎 **Task drawer** | Search plus multi-select project and status filters, with resizable task columns. |
| 🪟 **Project Manager handoff** | Open a task in Project Manager's editor, or open its project in a new tab. |
| 🧹 **Quality ping** | Included subtask total and gentle warnings for unestimated, unassigned, and excluded parent tasks. |

The task column stays put on narrow screens while the remaining fields scroll. The interface speaks English and Simplified Chinese, and borrows its colors from your active Obsidian theme.

## 🔭 Zoom in without losing the dashboard

The assignee panel keeps investigation close to the numbers:

- **Filter from what is actually present.** Project and status choices are built from the selected assignee's current tasks. Both filters support multiple selections and work together with text search.
- **Dismiss menus naturally.** Click elsewhere or press `Escape` to close project and filter menus without clearing your selections.
- **Keep the task in context.** Select a task title to open its Project Manager editor over the current dashboard. Select the project name to open the corresponding Project Manager page in a new tab.
- **Make the table fit the question.** Drag a column divider, use the arrow keys for precise resizing, or double-click a divider to restore the default layout. Headers and records share the same left-aligned baseline.

Opening task details directly is supported with Project Manager `1.8.x`. PM Insights still performs no task-note writes; any changes made inside the Project Manager editor are handled by Project Manager itself.

## 🧭 Six ratios, three questions

The compact ledger beside each assignee answers three different questions without inserting another dashboard between the person and their tasks.

| Group | Ratio | Calculation |
| --- | --- | --- |
| **Delivery** | Task closure | Completed non-cancelled tasks ÷ all non-cancelled tasks. |
| **Delivery** | Planned work closed | Planned hours on completed tasks ÷ all estimated hours. |
| **Time** | Time consumed | Logged hours on estimated tasks ÷ their planned hours. |
| **Time** | Tasks over budget | Started estimated tasks over plan ÷ all started estimated tasks. |
| **Data foundation** | Estimate accuracy | Completed, started tasks within ±20% of estimate ÷ all completed, started estimated tasks. |
| **Data foundation** | Estimate coverage | Estimated non-cancelled tasks ÷ all non-cancelled tasks. |

An em dash means there is no valid sample yet; it is not reported as zero.

## 🧮 How the little gauges work

| Gauge | Calculation |
| --- | --- |
| **Planned** | Sum of each included task's estimate. |
| **Logged** | Sum of its time-log entries. |
| **Remaining** | `max(planned - logged, 0)` for open, estimated, non-archived tasks. |
| **Overrun** | `max(logged - planned, 0)` for estimated tasks. |

To keep the snapshot honest:

- A shared task contributes once to the team total and appears in every assignee's **Shared** rail.
- By default, root tasks explicitly marked as `type: task` are excluded even when they have no subtasks; when type metadata is missing, parent tasks are still inferred from `parentId` relationships to avoid double counting. Enable **Count parent tasks** to switch the entire dashboard to parent tasks and exclude child tasks instead.
- Completed tasks—and archived tasks when included—keep their planned and logged hours but add no remaining hours.
- Unassigned and unestimated tasks stay visible instead of quietly vanishing.
- Member aliases can gather different spellings under one canonical name without changing source notes.

## 🚀 Let it into your vault

You will need:

- Obsidian `1.7.2` or later.
- The [Project Manager](https://github.com/stepankropachev/obsidian-pm) plugin and at least one Project Manager project.

Install [Project Manager Insights from the Obsidian Community directory](https://community.obsidian.md/plugins/project-manager-insights), or open **Settings → Community plugins → Browse**, search for **Project Manager Insights**, then select **Install** and **Enable**.

Open **PM Insights** from the ribbon, or run **PM Insights: Open workload insights** from the command palette. Pick your projects, choose an assignee, and you are off. Language and member aliases live under **Settings → PM Insights**.

## 🛠️ Build the observatory

```bash
# Start the development build
npm run dev

# Type-check, lint, test, and create a production build
npm run check
```

## 🌱 Small footprint, quiet manners

PM Insights reads Project Manager metadata from your local vault. It does not edit project or task notes, and the current plugin has no network integration.

Made for people who like their project signals clear and their vaults undisturbed. ☕

## License

[MIT](LICENSE)
