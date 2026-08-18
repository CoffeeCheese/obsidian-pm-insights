<div align="center">
  <p><code>OBSIDIAN · PROJECT MANAGER COMPANION</code></p>
  <h1>Project Manager Insights ✨</h1>
  <p><strong>A tiny workload observatory for busy Obsidian vaults.</strong></p>
  <p>See the team picture, follow the interesting bits, and leave every note exactly where it was.</p>
  <p>
    <a href="https://community.obsidian.md/plugins/project-manager-insights"><strong>Install from Community Plugins</strong></a>
    ·
    <a href="#-take-a-30-second-tour">Take a tiny tour</a>
  </p>
  <p><strong>English</strong> · <a href="README.zh-CN.md">简体中文</a></p>
</div>

![Project Manager Insights workload dashboard with synthetic demo data](docs/assets/pm-insights-overview.png)

<p align="center"><sub>A cheerful little control room—captured with the Pixel theme and synthetic data. No real project data is shown.</sub></p>

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
4. **Follow the clue.** Search and filter the task drawer to see where every hour came from.

| Inside the observatory | What you can see |
| --- | --- |
| 🛰️ **Team snapshot** | Combined planned, logged, remaining, and overrun hours for the selected projects. |
| 👤 **Assignee cards** | Each person's task count and workload rails, with personal and shared work kept separate. |
| 🔎 **Task drawer** | Searchable task details, including project, status, planned, logged, and remaining hours. |
| 🧹 **Quality ping** | Gentle warnings for unestimated work, unassigned work, and excluded parent tasks. |

The task column stays put on narrow screens while the remaining fields scroll. The interface speaks English and Simplified Chinese, and borrows its colors from your active Obsidian theme.

## 🧮 How the little gauges work

| Gauge | Calculation |
| --- | --- |
| **Planned** | Sum of each included task's estimate. |
| **Logged** | Sum of its time-log entries. |
| **Remaining** | `max(planned - logged, 0)` for open, estimated, non-archived tasks. |
| **Overrun** | `max(logged - planned, 0)` for estimated tasks. |

To keep the snapshot honest:

- A shared task contributes once to the team total and appears in every assignee's **Shared** rail.
- A task with subtasks is excluded from totals, so parent and child estimates are not counted twice.
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
