<div align="center">
  <p><code>PROJECT MANAGER · WORKLOAD COMPANION</code></p>
  <h1>✦ Project Manager Insights ✦</h1>
  <p><strong>A tiny workload observatory inside your Obsidian vault.</strong></p>
  <p>Pick your projects, meet the hours behind the team, and follow every signal back to a task.</p>
  <p><strong>English</strong> · <a href="README.zh-CN.md">简体中文</a></p>
</div>

![PM Insights workload dashboard with synthetic demo data](docs/assets/pm-insights-overview.png)

<p align="center"><sub>Captured in the <code>dev-test</code> vault with the Pixel theme and synthetic data. No production project data appears in this image.</sub></p>

## ✦ Your project hours, in one little window

PM Insights turns notes created by [Project Manager](https://github.com/stepankropachev/obsidian-pm) into a calm, cross-project workload view. It gathers planned, logged, remaining, and overrun hours in one place, then lets you zoom from the team snapshot into the tasks behind each number.

> [!NOTE]
> **The read-only promise:** PM Insights looks at Project Manager data, but never modifies project or task notes.

## ✦ Follow the signal

`PROJECTS` → `TEAM SNAPSHOT` → `ASSIGNEE` → `TASKS`

1. Choose any combination of Project Manager projects.
2. Read the team's planned, logged, remaining, and overrun totals.
3. Pick an assignee to separate personal work from shared work.
4. Search or filter the task list to see exactly where the hours come from.

## ✦ Meet the pixel dashboard

| Pixel panel | What it tells you |
| --- | --- |
| `TEAM HUD` | Combined planned, logged, remaining, and overrun hours for the selected projects. |
| `ASSIGNEE CARDS` | Each person's task count and workload rails, with personal and shared work kept separate. |
| `TASK DRAWER` | Searchable task details with project, status, planned, logged, and remaining hours. |
| `QUALITY PING` | Friendly warnings for unestimated work, unassigned work, and excluded parent tasks. |

The task column stays fixed when the view is narrow, while the remaining fields scroll horizontally. The interface is available in English and Simplified Chinese and borrows its colors from the active Obsidian theme.

## ✦ Rules behind the pixels

| Metric | Calculation |
| --- | --- |
| Planned | Sum of each included task's estimate. |
| Logged | Sum of its time-log entries. |
| Remaining | `max(planned - logged, 0)` for open, estimated, non-archived tasks. |
| Overrun | `max(logged - planned, 0)` for estimated tasks. |

To keep the snapshot honest:

- A shared task contributes once to the team total and appears in every assignee's **Shared** rail.
- A task with subtasks is excluded from totals so parent and child estimates are not counted twice.
- Completed tasks—and archived tasks when included—retain planned and logged hours but contribute no remaining hours.
- Unassigned and unestimated tasks stay visible instead of quietly disappearing.
- Member aliases can combine different spellings under one canonical name without changing source notes.

## ✦ Ready when your vault is

- Obsidian `1.7.2` or later.
- The [Project Manager](https://github.com/stepankropachev/obsidian-pm) plugin and at least one Project Manager project.

Install [Project Manager Insights from the Obsidian Community directory](https://community.obsidian.md/plugins/project-manager-insights), or open **Settings → Community plugins → Browse**, search for **Project Manager Insights**, then select **Install** and **Enable**.

To use it, open **PM Insights** from the ribbon or run **PM Insights: Open workload insights** from the command palette. Choose projects from the picker, select an assignee, and use **Settings → PM Insights** whenever you want to change the language or configure member aliases.

## ✦ Build & check

Start the development build:

```bash
npm run dev
```

Run type checking, tests, and a production build:

```bash
npm run check
```

## ✦ A quiet privacy promise

PM Insights reads Project Manager metadata from the local vault. It does not edit project or task notes, and the current plugin has no network integration.

## License

[MIT](LICENSE)
