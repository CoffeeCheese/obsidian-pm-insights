import { IdentityResolver, normalizeIdentity } from "./identity";
import type {
  AssignmentKind,
  InsightSnapshot,
  MemberAlias,
  MemberInsight,
  MemberRatios,
  ProjectRecord,
  RatioMetric,
  TaskInsight,
  TaskRecord,
  WorkMetrics
} from "../model";

export const UNASSIGNED_KEY = "__unassigned__";

export function emptyMetrics(): WorkMetrics {
  return {
    planned: 0,
    logged: 0,
    remaining: 0,
    overrun: 0,
    taskCount: 0,
    unestimatedCount: 0
  };
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function addTask(metrics: WorkMetrics, task: TaskInsight): void {
  metrics.planned += task.estimate;
  metrics.logged += task.logged;
  metrics.remaining += task.remaining;
  metrics.overrun += task.overrun;
  metrics.taskCount += 1;
  if (task.unestimated) metrics.unestimatedCount += 1;
}

function finalizeMetrics(metrics: WorkMetrics): WorkMetrics {
  return {
    ...metrics,
    planned: round(metrics.planned),
    logged: round(metrics.logged),
    remaining: round(metrics.remaining),
    overrun: round(metrics.overrun)
  };
}

function ratio(numerator: number, denominator: number): RatioMetric {
  return {
    numerator: round(numerator),
    denominator: round(denominator),
    percentage: denominator > 0 ? round((numerator / denominator) * 100) : null
  };
}

function isCancelled(task: TaskInsight): boolean {
  const status = task.status.trim().toLocaleLowerCase();
  return status === "cancelled" || status === "canceled";
}

function memberRatios(tasks: TaskInsight[]): MemberRatios {
  const eligible = tasks.filter((task) => !isCancelled(task));
  const completed = eligible.filter((task) => task.completed);
  const estimated = eligible.filter((task) => !task.unestimated);
  const startedEstimated = estimated.filter((task) => task.logged > 0);
  const completedEstimated = startedEstimated.filter((task) => task.completed);
  const totalPlanned = estimated.reduce((total, task) => total + task.estimate, 0);
  const completedPlanned = estimated
    .filter((task) => task.completed)
    .reduce((total, task) => total + task.estimate, 0);
  const estimatedLogged = estimated.reduce((total, task) => total + task.logged, 0);

  return {
    taskClosure: ratio(completed.length, eligible.length),
    plannedClosure: ratio(completedPlanned, totalPlanned),
    timeConsumption: ratio(estimatedLogged, totalPlanned),
    overrunTasks: ratio(
      startedEstimated.filter((task) => task.logged > task.estimate).length,
      startedEstimated.length
    ),
    estimateAccuracy: ratio(
      completedEstimated.filter((task) => {
        const consumption = task.logged / task.estimate;
        return consumption >= 0.8 && consumption <= 1.2;
      }).length,
      completedEstimated.length
    ),
    estimateCoverage: ratio(estimated.length, eligible.length)
  };
}

function taskInsight(
  task: TaskRecord,
  projectTitle: string,
  resolvedAssignees: string[],
  kind: AssignmentKind
): TaskInsight {
  const unestimated = task.estimate <= 0;
  const remaining =
    !task.completed && !task.archived && !unestimated
      ? Math.max(task.estimate - task.logged, 0)
      : 0;
  const overrun = !unestimated ? Math.max(task.logged - task.estimate, 0) : 0;

  return {
    ...task,
    projectTitle,
    resolvedAssignees,
    assignmentKind: kind,
    remaining: round(remaining),
    overrun: round(overrun),
    unestimated
  };
}

export interface AggregateOptions {
  projectIds: Set<string>;
  includeArchived: boolean;
  countParentTasks: boolean;
  aliases: MemberAlias[];
  unassignedLabel: string;
}

export function aggregateInsights(
  projects: ProjectRecord[],
  tasks: TaskRecord[],
  options: AggregateOptions
): InsightSnapshot {
  const projectTitles = new Map(projects.map((project) => [project.id, project.title]));
  const selected = tasks.filter((task) => options.projectIds.has(task.projectId));
  const parentIds = new Set(
    selected.map((task) => task.parentId).filter((id): id is string => Boolean(id))
  );
  const parentTasks = selected.filter(
    (task) => task.hierarchy === "root" || parentIds.has(task.id)
  );
  const parentTaskIds = new Set(parentTasks.map((task) => task.id));
  const childTasks = selected.filter((task) => !parentTaskIds.has(task.id));
  const scopedTasks = options.countParentTasks ? parentTasks : childTasks;
  const resolver = new IdentityResolver(options.aliases);
  const included = scopedTasks.filter((task) => options.includeArchived || !task.archived);

  const members = new Map<string, MemberInsight>();
  const allTasks: TaskInsight[] = [];
  const team = emptyMetrics();

  const getMember = (name: string, unassigned = false): MemberInsight => {
    const key = unassigned ? UNASSIGNED_KEY : normalizeIdentity(name);
    let member = members.get(key);
    if (!member) {
      member = {
        key,
        name: unassigned ? options.unassignedLabel : name,
        kind: unassigned ? "unassigned" : "member",
        personal: emptyMetrics(),
        shared: emptyMetrics(),
        ratios: memberRatios([]),
        tasks: []
      };
      members.set(key, member);
    }
    return member;
  };

  for (const task of included) {
    const assignees = resolver.resolveMany(task.assignees);
    const kind: AssignmentKind =
      assignees.length === 0 ? "unassigned" : assignees.length === 1 ? "personal" : "shared";
    const insight = taskInsight(
      task,
      projectTitles.get(task.projectId) ?? task.projectId,
      assignees,
      kind
    );
    allTasks.push(insight);
    addTask(team, insight);

    if (kind === "unassigned") {
      const member = getMember(options.unassignedLabel, true);
      addTask(member.personal, insight);
      member.tasks.push(insight);
      continue;
    }

    for (const assignee of assignees) {
      const member = getMember(assignee);
      addTask(kind === "shared" ? member.shared : member.personal, insight);
      member.tasks.push(insight);
    }
  }

  const finalizedMembers = [...members.values()]
    .map((member) => {
      const tasks = member.tasks.sort(
        (left, right) =>
          right.remaining - left.remaining || left.projectTitle.localeCompare(right.projectTitle)
      );
      return {
        ...member,
        personal: finalizeMetrics(member.personal),
        shared: finalizeMetrics(member.shared),
        ratios: memberRatios(tasks),
        tasks
      };
    })
    .sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === "unassigned" ? 1 : -1;
      const leftRemaining = left.personal.remaining + left.shared.remaining;
      const rightRemaining = right.personal.remaining + right.shared.remaining;
      return rightRemaining - leftRemaining || left.name.localeCompare(right.name);
    });

  return {
    members: finalizedMembers,
    tasks: allTasks,
    team: finalizeMetrics(team),
    quality: {
      subtaskCount: allTasks.filter((task) => task.hierarchy === "subtask").length,
      parentTaskCount: allTasks.filter((task) => parentTaskIds.has(task.id)).length,
      unassignedCount: allTasks.filter((task) => task.assignmentKind === "unassigned").length,
      unestimatedCount: allTasks.filter((task) => task.unestimated).length,
      excludedParentCount: options.countParentTasks ? 0 : parentTasks.length,
      excludedChildTaskCount: options.countParentTasks ? childTasks.length : 0,
      excludedParentHours: round(
        (options.countParentTasks ? [] : parentTasks).reduce(
          (total, task) => total + task.estimate + task.logged,
          0
        )
      )
    }
  };
}
