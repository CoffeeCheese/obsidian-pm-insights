import type { TaskRecord } from "../model";
import { normalizeProgressTag } from "./delivery-progress";

export interface ProjectTagOption {
  tag: string;
  taskCount: number;
}

export function collectProjectTagOptions(tasks: readonly TaskRecord[]): ProjectTagOption[] {
  const counts = new Map<string, number>();

  for (const task of tasks) {
    const taskTags = new Set(task.tags.map(normalizeProgressTag).filter(Boolean));
    for (const tag of taskTags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([tag, taskCount]) => ({ tag, taskCount }))
    .sort((left, right) => right.taskCount - left.taskCount || left.tag.localeCompare(right.tag));
}
