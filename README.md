# PM Insights

PM Insights is a read-only workload view for the Obsidian
[Project Manager](https://github.com/stepankropachev/obsidian-pm)
plugin. It combines multiple Project Manager projects and summarizes planned,
logged, remaining, and overrun hours by assignee.

## Principles

- Project and task notes are never modified.
- Multi-assignee work stays shared instead of being split arbitrarily.
- Parent tasks are excluded from hour totals when they contain subtasks.
- Unassigned and unestimated work remains visible as a data-quality signal.
- The view works with every Obsidian theme; themes can enhance its stable CSS
  classes.

## Development

```bash
npm install
npm run dev
```

Run all checks with:

```bash
npm run check
```
